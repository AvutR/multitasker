import { randomUUID } from 'node:crypto'
import type { SessionInfo, SpawnRequest } from '@shared/types'
import { idleSessionIds } from '@shared/board'
import { recommendModelForSubtask } from '@shared/modelTier'
import { buildTaskBrief } from '@shared/taskBrief'
import { recall } from '../integrations/agentMemory'
import { projectRoot } from '../util/projectRoot'
import { writeWorktreeBrief } from '../util/taskBriefFile'
import type { Repositories } from '../db/repositories'
import type { EventBus } from '../events'
import type { ActionService } from '../integrations/ActionService'
import type { WorktreeManager } from '../git/Worktrees'
import { DEFAULT_PRESET_ID, getPreset, launchOptionsFor } from '../skills/launchPresets'
import { resolvePresetId } from '../skills/taskRouter'
import { AgentSession, type SessionDeps } from './AgentSession'
import type { LifecycleAutomation } from './LifecycleAutomation'

interface PendingSpawn {
  session: AgentSession
  prompt: string
  kind: 'start' | 'resume' | 'fork'
}

const LIVE_STATUSES = ['queued', 'running', 'awaiting_input', 'awaiting_plan_approval']

/** Hard ceiling on sub-agents a single conductor may spawn (runaway-loop guard). */
const MAX_DELEGATIONS = 25

/**
 * Owns the live AgentSession pool. Enforces a concurrency cap: a live session
 * holds a Claude Code subprocess for its lifetime, so spawns over the cap are
 * queued and started as slots free up (when a session stops/ends/errors).
 */
export class SessionManager {
  private readonly sessions = new Map<string, AgentSession>()
  private readonly pending: PendingSpawn[] = []
  private active = 0
  private readonly deps: SessionDeps

  constructor(
    private readonly repos: Repositories,
    private readonly bus: EventBus,
    private readonly actions: ActionService,
    private readonly worktrees: WorktreeManager,
    private readonly automation: LifecycleAutomation
  ) {
    // Inject the orchestration capability so conductor sessions can fan work out
    // to cheaper sub-agents (the MCP layer stays free of any orchestrator import).
    this.deps = {
      repos,
      bus,
      actions,
      orchestration: {
        delegate: (parentId, input) => this.delegate(parentId, input),
        listChildren: (parentId) => this.listChildren(parentId)
      }
    }
  }

  /** Previously-live sessions can't survive a restart (their subprocess is gone),
   *  so mark them stopped — but their persistent workState is preserved by the
   *  repo, so the board keeps active work resumable instead of burying it in Done.
   *  Also re-register persisted tracker links (the links map is in-memory). */
  reconcileOnStartup(): void {
    for (const s of this.repos.sessions.list()) {
      if (LIVE_STATUSES.includes(s.status)) this.repos.sessions.update(s.id, { status: 'stopped' })
      if (s.linearIssueId || s.notionPageId) {
        this.automation.register(s.id, {
          linearIssueId: s.linearIssueId ?? null,
          notionPageId: s.notionPageId ?? null,
          slackChannel: null,
          autoUpdates: true
        })
      }
    }
  }

  list(): SessionInfo[] {
    return this.repos.sessions.list().map((s) => this.sessions.get(s.id)?.snapshot() ?? s)
  }

  get(id: string): { info: SessionInfo; messages: ReturnType<Repositories['messages']['listBySession']> } | null {
    const info = this.sessions.get(id)?.snapshot() ?? this.repos.sessions.get(id)
    if (!info) return null
    return { info, messages: this.repos.messages.listBySession(id) }
  }

