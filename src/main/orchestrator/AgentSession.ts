import { randomUUID } from 'node:crypto'
import type { ContentBlock, SessionInfo, TranscriptKind, TranscriptMessage } from '@shared/types'
import type { Repositories } from '../db/repositories'
import type { EventBus } from '../events'
import type { ActionService } from '../integrations/ActionService'
import { createConnectorGate, type GateDecision } from '../integrations/guards'
import { createIntegrationMcpServer, type Orchestration } from '../integrations/integrationMcpServer'
import { resolveModel } from '../models'
import { claudeExecutablePath } from '../sdkRuntime'
import { projectRoot } from '../util/projectRoot'
import { AsyncQueue } from '../util/AsyncQueue'
import { assistantBlocks, extractDelta, isExitPlanTool, userBlocks } from './sdkMapping'

export interface SessionDeps {
  repos: Repositories
  bus: EventBus
  actions: ActionService
  /** Present so conductor sessions can delegate to cheaper sub-agents. */
  orchestration?: Orchestration
}

export interface SessionLaunchOptions {
  systemPromptAppend: string
  isBuildPipeline: boolean
  /** A delegated sub-agent: runs ONE task then terminates (never steered), so it
   *  frees its slot and reaches a terminal status the conductor's wait can see. */
  singleShot?: boolean
}

interface PlanDecision {
  approved: boolean
  feedback?: string
}

