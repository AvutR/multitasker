import { randomUUID } from 'node:crypto'
import type { SessionInfo, SpawnRequest } from '@shared/types'
import { idleSessionIds, isTerminalStatus } from '@shared/board'
import { classifySubtask, recommendModelForSubtask, tierForKind, TASK_KINDS } from '@shared/modelTier'
import { computeBlastRadius, reviewVerdict } from '@shared/blastRadius'
import { buildTaskBrief } from '@shared/taskBrief'
import { recall } from '../integrations/agentMemory'
import { learn, recallSkills } from '../integrations/brainStore'
import { formatSkillsForBrief } from '@shared/brain'
import { projectRoot } from '../util/projectRoot'
import { writeWorktreeBrief } from '../util/taskBriefFile'
import type { Repositories } from '../db/repositories'
import type { EventBus } from '../events'
import type { ActionService } from '../integrations/ActionService'
import { computeDiff, type WorktreeManager } from '../git/Worktrees'
import { DEFAULT_PRESET_ID, getPreset, launchOptionsFor } from '../skills/launchPresets'
import { resolvePresetId } from '../skills/taskRouter'
import { AgentSession, type SessionDeps, type SessionLaunchOptions } from './AgentSession'
import { CliSessionRunner } from './CliSessionRunner'
import type { SessionRunner } from './SessionRunner'
import { engineBinPath } from '../engines'
import type { EngineId } from '@shared/engines'
import type { LifecycleAutomation } from './LifecycleAutomation'

interface PendingSpawn {
  session: SessionRunner
  prompt: string
  kind: 'start' | 'resume' | 'fork'
}

const LIVE_STATUSES = ['queued', 'running', 'awaiting_input', 'awaiting_plan_approval']

/** Hard ceiling on sub-agents a single conductor may spawn (runaway-loop guard). */
const MAX_DELEGATIONS = 25

/** Max delegation tree depth — bounds cross-provider spin-off (children recruiting
 *  via the `mt` bridge) so a fan-out can't recurse without bound. */
const MAX_DELEGATION_DEPTH = 3

/** One tier cheaper for the over-budget guardrail; haiku is the floor, and any
 *  non-tier model id (gateway/fable/bedrock/…) is left untouched. */
function downshiftTier(model: string): string {
  if (model === 'opus') return 'sonnet'
  if (model === 'sonnet') return 'haiku'
  return model
}

/** Render a conductor's proposed decomposition as a plan the user can approve —
 *  each sub-task with the model tier it would run on (so the cost is legible). */
function formatDecomposition(subtasks: { title: string; kind?: string }[]): string {
  if (!subtasks.length) return 'Proposed decomposition: (none)\n\nApprove to proceed, or reject with feedback.'
  const lines = subtasks.map((t, i) => {
    const kind = t.kind && (TASK_KINDS as string[]).includes(t.kind) ? (t.kind as (typeof TASK_KINDS)[number]) : classifySubtask(t.title)
    const tier = kind ? tierForKind(kind) : 'sonnet'
    return `${i + 1}. [${tier}] ${t.title}${t.kind ? ` · ${t.kind}` : ''}`
  })
  return `Proposed decomposition — ${subtasks.length} parallel sub-agent${subtasks.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}\n\nApprove to fan out exactly these, or reject with feedback to revise.`
}

/**
 * Owns the live AgentSession pool. Enforces a concurrency cap: a live session
 * holds a Claude Code subprocess for its lifetime, so spawns over the cap are
 * queued and started as slots free up (when a session stops/ends/errors).
 */
export class SessionManager {
  private readonly sessions = new Map<string, SessionRunner>()
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
        listChildren: (parentId) => this.listChildren(parentId),
        waitForChildren: (parentId, childIds) => this.waitForChildren(parentId, childIds),
        proposePlan: (parentId, subtasks) => this.proposePlan(parentId, subtasks)
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
    const engine = req.engine ?? 'claude'
    // CLI engines aren't policy-intercepted on their own tool calls, so isolate
    // them in a worktree by default (their edits stay contained + reviewable).
    const useWorktree = req.useWorktree ?? (engine !== 'claude' ? true : preset.useWorktree)
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

