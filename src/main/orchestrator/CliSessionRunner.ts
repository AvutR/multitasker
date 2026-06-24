import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import type { ContentBlock, SessionInfo, TranscriptKind, TranscriptMessage } from '@shared/types'
import type { EngineId } from '@shared/engines'
import { parseEngineLine, type ParsedEvent } from '@shared/engineParse'
import type { Repositories } from '../db/repositories'
import type { EventBus } from '../events'
import { engineCommand, engineProtocol } from '../engines'
import type { PlanDecision, SessionRunner } from './SessionRunner'
import { bridgeEnv } from './SpawnBridge'

export interface CliRunnerDeps {
  repos: Repositories
  bus: EventBus
}

/**
 * Drives a CLI coding tool (Cursor, Codex, …) as a session. Each turn is one
 * headless invocation whose streamed stdout is parsed into the SAME transcript
 * model as the Claude SDK path, so the whole app (board, diff, blast radius,
 * review queue) treats every engine uniformly. The tool's own session id is
 * captured so steering resumes its context.
 *
 * Note: a CLI tool's OWN tool calls are NOT intercepted by the connector policy
 * (path #2 needs the Agent SDK's canUseTool) — so CLI sessions run in a worktree
 * and the policy engine still gates Multitasker's own lifecycle posts.
 */
export class CliSessionRunner implements SessionRunner {
  readonly id: string
  private info: SessionInfo
  private child: ChildProcess | null = null
  private settle: (() => void) | null = null
  private donePromise: Promise<void> = Promise.resolve()
  private destroyed = false
  private pendingSteer: string | null = null
  /** The tool's own session id (cursor session_id / codex thread_id) for --resume. */
  private toolSessionId: string | null

  constructor(
    private readonly deps: CliRunnerDeps,
    info: SessionInfo,
    private readonly engine: EngineId,
    private readonly binPath: string
  ) {
    this.id = info.id
    this.info = info
    this.toolSessionId = info.sdkSessionId ?? null
  }

  snapshot(): SessionInfo {
    return { ...this.info }
  }
  whenDone(): Promise<void> {
    return this.donePromise
  }
  applyPinned(pinned: boolean): void {
    this.info = { ...this.info, pinned }
  }
  // CLI engines have no in-process plan/permission gate — proceed without one.
  approvePlan(): void {}
  proposePlan(): Promise<PlanDecision> {
    return Promise.resolve({ approved: true })
  }
  markLanded(): void {
    this.patch({ status: 'landed' })
  }

  start(prompt: string): void {
    this.donePromise = this.fresh()
    void this.runTurn(prompt, false)
  }

  resume(prompt: string, _fork: boolean): void {
    this.donePromise = this.fresh()
    if (prompt.trim() === '') {
      // Wake: reattach and wait for the user's steer — no autostart (same rule as
      // Claude). The next steer runs the turn and resolves this donePromise.
      this.patch({ status: 'awaiting_input' })
    } else {
      void this.runTurn(prompt, true)
    }
  }

  steer(text: string): void {
    if (this.child) {
      this.pendingSteer = text // a turn is running — chain this after it
      return
    }
    // A steer is the user's explicit prompt: run a continuation turn (resume context).
    if (!this.settle) this.donePromise = this.fresh()
    void this.runTurn(text, true)
  }

  stop(): void {
    this.kill()
    this.pendingSteer = null
    if (this.info.status !== 'error') this.patch({ status: 'stopped' })
    this.resolveDone()
  }

  markDone(): void {
    this.kill()
    this.patch({ status: 'stopped', workState: 'done' })
    this.resolveDone()
  }

  dispose(): void {
    this.destroyed = true
    this.kill()
    this.resolveDone()
  }

  // --- internals -----------------------------------------------------------

  private fresh(): Promise<void> {
    return new Promise((resolve) => {
      this.settle = resolve
    })
  }
  private resolveDone(): void {
    this.settle?.()
    this.settle = null
  }
  private kill(): void {
    this.child?.kill('SIGTERM')
    this.child = null
  }