// The SDK is treated as an untyped edge (its option/message types drift across
// versions); we bind `query` to a minimal local signature so version changes
// can't break our typecheck. All app-internal types remain strict.
type LooseQuery = (args: { prompt: unknown; options: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>

/** Wraps a single live `query()` — its streaming output, steering input queue,
 *  plan-approval gate, and connector policy gate. */
export class AgentSession {
  readonly id: string
  private info: SessionInfo
  // Recreated on each start/resume — both latch permanently once torn down
  // (AsyncQueue.close() closes for good; AbortController.abort() stays aborted),
  // so a stopped session needs a fresh queue AND a fresh controller to run again.
  private queue = new AsyncQueue<unknown>()
  private abort = new AbortController()
  // The initial user prompt, retained so a transient PRE-init failure can be
  // safely retried by rebuilding the input (null for a no-prompt wake).
  private firstPrompt: string | null = null
  private readonly gate: (toolName: string, input: Record<string, unknown>) => Promise<GateDecision>
  private planResolver: ((d: PlanDecision) => void) | null = null
  private donePromise: Promise<void> = Promise.resolve()
  // Once disposed, all persistence/emits are silenced so a deleted session can't
  // resurrect via a trailing event from its still-unwinding run loop.
  private destroyed = false

  constructor(
    private readonly deps: SessionDeps,
    info: SessionInfo,
    private readonly launch: SessionLaunchOptions
  ) {
    this.id = info.id
    this.info = info
    this.gate = createConnectorGate(deps.actions, info.id)
  }

  snapshot(): SessionInfo {
    return { ...this.info }
  }

  whenDone(): Promise<void> {
    return this.donePromise
  }

  /** Begin the run with an initial prompt (fresh spawn). */
  start(prompt: string): void {
    this.queue = new AsyncQueue<unknown>()
    this.abort = new AbortController()
    this.firstPrompt = prompt
    this.queue.push(userMessage(prompt))
    this.donePromise = this.run(undefined)
  }

  /**
   * Resume (or fork) an existing SDK session.
   *  Resuming in place or forking, supplying NO prompt is a "wake": we reattach
   *  (fork: branch) the SDK session but feed it NO message, so the run loop parks
   *  on the open queue in `awaiting_input`. Nothing runs until the user steers —
   *  their first message is what starts the work, in the fully-resumed context.
   *  Mirrors the no-autostart rule for tracker issues: no action without a prompt
   *  from the user. (A non-empty prompt — not used by the UI today — runs at once.)
   */
  resume(prompt: string, fork: boolean): void {
    this.queue = new AsyncQueue<unknown>()
    this.abort = new AbortController()
    const wake = prompt.trim().length === 0
    this.firstPrompt = wake ? null : prompt
    if (!wake) this.queue.push(userMessage(prompt))
    this.donePromise = this.run({ resume: this.info.sdkSessionId ?? undefined, fork, wake })
  }

  steer(text: string): void {
    if (this.queue.isClosed) return
    this.queue.push(userMessage(text))
    this.patch({ status: 'running' })
  }

  stop(): void {
    this.abort.abort()
    // Unblock a plan gate that's parked in canUseTool, else run() never ends
    // and the concurrency slot leaks.
    this.planResolver?.({ approved: false })
    this.planResolver = null
    this.queue.close()
    if (this.info.status !== 'error') this.patch({ status: 'stopped' })
  }

  approvePlan(approved: boolean, feedback?: string): void {
    const resolve = this.planResolver
    this.planResolver = null
    resolve?.({ approved, feedback })
  }

  /** Mark a /build session as landed once a verified local commit was made. */
  markLanded(): void {
    this.patch({ status: 'landed' })
  }

  /** Mark the work done: free the subprocess and set the persistent workState to
   *  'done' so the task leaves Idle for the Done lane (status stopped preserves
   *  workState, so we pass 'done' explicitly). */
  markDone(): void {
    this.patch({ status: 'stopped', workState: 'done' })
    this.abort.abort()
    this.queue.close()
  }

  /** Tear down for deletion: abort the subprocess and silence any late events. */
  dispose(): void {
    this.destroyed = true
    this.abort.abort()
    this.planResolver?.({ approved: false })
    this.planResolver = null
    this.queue.close()
  }

  /** Sync the pinned flag into the in-memory snapshot (the repo owns persistence). */
  applyPinned(pinned: boolean): void {
    this.info = { ...this.info, pinned }
  }

  // --- run loop ------------------------------------------------------------

  private async run(resume: { resume?: string; fork: boolean; wake?: boolean } | undefined): Promise<void> {
    // Capture THIS run's controller synchronously (start/resume just made a fresh
    // one). A still-unwinding prior run keeps its own captured controller, so the
    // catch below classifies stop-vs-error against the right signal.
    const abort = this.abort
    const sdk = (await import('@anthropic-ai/claude-agent-sdk')) as { query: unknown }
    const query = sdk.query as LooseQuery
    // Key memory by the PROJECT root (not the worktree), so a conductor, its
    // sub-agents, and any session on the same repo share one project memory.
    const memoryRoot = await projectRoot(this.info.cwd)
    const integrationServer = createIntegrationMcpServer(this.deps.actions, this.info.id, {
      orchestration: this.deps.orchestration,
      memoryRoot
    })
    // A wake (bare resume or fork) parks here in awaiting_input until the user
    // steers; every other run begins working immediately.
    this.patch({ status: resume?.wake ? 'awaiting_input' : 'running' })

    const options: Record<string, unknown> = {
      cwd: this.info.cwd,
      permissionMode: this.info.permissionMode,
      // settingSources loads the user's installed skills/agents/commands into
      // every session — this is what makes Claude Code skills available by default.
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      abortController: abort,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: this.launch.systemPromptAppend },
      // createSdkMcpServer already returns the full { type:'sdk', name, instance }
      // config — pass it through directly. Wrapping it again points `.instance`
      // at the config object, and the SDK then calls `.connect` on the wrong
      // thing ("Q.connect is not a function").
      mcpServers: {
        'multitasker-integrations': integrationServer
      },
      canUseTool: this.canUseTool
    }
    // Use the installed claude binary (the SDK can't spawn its bundled CLI from inside an asar).
    const claudePath = claudeExecutablePath()
    if (claudePath) options.pathToClaudeCodeExecutable = claudePath
    // Resolve the selected model to its SDK model string + any provider env.
    const { sdkModel, env } = resolveModel(this.info.model, this.deps.repos.settings.get())
    options.model = sdkModel
    if (env) {
      // The SDK's `env` REPLACES the subprocess environment, so carry process.env forward.
      const merged: Record<string, string> = {}
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) merged[k] = v
      options.env = { ...merged, ...env }
    }
    if (resume?.resume) {
      options.resume = resume.resume
      if (resume.fork) options.forkSession = true
    }

    for (let attempt = 0; ; attempt++) {
      try {
        for await (const msg of query({ prompt: this.queue, options })) {
          this.handle(msg)
        }
        if (this.info.status !== 'stopped' && this.info.status !== 'landed') {
          this.patch({ status: 'completed' })
        }
        return
      } catch (err) {
        if (abort.signal.aborted) {
          this.patch({ status: 'stopped' })
          return
        }
        const cls = classifyError(err)
        const prompt = this.firstPrompt
        // Auto-recover ONLY a transient failure that hit BEFORE the session
        // initialized (no sdkSessionId yet) — the prompt was never processed, so a
        // clean restart with backoff is safe and idempotent. A mid-run failure
        // (sdkSessionId set) is surfaced with an actionable message for one-click
        // Resume, rather than risking a duplicated/corrupted turn on auto-retry.
        if (cls.transient && !this.info.sdkSessionId && prompt != null && attempt < MAX_STARTUP_RETRIES) {
          const resumed = await this.backoff(1000 * 2 ** attempt, abort) // 1s, 2s, 4s
          if (!resumed) {
            this.patch({ status: 'stopped' }) // aborted during backoff
            return
          }
          this.queue = new AsyncQueue<unknown>() // the failed attempt may have drained the input
          this.queue.push(userMessage(prompt))
          continue
        }
        this.patch({ status: 'error', error: cls.message })
        return
      }
    }
  }

  /** Abortable backoff sleep. Resolves true after `ms`, or false if aborted. */
  private backoff(ms: number, abort: AbortController): Promise<boolean> {
    return new Promise((resolve) => {
      if (abort.signal.aborted) return resolve(false)
      const onAbort = () => {
        clearTimeout(timer)
        resolve(false)
      }
      const timer = setTimeout(() => {
        abort.signal.removeEventListener('abort', onAbort)
        resolve(true)
      }, ms)
      abort.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  // canUseTool is the single permission authority: the plan-approval gate for
  // ExitPlanMode, and the connector policy gate for raw connector writes.
  private canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    if (isExitPlanTool(toolName)) {
      const plan = typeof input?.plan === 'string' ? input.plan : ''
      const decision = await this.requestPlanApproval(plan)
      if (decision.approved) return { behavior: 'allow', updatedInput: input }
      return {
        behavior: 'deny',
        message: decision.feedback ?? 'Plan rejected — revise the approach and present a new plan.'
      }
    }

    const decision = await this.gate(toolName, input)
    if (decision.allow) return { behavior: 'allow', updatedInput: input }
    return { behavior: 'deny', message: decision.message ?? 'Blocked by Multitasker policy' }
  }

  /** Emit a plan-approval request and BLOCK until the user decides (or the session
   *  is stopped → denial). Shared by the ExitPlanMode gate and the conductor's
   *  propose_plan pre-flight gate; patches status around the wait. */
  private requestPlanApproval(plan: string): Promise<PlanDecision> {
    this.patch({ status: 'awaiting_plan_approval' })
    this.deps.bus.emit({
      channel: 'session:planRequest',
      payload: { sessionId: this.info.id, plan, requestedAt: Date.now() }
    })
    return new Promise<PlanDecision>((resolve) => {
      this.planResolver = resolve
      if (this.abort.signal.aborted) resolve({ approved: false })
      else this.abort.signal.addEventListener('abort', () => resolve({ approved: false }), { once: true })
    }).then((decision) => {
      this.patch({ status: 'running' })
      return decision
    })
  }

  /** Conductor pre-flight gate: present the decomposition for human approval
   *  BEFORE any sub-agent spawns, so the fan-out's spend is approved, not trusted. */
  proposePlan(plan: string): Promise<PlanDecision> {
    return this.requestPlanApproval(plan)
  }

  // --- message routing -----------------------------------------------------

  private handle(msg: Record<string, unknown>): void {
    if (this.destroyed) return
    switch (msg.type) {
      case 'system': {
        const patch: Partial<SessionInfo> = {}
        if (typeof msg.session_id === 'string' && !this.info.sdkSessionId) patch.sdkSessionId = msg.session_id
        if (typeof msg.model === 'string' && !this.info.model) patch.model = msg.model
        if (Object.keys(patch).length) this.patch(patch)
        break
      }
      case 'assistant': {
        const blocks = assistantBlocks((msg.message as Record<string, unknown>)?.content)
        if (blocks.length) this.persist('assistant', blocks)
        break
      }
      case 'user': {
        const blocks = userBlocks((msg.message as Record<string, unknown>)?.content)
        if (blocks.length) this.persist('user', blocks)
        break
      }
      case 'stream_event':
      case 'partial_assistant': {
        const delta = extractDelta(msg.event ?? msg)
        if (delta) {
          this.deps.bus.emit({ channel: 'session:delta', payload: { sessionId: this.info.id, text: delta } })
        }
        break
      }
      case 'result': {
        const cost = typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : this.info.totalCostUsd
        const turns = typeof msg.num_turns === 'number' ? msg.num_turns : this.info.numTurns
        const subtype = typeof msg.subtype === 'string' ? msg.subtype : 'success'
        const { input, output } = extractTokens(msg.usage)
        this.persist('result', [{ type: 'text', text: resultText(subtype, msg.result) }], {
          resultSubtype: subtype,
          costUsd: cost
        })
        const status = this.info.status === 'landed' ? 'landed' : 'awaiting_input'
        this.patch({
          totalCostUsd: cost,
          numTurns: turns,
          inputTokens: input ?? this.info.inputTokens,
          outputTokens: output ?? this.info.outputTokens,
          status
        })
        // A single-shot sub-agent finished its one task — close its input so the
        // run loop ends and it reaches a terminal `completed` status. Otherwise it
        // parks here in awaiting_input holding a slot, and the conductor's
        // wait_for_subtasks never sees it finish (hangs to the 15-min timeout).
        if (this.launch.singleShot) this.queue.close()
        break
      }
      default:
        break
    }
  }

  private persist(kind: TranscriptKind, blocks: ContentBlock[], extra?: Partial<TranscriptMessage>): void {
    const message: TranscriptMessage = {
      id: randomUUID(),
      sessionId: this.info.id,
      kind,
      blocks,
      createdAt: Date.now(),
      ...extra
    }
    this.deps.repos.messages.insert(message)
    this.deps.bus.emit({ channel: 'session:message', payload: message })
  }

  private patch(patch: Partial<SessionInfo>): void {
    if (this.destroyed) return
    const updated = this.deps.repos.sessions.update(this.info.id, patch)
    this.info = updated ?? { ...this.info, ...patch, updatedAt: Date.now() }
    this.deps.bus.emit({ channel: 'session:updated', payload: this.info })
  }
}

function userMessage(text: string): unknown {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '' }
}

/** Max automatic restarts for a transient PRE-init failure (then surface). */
const MAX_STARTUP_RETRIES = 3

/**
 * Classify a run-loop failure: is it a transient infra blip (worth an automatic
 * restart) and what should the user see? Turns a raw "401 Invalid authentication
 * credentials" into an actionable message instead of a scary dead-end.
 */
function classifyError(err: unknown): { transient: boolean; message: string } {
  const raw = err instanceof Error ? err.message : String(err)
  const lower = raw.toLowerCase()
  // Auth: usually a real expired login / bad key — don't auto-retry, but tell the
  // user exactly what to do (this is the 401 dead-end we kept hitting).
  if (/\b(401|403)\b|invalid authentication|unauthorized|authentication_error|permission_error/.test(lower)) {
    return {
      transient: false,
      message: `Authentication failed — make sure Claude Code is logged in (run \`claude\` once in a terminal), or that your gateway/provider key is valid, then click Resume. [${raw}]`
    }
  }
  // Transient: rate-limit / overloaded / 5xx / network — safe to restart a spawn.
  if (/\b(429|500|502|503|504|529)\b|rate.?limit|overloaded|too many requests|timeout|etimedout|econnreset|econnrefused|enotfound|socket hang up|fetch failed|network error/.test(lower)) {
    return { transient: true, message: `Transient error after retries — click Resume to continue. [${raw}]` }
  }
  return { transient: false, message: raw }
}

// Defensively pull token counts out of the SDK result's `usage` (untyped edge).
// Input includes cache read/creation tokens — those are real billed input.
function extractTokens(usage: unknown): { input: number | null; output: number | null } {
  if (!usage || typeof usage !== 'object') return { input: null, output: null }
  const u = usage as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  const input = num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens)
  const output = num(u.output_tokens)
  return { input: input || null, output: output || null }
}

function resultText(subtype: string, result: unknown): string {
  if (subtype === 'success') return typeof result === 'string' && result ? result : '(turn complete)'
  return `(run ended: ${subtype})`
}