    const title = req.title?.trim() || deriveTitle(req.prompt)

    // Per-task context (.md) for memory optimization / context min-maxing: prime
    // the agent with the task + the most relevant slice of PROJECT memory. In a
    // worktree it's written as a git-invisible CLAUDE.local.md (Claude Code
    // auto-loads it, localized to this task); otherwise it's appended to the
    // session's system prompt. The brief is persisted on the session so the UI
    // can show exactly what context primed it. Best-effort — never blocks a spawn.
    let systemPromptAppend = preset.systemPromptAppend
    let taskBrief: string | null = null
    try {
      const root = await projectRoot(req.cwd)
      // Prefer notes RELEVANT to this task (overlap with the prompt+title) over the
      // 5 most-recent; fall back to recency when nothing is relevant. A delegated
      // sub-agent thus gets context on ITS sub-task, not the newest global chatter.
      const relevant = recall(root, `${title} ${req.prompt}`, 5)
      const notes = relevant.length ? relevant : recall(root, undefined, 5)
      taskBrief = buildTaskBrief({ title, issueIdentifier: req.linearIssueId ?? null, notes })
      // Prime the agent with the brain's most relevant LEARNED SKILLS (bumps their
      // reuse) — so it reuses past work instead of re-deriving it (fewer tokens).
      const brainSection = formatSkillsForBrief(recallSkills(root, `${title} ${req.prompt}`, 5))
      if (brainSection) taskBrief = `${brainSection}\n\n${taskBrief}`
      if (worktreePath) await writeWorktreeBrief(worktreePath, taskBrief)
      else systemPromptAppend = `${preset.systemPromptAppend}\n\n${taskBrief}`
    } catch {
      // fall back to the plain preset prompt
    }

    const info: SessionInfo = {
      id,
      sdkSessionId: null,
      title,
      engine,
      // Claude defaults to the configured model alias; a CLI engine with no model
      // falls through to the tool's own default (null → no --model flag).
      model: req.model ?? (engine === 'claude' ? settings.defaultModel : null),
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
      parentId: req.parentId ?? null,
      taskBrief
    }
    this.repos.sessions.insert(info)
    this.bus.emit({ channel: 'session:updated', payload: info })