  private async runTurn(message: string, resume: boolean): Promise<void> {
    if (this.destroyed) return
    this.persist('user', [{ type: 'text', text: message }]) // show what we asked
    this.patch({ status: 'running' })

    const protocol = engineProtocol(this.engine)
    const { args, env } = engineCommand(this.engine, {
      prompt: message,
      cwd: this.info.cwd,
      model: this.info.model,
      resumeId: resume ? this.toolSessionId : null
    })

    let child: ChildProcess
    try {
      child = spawn(this.binPath, args, {
        cwd: this.info.cwd,
        // Inherit env + the cross-provider spin-off bridge (`mt` on PATH) so this
        // CLI agent can recruit a sub-agent of any provider.
        env: { ...process.env, ...bridgeEnv(this.info.id), ...(env ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'] // no stdin — prompt is passed as an arg
      })
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err))
      return
    }
    this.child = child

    let sawError = false
    let stderr = ''
    const textLines: string[] = [] // for the 'text' protocol, accumulate then flush
    child.stderr?.on('data', (d) => {
      stderr += String(d)
    })
    let spawnError: string | null = null
    child.on('error', (err) => {
      spawnError = err.message
    })
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        const ev = parseEngineLine(protocol, line)
        if (!ev) return
        if (ev.kind === 'error' || (ev.kind === 'result' && ev.isError)) sawError = true
        this.applyEvent(ev, protocol === 'text' ? textLines : null)
      })
    }

    const code: number | null = await new Promise((resolve) => child.on('close', (c) => resolve(c)))
    this.child = null
    if (this.destroyed) return

    if (protocol === 'text' && textLines.length) {
      this.persist('assistant', [{ type: 'text', text: textLines.join('\n') }])
    }
    if (this.info.status === 'stopped' || this.info.status === 'landed') return // stop() already settled

    if (spawnError) return this.fail(spawnError)
    if (sawError || (code !== 0 && code !== null)) {
      return this.fail(stderr.trim().slice(-600) || `${this.engine} exited with code ${code}`)
    }
    // Success — if a steer arrived mid-turn, chain it WITHOUT settling (still working).
    if (this.pendingSteer) {
      const next = this.pendingSteer
      this.pendingSteer = null
      return void this.runTurn(next, true)
    }
    this.patch({ status: 'completed' })
    this.resolveDone()
  }

  private fail(message: string): void {
    this.patch({ status: 'error', error: message })
    this.resolveDone()
  }

  private applyEvent(ev: ParsedEvent, textBuf: string[] | null): void {
    switch (ev.kind) {
      case 'system':
        if (ev.sessionId && this.toolSessionId !== ev.sessionId) {
          this.toolSessionId = ev.sessionId
          this.patch({ sdkSessionId: ev.sessionId })
        }
        // If the user left the model on 'auto', surface the one the tool actually chose.
        if (ev.model && (!this.info.model || this.info.model === 'auto')) this.patch({ model: ev.model })
        break
      case 'assistant':
        if (ev.text) {
          if (textBuf) textBuf.push(ev.text)
          else this.persist('assistant', [{ type: 'text', text: ev.text }])
        }
        break
      case 'user':
        break // our own prompt echoed back — already persisted in runTurn
      case 'result':
        this.patch({
          totalCostUsd: (this.info.totalCostUsd ?? 0) + (ev.costUsd ?? 0),
          numTurns: (this.info.numTurns ?? 0) + 1,
          inputTokens: ev.inputTokens ?? this.info.inputTokens,
          outputTokens: ev.outputTokens ?? this.info.outputTokens,
          cachedInputTokens: ev.cachedInputTokens ?? this.info.cachedInputTokens
        })
        if (ev.text) this.persist('result', [{ type: 'text', text: ev.text }], { costUsd: ev.costUsd })
        break
      case 'error':
        if (ev.text) this.persist('result', [{ type: 'text', text: ev.text }], { resultSubtype: 'error' })
        break
      case 'ignore':
        break
    }
  }

  private persist(kind: TranscriptKind, blocks: ContentBlock[], extra?: Partial<TranscriptMessage>): void {
    if (this.destroyed) return
    const message: TranscriptMessage = { id: randomUUID(), sessionId: this.info.id, kind, blocks, createdAt: Date.now(), ...extra }
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
