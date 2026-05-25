import { randomUUID } from 'node:crypto'
import type { SessionInfo, SpawnRequest } from '@shared/types'
import { idleSessionIds } from '@shared/board'
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
    this.deps = { repos, bus, actions }
  }

  /** Previously-live sessions can't survive a restart (their subprocess is gone). */
  reconcileOnStartup(): void {
    for (const s of this.repos.sessions.list()) {
      if (LIVE_STATUSES.includes(s.status)) this.repos.sessions.update(s.id, { status: 'stopped' })
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
      error: null
    }
    this.repos.sessions.insert(info)
    this.bus.emit({ channel: 'session:updated', payload: info })

    const session = new AgentSession(this.deps, info, {
      systemPromptAppend: preset.systemPromptAppend,
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
