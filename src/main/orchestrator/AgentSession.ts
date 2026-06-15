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
    this.queue.push(userMessage(prompt))
    this.donePromise = this.run(undefined)
  }

  /**
   * Resume (or fork) an existing SDK session.
   *  - fork, or resume WITH a prompt: begins work immediately with that prompt.
   *  - bare resume (no prompt): a "wake". We reattach the SDK session but feed it
   *    NO message, so the run loop parks on the open queue in `awaiting_input`.
   *    Nothing runs until the user steers — their first message is what starts
   *    the work, in the fully-resumed context. Mirrors the no-autostart rule we
   *    apply to tracker issues: no action without a prompt from the user.
   */
  resume(prompt: string, fork: boolean): void {
    this.queue = new AsyncQueue<unknown>()
    this.abort = new AbortController()
    const wake = !fork && prompt.trim().length === 0
    if (!wake) this.queue.push(userMessage(prompt || 'Continue where you left off.'))
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
    // A bare resume "wakes" the session: it parks here in awaiting_input until the
    // user steers. Every other run begins working immediately.
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

    try {
      for await (const msg of query({ prompt: this.queue, options })) {
        this.handle(msg)
      }
      if (this.info.status !== 'stopped' && this.info.status !== 'landed') {
        this.patch({ status: 'completed' })
      }
    } catch (err) {
      if (abort.signal.aborted) {
        this.patch({ status: 'stopped' })
        return
      }
      this.patch({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  // canUseTool is the single permission authority: the plan-approval gate for
  // ExitPlanMode, and the connector policy gate for raw connector writes.
  private canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    if (isExitPlanTool(toolName)) {
      const plan = typeof input?.plan === 'string' ? input.plan : ''
      this.patch({ status: 'awaiting_plan_approval' })
      this.deps.bus.emit({
        channel: 'session:planRequest',
        payload: { sessionId: this.info.id, plan, requestedAt: Date.now() }
      })
      const decision = await new Promise<PlanDecision>((resolve) => {
        this.planResolver = resolve
        // If the session is stopped while awaiting approval, resolve as a denial
        // so this turn ends instead of hanging forever.
        if (this.abort.signal.aborted) resolve({ approved: false })
        else this.abort.signal.addEventListener('abort', () => resolve({ approved: false }), { once: true })
      })
      this.patch({ status: 'running' })
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
