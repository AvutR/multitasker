import { randomUUID } from 'node:crypto'
import type { ActionDecidedBy, ActionRecord, ActionStatus, PolicyMode, PolicyState } from '@shared/types'
import type { Repositories } from '../db/repositories'
import type { EventBus } from '../events'
import { ACTION_TYPE_BY_ID, ACTION_TYPES } from './actionTypes'
import type { ConnectorGateway } from './ConnectorGateway'
import { decidePolicy, effectiveMode } from './PolicyEngine'

export interface ProposeInput {
  sessionId: string | null
  actionType: string
  summary: string
  payload: unknown
}

export interface GuardOutcome {
  /** true => the agent's own raw tool call is allowed to proceed. */
  allow: boolean
  record: ActionRecord | null
  /** Message handed back to the agent when the call is denied. */
  message?: string
}

interface RecordInput extends ProposeInput {
  status: ActionStatus
  decidedBy: ActionDecidedBy | null
  decidedAt?: number
  result?: unknown
  error?: string
}

/**
 * The heart of the integration layer. Owns the policy decision, the append-only
 * audit log, real execution (via the injected gateway), and the approval queue.
 * Two entry points mirror the two enforcement paths:
 *   - propose(): semantic MCP tools the agent calls; Multitasker owns execution.
 *   - guard():   raw connector tools the agent calls directly; we gate, the
 *                agent executes on allow.
 */
export class ActionService {
  constructor(
    private repos: Repositories,
    private bus: EventBus,
    private gateway: ConnectorGateway
  ) {}

  list(limit = 200): ActionRecord[] {
    return this.repos.actions.list(limit)
  }

  policyState(): PolicyState {
    return { modes: this.repos.policies.getModes(), dryRun: this.repos.settings.get().dryRun }
  }

  setMode(actionType: string, mode: PolicyMode): PolicyState {
    this.repos.policies.setMode(actionType, mode)
    const state = this.policyState()
    this.bus.emit({ channel: 'policy:updated', payload: state })
    return state
  }

  setDryRun(dryRun: boolean): PolicyState {
    this.repos.settings.set({ dryRun })
    const state = this.policyState()
    this.bus.emit({ channel: 'policy:updated', payload: state })
    return state
  }

  /** Path #1 — a semantic integration tool the agent invoked. We own execution. */
  async propose(input: ProposeInput): Promise<ActionRecord> {
    const decision = this.evaluate(input.actionType)
    if (!decision) {
      return this.record({
        ...input,
        status: 'dropped',
        decidedBy: null,
        error: `unknown action type: ${input.actionType}`
      })
    }
    switch (decision.effect) {
      case 'fire': {
        const pending = this.record({ ...input, status: 'pending', decidedBy: decision.decidedBy })
        return this.execute(pending, decision.decidedBy)
      }
      case 'queue':
        return this.record({ ...input, status: 'pending', decidedBy: null })
      case 'dry_run':
        return this.record({ ...input, status: 'dry_run', decidedBy: 'dry_run' })
      case 'drop':
        return this.record({ ...input, status: 'dropped', decidedBy: decision.decidedBy })
    }
  }

  /** Path #2 — a raw connector tool the agent tried directly. Gate it. */
  async guard(input: ProposeInput): Promise<GuardOutcome> {
    const decision = this.evaluate(input.actionType)
    if (!decision) return { allow: true, record: null } // unknown/non-gated tool — let it run
    const def = ACTION_TYPE_BY_ID[input.actionType]
    switch (decision.effect) {
      case 'fire': {
        // Allow the agent to perform it; record that it fired (executed by the agent).
        const rec = this.record({
          ...input,
          status: 'fired',
          decidedBy: 'auto',
          decidedAt: Date.now(),
          result: { via: 'agent' }
        })
        return { allow: true, record: rec }
      }
      case 'dry_run': {
        const rec = this.record({ ...input, status: 'dry_run', decidedBy: 'dry_run' })
        return { allow: false, record: rec, message: `[dry-run] ${def.label} not executed — intent recorded in Multitasker.` }
      }
      case 'queue': {
        const rec = this.record({ ...input, status: 'pending', decidedBy: null })
        return { allow: false, record: rec, message: `${def.label} is queued for one-click approval in Multitasker. Continue with other work.` }
      }
      case 'drop': {
        const rec = this.record({ ...input, status: 'dropped', decidedBy: decision.decidedBy })
        return { allow: false, record: rec, message: decision.reason }
      }
    }
  }