    // Depth cap: only TOP-LEVEL sessions orchestrate. A delegated sub-agent
    // (parentId set) is a plain worker with NO delegate capability, so a fan-out
    // can't recurse into a 25^depth session explosion (the per-parent
    // MAX_DELEGATIONS only bounds one level).
    const deps = req.parentId ? { ...this.deps, orchestration: undefined } : this.deps
    const session = this.makeRunner(deps, info, {
      systemPromptAppend,
      isBuildPipeline: Boolean(preset.isBuildPipeline),
      // A delegated sub-agent (parentId set; only delegate() spawns with one) is a
      // single-shot worker: one task, then terminate. Frees its slot promptly and
      // lets the conductor's wait_for_subtasks observe a real terminal status.
      singleShot: Boolean(req.parentId)
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
    this.stopChildren(id)
    this.sessions.get(id)?.stop()
  }

  /** Abort a conductor's live sub-agents (recursively) so ending a conductor
   *  doesn't leave orphaned children spending with no one to synthesize them. */
  private stopChildren(parentId: string): void {
    for (const child of this.sessions.values()) {
      if (child.snapshot().parentId === parentId) {
        this.stopChildren(child.id) // grandchildren first
        child.stop()
      }
    }
  }

  markLanded(id: string): void {
    this.sessions.get(id)?.markLanded()
  }

  /** Mark a session's work done: stop its subprocess (freeing its slot) and move
   *  it to the Done lane. Works whether the session is live or already stopped. */
  markDone(id: string): void {
    this.stopChildren(id) // the workstream is done — end its sub-agents too
    const live = this.sessions.get(id)
    if (live) {
      live.markDone()
    } else {
      const updated = this.repos.sessions.update(id, { status: 'stopped', workState: 'done' })
      if (updated) this.bus.emit({ channel: 'session:updated', payload: updated })
    }
  }

  // --- agentic orchestration (conductor → sub-agents) ----------------------

  /** Conductor pre-flight gate: format the proposed decomposition (each sub-task
   *  with its inferred model tier) and BLOCK on the user's one-click approval, so
   *  the fan-out's spend is approved before any sub-agent spawns. */
  private proposePlan(parentId: string, subtasks: { title: string; kind?: string }[]): Promise<{ approved: boolean; feedback?: string }> {
    const session = this.sessions.get(parentId)
    if (!session) return Promise.resolve({ approved: true }) // no live conductor → nothing to gate
    return session.proposePlan(formatDecomposition(subtasks))
  }

  /** Public spawn entrypoint for the cross-provider `mt` bridge — an agent of any
   *  provider recruiting a sub-agent of any provider. Same bounds as delegate(). */
  async spawnSubAgent(parentId: string, input: { engine?: string; prompt: string; title?: string }): Promise<{ id: string; title: string; status: string }> {
    if (!this.repos.sessions.get(parentId)) return { id: '', title: input.title ?? '', status: 'refused — unknown parent session' }
    return this.delegate(parentId, input)
  }

  /** How many parentId hops to the root (0 = top-level). Cycle-safe. */
  private depthOf(id: string): number {
    let depth = 0
    let cur = this.repos.sessions.get(id)
    const seen = new Set<string>([id])
    while (cur?.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId)
      depth++
      cur = this.repos.sessions.get(cur.parentId)
    }
    return depth
  }