  async spawn(req: SpawnRequest): Promise<SessionInfo> {
    // 'auto' / omitted routes to the right skill by task intent — no slash command.
    const preset = getPreset(resolvePresetId(req.presetId, req.prompt)) ?? getPreset(DEFAULT_PRESET_ID)!
    const settings = this.repos.settings.get()
    const id = randomUUID()
    const useWorktree = req.useWorktree ?? preset.useWorktree
    const repo = this.repos.repos.getByPath(req.cwd)

    let cwd = req.cwd
    let branch: string | null = null
    let worktreePath: string | null = null
    if (useWorktree) {
      const branchName = req.branchName?.trim() || `multitasker/${preset.id}-${id.slice(0, 8)}`
      const wt = await this.worktrees.create(req.cwd, branchName)
      if (wt) {
        cwd = wt.worktreePath
        branch = wt.branch
        worktreePath = wt.worktreePath
      }
    }

    // Apply any per-preset policy overrides at launch.
    if (preset.policyProfile) {
      for (const [actionType, mode] of Object.entries(preset.policyProfile)) {
        this.repos.policies.setMode(actionType, mode)
      }
    }

    const info: SessionInfo = {
      id,
      sdkSessionId: null,
      title: req.title?.trim() || deriveTitle(req.prompt),
      model: req.model ?? settings.defaultModel,
      cwd,
      repoId: repo?.id ?? null,
      branch,
      worktreePath,
      status: 'queued',
      permissionMode: req.permissionMode ?? preset.permissionMode,
      presetId: preset.id,
      totalCostUsd: 0,
      numTurns: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      error: null,
      workState: 'active',
      linearIssueId: req.linearIssueId ?? null,
      notionPageId: req.notionPageId ?? null,
      parentId: req.parentId ?? null
    }
    this.repos.sessions.insert(info)
    this.bus.emit({ channel: 'session:updated', payload: info })

    // Per-task context (.md) for memory optimization / context min-maxing: prime
    // the agent with the task + the most relevant slice of PROJECT memory. In a
    // worktree it's written as a git-invisible CLAUDE.local.md (Claude Code
    // auto-loads it, localized to this task); otherwise it's appended to the
    // session's system prompt. Best-effort — never blocks a spawn.
    let systemPromptAppend = preset.systemPromptAppend
    try {
      const root = await projectRoot(req.cwd)
      const brief = buildTaskBrief({ title: info.title, issueIdentifier: req.linearIssueId ?? null, notes: recall(root, undefined, 5) })
      if (worktreePath) await writeWorktreeBrief(worktreePath, brief)
      else systemPromptAppend = `${preset.systemPromptAppend}\n\n${brief}`
    } catch {
      // fall back to the plain preset prompt
    }

    const session = new AgentSession(this.deps, info, {
      systemPromptAppend,
      isBuildPipeline: Boolean(preset.isBuildPipeline)
    })
    this.sessions.set(id, session)
    this.automation.register(id, {
      linearIssueId: req.linearIssueId ?? null,
      notionPageId: req.notionPageId ?? null,
      slackChannel: req.slackChannel ?? null,
      autoUpdates: req.autoUpdates ?? true
    })
    // GitHub branching: when a branch name was supplied (e.g. from a Linear
    // issue), push it to origin through the policy engine (no-op if no remote).
    if (worktreePath && branch && req.branchName?.trim()) {
      void this.actions.propose({
        sessionId: id,
        actionType: 'github.push_branch',
        summary: `Push branch ${branch}`,
        payload: { cwd: worktreePath, branch }
      })
    }
    this.enqueue({ session, prompt: req.prompt, kind: 'start' })
    return session.snapshot()
  }

  steer(id: string, text: string): void {
    this.sessions.get(id)?.steer(text)
  }

  approvePlan(id: string, approved: boolean, feedback?: string): void {
    this.sessions.get(id)?.approvePlan(approved, feedback)
  }

  stop(id: string): void {
    this.sessions.get(id)?.stop()
  }

  markLanded(id: string): void {
    this.sessions.get(id)?.markLanded()
  }

  /** Mark a session's work done: stop its subprocess (freeing its slot) and move
   *  it to the Done lane. Works whether the session is live or already stopped. */
  markDone(id: string): void {
    const live = this.sessions.get(id)
    if (live) {
      live.markDone()
    } else {
      const updated = this.repos.sessions.update(id, { status: 'stopped', workState: 'done' })
      if (updated) this.bus.emit({ channel: 'session:updated', payload: updated })
    }
  }

  // --- agentic orchestration (conductor → sub-agents) ----------------------

  /** Spawn a sub-agent for a conductor. The child runs on the cheaper delegate
   *  model, in the conductor's working directory (shared worktree), linked by
   *  parentId. Goes through the same cap/queue as any session. */
  private async delegate(
    parentId: string,
    input: { title?: string; prompt: string; model?: string }
  ): Promise<{ id: string; title: string; status: string }> {
    // Fail-safe: bound how many sub-agents one conductor can spawn so a runaway
    // delegation loop can't fill the queue with unbounded sessions.
    const existing = this.repos.sessions.list().filter((s) => s.parentId === parentId).length
    if (existing >= MAX_DELEGATIONS) {
      return { id: '', title: input.title ?? '', status: `refused — delegation limit (${MAX_DELEGATIONS}) reached` }
    }
    const parent = this.repos.sessions.get(parentId)
    const settings = this.repos.settings.get()
    // Pick the cheapest capable tier for this sub-task: an explicit model wins,
    // else auto-tier from the prompt (Haiku research / Sonnet code / Opus
    // orchestrate), else the configured delegate default. This is the "cheaper
    // models for sub-tasks" optimization, applied per delegation automatically.
    const model = input.model ?? recommendModelForSubtask(input.prompt) ?? settings.delegateModel ?? 'sonnet'
    const child = await this.spawn({
      prompt: input.prompt,
      cwd: parent?.cwd ?? process.cwd(),
      presetId: 'explore', // sub-agents are plain workers
      model,
      title: input.title,
      parentId,
      useWorktree: false // share the conductor's worktree so sub-agents collaborate
    })
    return { id: child.id, title: child.title, status: child.status }
  }