  /** Resolve a pending (APPROVE) action from the approval queue UI. */
  async decide(id: string, approve: boolean): Promise<ActionRecord> {
    const rec = this.repos.actions.get(id)
    if (!rec) throw new Error(`action not found: ${id}`)
    if (rec.status !== 'pending') return rec
    if (!approve) {
      return this.update(id, { status: 'rejected', decidedBy: 'user', decidedAt: Date.now() })
    }
    // Re-evaluate at approval time: dry-run or the policy may have changed since
    // the action queued. Never fire a live connector if dry-run is now ON.
    const decision = this.evaluate(rec.actionType)
    if (decision?.effect === 'dry_run') {
      return this.update(id, { status: 'dry_run', decidedBy: 'dry_run', decidedAt: Date.now() })
    }
    if (decision?.effect === 'drop') {
      return this.update(id, { status: 'dropped', decidedBy: decision.decidedBy, decidedAt: Date.now() })
    }
    return this.execute(rec, 'user')
  }

  // --- internals -----------------------------------------------------------

  private evaluate(actionTypeId: string) {
    const def = ACTION_TYPE_BY_ID[actionTypeId]
    if (!def) return null
    const mode = effectiveMode(def, this.repos.policies.getModes())
    const dryRun = this.repos.settings.get().dryRun
    return decidePolicy(def, mode, dryRun)
  }

  private async execute(rec: ActionRecord, decidedBy: ActionDecidedBy): Promise<ActionRecord> {
    const def = ACTION_TYPE_BY_ID[rec.actionType]
    try {
      const res = await this.gateway.execute({
        actionType: rec.actionType,
        connector: def.connector,
        payload: rec.payload,
        summary: rec.summary
      })
      return this.update(rec.id, {
        status: res.ok ? 'fired' : 'failed',
        decidedBy,
        decidedAt: Date.now(),
        result: res.result ?? null,
        error: res.ok ? null : res.error ?? 'connector failed'
      })
    } catch (err) {
      return this.update(rec.id, {
        status: 'failed',
        decidedBy,
        decidedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private record(input: RecordInput): ActionRecord {
    const def = ACTION_TYPE_BY_ID[input.actionType]
    const rec: ActionRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      actionType: input.actionType,
      connector: def?.connector ?? 'github',
      direction: def?.direction ?? 'outward_post',
      summary: input.summary,
      payload: input.payload,
      status: input.status,
      decidedBy: input.decidedBy,
      result: input.result ?? null,
      error: input.error ?? null,
      createdAt: Date.now(),
      decidedAt: input.decidedAt ?? null
    }
    this.repos.actions.insert(rec)
    this.bus.emit({ channel: 'action:created', payload: rec })
    return rec
  }

  private update(id: string, patch: Partial<ActionRecord>): ActionRecord {
    const updated = this.repos.actions.update(id, patch)
    if (!updated) throw new Error(`action vanished during update: ${id}`)
    this.bus.emit({ channel: 'action:updated', payload: updated })
    return updated
  }
}

/** Seed the policies table with each action type's default mode (first run only). */
export function seedDefaultPolicies(repos: Repositories): void {
  const existing = repos.policies.getModes()
  for (const def of ACTION_TYPES) {
    if (!(def.id in existing)) repos.policies.setMode(def.id, def.defaultPolicy)
  }
}