  /** Spawn a sub-agent for a conductor. The child runs on the cheaper delegate
   *  model, in the conductor's working directory (shared worktree), linked by
   *  parentId. Goes through the same cap/queue as any session. */
  private async delegate(
    parentId: string,
    input: { title?: string; prompt: string; model?: string; kind?: string; engine?: string }
  ): Promise<{ id: string; title: string; status: string }> {
    // Fail-safe: bound how many sub-agents one conductor can spawn so a runaway
    // delegation loop can't fill the queue with unbounded sessions.
    const existing = this.repos.sessions.list().filter((s) => s.parentId === parentId).length
    if (existing >= MAX_DELEGATIONS) {
      return { id: '', title: input.title ?? '', status: `refused — delegation limit (${MAX_DELEGATIONS}) reached` }
    }
    // Depth bound: cross-provider spin-off lets children recruit too — cap tree depth.
    if (this.depthOf(parentId) >= MAX_DELEGATION_DEPTH) {
      return { id: '', title: input.title ?? '', status: `refused — max delegation depth (${MAX_DELEGATION_DEPTH}) reached` }
    }
    const parent = this.repos.sessions.get(parentId)
    const settings = this.repos.settings.get()
    // Per-conductor budget: a hard $ ceiling on ONE orchestration's fan-out (count
    // ≠ cost — 25 Opus children ≠ 25 Haiku lookups). Refuse new delegations once
    // the subtree's spend crosses it, so a conductor can't quietly run up the bill.
    if (settings.delegateBudgetUsd && settings.delegateBudgetUsd > 0) {
      const subtreeSpend = this.subtreeCost(parentId)
      if (subtreeSpend >= settings.delegateBudgetUsd) {
        return { id: '', title: input.title ?? '', status: `refused — conductor budget ($${settings.delegateBudgetUsd}) reached ($${subtreeSpend.toFixed(2)} spent)` }
      }
    }
    // Pick the model for this sub-task. Order of confidence:
    //   explicit model > (auto strategy only:) judged kind > keyword auto-detect
    //   > the configured delegate default.
    // 'auto' (default) tiers by task kind — the conductor judges `kind`, we map it,
    // else infer from the prompt. 'fixed' skips tiering and always uses delegateModel,
    // giving the user full control over sub-agent model assignment.
    // Heterogeneous fan-out: a sub-task can run on ANOTHER installed engine
    // (cursor/codex/…) — models from different providers in unison. Refuse if the
    // requested engine isn't installed (so the conductor gets a clear signal).
    const engine = input.engine ?? 'claude'
    if (engine !== 'claude' && !engineBinPath(engine as EngineId)) {
      return { id: '', title: input.title ?? '', status: `refused — engine "${engine}" is not installed` }
    }
    // Claude tiering only applies to Claude sub-agents; for another engine, use the
    // conductor-supplied model (or the tool's own default).
    const judged = input.kind && (TASK_KINDS as string[]).includes(input.kind) ? tierForKind(input.kind as (typeof TASK_KINDS)[number]) : null
    const autoTier = engine === 'claude' && (settings.tieringStrategy ?? 'auto') === 'auto' ? (judged ?? recommendModelForSubtask(input.prompt)) : null
    let model = input.model ?? autoTier ?? (engine === 'claude' ? settings.delegateModel ?? 'sonnet' : undefined)
    // Active budget guardrail: once spend crosses the soft budget, downshift
    // newly-delegated Claude sub-agents one tier cheaper (opt-in 'downshift' mode).
    if (engine === 'claude' && model && settings.overBudgetMode === 'downshift' && settings.budgetUsd && settings.budgetUsd > 0) {
      const spent = this.repos.sessions.list().reduce((sum, s) => sum + s.totalCostUsd, 0)
      if (spent >= settings.budgetUsd) model = downshiftTier(model)
    }
    const child = await this.spawn({
      prompt: input.prompt,
      cwd: parent?.cwd ?? process.cwd(),
      presetId: 'explore', // sub-agents are plain workers
      engine,
      model,
      title: input.title,
      // Inherit (never weaken) the conductor's permission mode — delegation must
      // not silently de-escalate a plan-gated conductor into ungated children.
      permissionMode: parent?.permissionMode,
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

  /** Block until the named children (or all of a conductor's children) reach a
   *  terminal state, then return their summaries. Event-driven with a safety
   *  timeout so a stuck sub-agent can't hang the conductor forever. */
  private waitForChildren(parentId: string, childIds?: string[], timeoutMs = 15 * 60_000): Promise<{ id: string; title: string; status: string; summary: string }[]> {
    const targets =
      childIds && childIds.length
        ? childIds
        : this.repos.sessions.list().filter((s) => s.parentId === parentId).map((s) => s.id)
    const result = () => this.listChildren(parentId).filter((c) => targets.includes(c.id))
    const allDone = () =>
      targets.every((id) => {
        const s = this.repos.sessions.get(id)
        return !s || isTerminalStatus(s.status)
      })

    if (targets.length === 0 || allDone()) return Promise.resolve(result())

    // The conductor is parked here holding a concurrency slot. Release it for the
    // duration of the wait so its (possibly queued) children can actually start —
    // otherwise a fan-out wider than the free slots DEADLOCKS until the timeout
    // (the conductor holds a slot waiting for children that can't get a slot).
    // Re-acquire on finish so the conductor's own slot is still counted exactly
    // once (its whenDone() does the final decrement when it ultimately ends).
    // Guard on `sessions.has`: a live conductor (always true when called via the
    // MCP tool) holds a counted slot; a direct/test call on a bare row does not.
    const holdsSlot = this.sessions.has(parentId)
    if (holdsSlot) {
      this.active -= 1
      this.pump()
    }

    return new Promise((resolve) => {
      let unsub: (() => void) | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      const finish = () => {
        if (settled) return // guard: re-acquire the slot exactly once
        settled = true
        unsub?.()
        if (timer) clearTimeout(timer)
        if (holdsSlot) {
          this.active += 1
          this.pump()
        }
        resolve(result())
      }
      unsub = this.bus.onEvent((e) => {
        if ((e.channel === 'session:updated' || e.channel === 'session:deleted') && allDone()) finish()
      })
      timer = setTimeout(finish, timeoutMs)
    })
  }

  /** Total spend across a conductor and all its descendants (the orchestration
   *  subtree). Recursive so it stays correct even if the depth policy changes. */
  private subtreeCost(rootId: string): number {
    const all = this.repos.sessions.list()
    const sum = (id: string): number => {
      const self = all.find((s) => s.id === id)?.totalCostUsd ?? 0
      return all.filter((s) => s.parentId === id).reduce((acc, s) => acc + sum(s.id), self)
    }
    return sum(rootId)
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
      // Hand the conductor enough of each sub-agent's conclusion to synthesize
      // WITHOUT re-delegating for lack of signal; 280 chars truncated real work.
      if (text) return text.length > 1200 ? `${text.slice(0, 1200)}…` : text
    }
    return ''
  }

  /** Remove a session entirely: stop its subprocess, free its slot, and
   *  hard-delete its row, transcript, and audit entries. */
  delete(id: string): void {
    this.stopChildren(id) // don't leave sub-agents running once the parent is gone
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
    this.repos.reviews.deleteBySession(id)
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
    const session = this.makeRunner(this.deps, info, launchOptionsFor(info.presetId))
    this.sessions.set(newId, session)
    this.enqueue({ session, prompt: '', kind: 'fork' })
    return session.snapshot()
  }

  /** Pick the engine implementation for a session: the Claude Agent SDK
   *  (AgentSession — full policy/plan gating + integration tools) or a spawned
   *  CLI coding tool (CliSessionRunner — Cursor, Codex, …). */
  private makeRunner(deps: SessionDeps, info: SessionInfo, launch: SessionLaunchOptions): SessionRunner {
    const engine = (info.engine ?? 'claude') as EngineId
    if (engine === 'claude') return new AgentSession(deps, info, launch)
    const binPath = engineBinPath(engine)
    if (!binPath) throw new Error(`Engine "${engine}" is not installed (no binary found on PATH).`)
    return new CliSessionRunner({ repos: deps.repos, bus: deps.bus }, info, engine, binPath)
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
      void this.recordVerdict(item.session.id) // triage the finished diff for the review queue
    })
  }