  /** Snapshot of a conductor's sub-agents — status + a short tail of output so
   *  the conductor can coordinate or synthesize. */
  private listChildren(parentId: string): { id: string; title: string; status: string; summary: string }[] {
    return this.list()
      .filter((s) => s.parentId === parentId)
      .map((s) => ({ id: s.id, title: s.title, status: s.status, summary: this.lastAssistantText(s.id) }))
  }

  private lastAssistantText(sessionId: string): string {
    const msgs = this.repos.messages.listBySession(sessionId)
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].kind !== 'assistant') continue
      const text = msgs[i].blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join(' ')
        .trim()
      if (text) return text.length > 280 ? `${text.slice(0, 280)}…` : text
    }
    return ''
  }

  /** Remove a session entirely: stop its subprocess, free its slot, and
   *  hard-delete its row, transcript, and audit entries. */
  delete(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.dispose() // aborts the run loop; whenDone() then frees the active slot
      this.sessions.delete(id)
    }
    // If it was still waiting on the cap, drop it from the queue too.
    const idx = this.pending.findIndex((p) => p.session.id === id)
    if (idx >= 0) this.pending.splice(idx, 1)
    this.repos.messages.deleteBySession(id)
    this.repos.actions.deleteBySession(id)
    this.repos.sessions.delete(id)
    this.bus.emit({ channel: 'session:deleted', payload: { id } })
  }

  /** Pin/unpin a session to the top of its Mission Control lane. */
  setPinned(id: string, pinned: boolean): SessionInfo {
    const updated = this.repos.sessions.setPinned(id, pinned)
    if (!updated) throw new Error(`session not found: ${id}`)
    this.sessions.get(id)?.applyPinned(pinned) // keep the live snapshot in sync
    const info = this.sessions.get(id)?.snapshot() ?? updated
    this.bus.emit({ channel: 'session:updated', payload: info })
    return info
  }

  /** Stop idle (awaiting_input) sessions to free their held concurrency slots. */
  reclaimIdle(): number {
    const ids = idleSessionIds(this.list())
    for (const id of ids) this.stop(id)
    return ids.length
  }

  resume(id: string): SessionInfo {
    const info = this.repos.sessions.get(id)
    if (!info) throw new Error(`session not found: ${id}`)
    let session = this.sessions.get(id)
    if (!session) {
      session = new AgentSession(this.deps, info, launchOptionsFor(info.presetId))
      this.sessions.set(id, session)
    }
    this.enqueue({ session, prompt: '', kind: 'resume' })
    return session.snapshot()
  }

  fork(id: string): SessionInfo {
    const src = this.repos.sessions.get(id)
    if (!src) throw new Error(`session not found: ${id}`)
    const newId = randomUUID()
    const info: SessionInfo = {
      ...src,
      id: newId,
      title: `${src.title} (fork)`,
      status: 'queued',
      workState: 'active', // fresh run; tracker link inherited via ...src
      totalCostUsd: 0,
      numTurns: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      error: null
    }
    this.repos.sessions.insert(info)
    this.bus.emit({ channel: 'session:updated', payload: info })
    const session = new AgentSession(this.deps, info, launchOptionsFor(info.presetId))
    this.sessions.set(newId, session)
    this.enqueue({ session, prompt: '', kind: 'fork' })
    return session.snapshot()
  }

  // --- concurrency cap -----------------------------------------------------

  private enqueue(item: PendingSpawn): void {
    if (this.active < this.cap()) this.startItem(item)
    else this.pending.push(item)
  }

  private startItem(item: PendingSpawn): void {
    this.active += 1
    if (item.kind === 'start') item.session.start(item.prompt)
    else item.session.resume(item.prompt, item.kind === 'fork')
    void item.session.whenDone().finally(() => {
      this.active -= 1
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < this.cap() && this.pending.length > 0) {
      this.startItem(this.pending.shift()!)
    }
  }

  private cap(): number {
    return Math.max(1, this.repos.settings.get().concurrencyCap)
  }
}

function deriveTitle(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 8).join(' ')
  return words.length > 60 ? `${words.slice(0, 57)}…` : words || 'Untitled session'
}