  /** When a top-level session finishes, score its diff (blast radius → verdict) so
   *  the review queue surfaces the risky work first. Free + deterministic; the
   *  verdict is an optimization, so failures are swallowed. */
  private async recordVerdict(id: string): Promise<void> {
    try {
      const info = this.repos.sessions.get(id)
      // Only completed TOP-LEVEL work — sub-agents share the parent's worktree, so
      // the parent's verdict covers the whole change.
      if (!info || info.status !== 'completed' || info.parentId) return
      const files = await computeDiff(info.cwd)
      if (!files.length) return // nothing changed → nothing to review
      const radius = computeBlastRadius(files)
      const updated = this.repos.sessions.update(id, { reviewVerdict: reviewVerdict(radius) })
      if (updated) this.bus.emit({ channel: 'session:updated', payload: updated })
      // Free brain skill: a "where" map of which subsystems this task touched, so
      // future tasks in the same space recall the layout instead of re-discovering it.
      if (radius.subsystems.length) {
        const root = await projectRoot(info.cwd)
        learn(root, {
          kind: 'map',
          title: info.title.slice(0, 80),
          body: `Touched ${radius.subsystems.join(', ')} (${files.length} file${files.length === 1 ? '' : 's'}).`,
          sessionId: id
        })
      }
    } catch {
      // best-effort — never let verdict scoring or brain writes disturb the run lifecycle
    }
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
