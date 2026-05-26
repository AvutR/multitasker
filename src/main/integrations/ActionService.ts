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
    private gateway: ConnectorGateway,
    // github.* actions are git-backed, not MCP — route them to a separate gateway.
    private gitGateway: ConnectorGateway = { execute: async () => ({ ok: true, result: { skipped: 'no github gateway' } }) }
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
    // Make AUTO authoritative AND retroactive: clear any already-pending actions
    // of this type by firing them, so flipping to AUTO actually stops asking
    // (otherwise items queued before the change keep prompting). No-op under
    // dry-run, where they'd dry_run instead.
    if (mode === 'auto' && !state.dryRun) {
      for (const a of this.repos.actions.list(200)) {
        if (a.status === 'pending' && a.actionType === actionType) void this.decide(a.id, true)
      }
    }
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
    // Idempotency: the lifecycle automation and the agent (prompted to keep
    // trackers current) can both propose the SAME update — e.g. moving a Linear
    // issue to "In Progress". Collapse an identical action that already fired or
    // is awaiting approval within a short window so the connector isn't hit twice.
    const dup = this.recentDuplicate(input.actionType, input.payload)
    if (dup) return dup

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
    // Claim synchronously — move out of 'pending' BEFORE the (slow) connector call.
    // SQLite is synchronous, so a concurrent/double-click decide() then sees a
    // non-pending status and no-ops instead of double-firing, and the approval
    // item leaves the inbox immediately rather than lingering for seconds.
    // execute() downgrades to 'failed' if the connector throws.
    this.update(id, { status: 'fired', decidedBy: 'user', decidedAt: Date.now() })
    return this.execute(rec, 'user')
  }

  // --- internals -----------------------------------------------------------

  /** A recent identical action (same type + payload) that already fired or is
   *  pending — returned so a duplicate propose() collapses onto it. Not matched
   *  against dry_run, so flipping dry-run OFF still lets the action fire. */
  private recentDuplicate(actionType: string, payload: unknown): ActionRecord | null {
    const key = stableKey(payload)
    const cutoff = Date.now() - DEDUP_WINDOW_MS
    for (const a of this.repos.actions.list(50)) {
      if (a.createdAt < cutoff) break // list() is created_at DESC — older rows can't match
      if (a.actionType === actionType && (a.status === 'fired' || a.status === 'pending') && stableKey(a.payload) === key) {
        return a
      }
    }
    return null
  }

  private evaluate(actionTypeId: string) {
    const def = ACTION_TYPE_BY_ID[actionTypeId]
    if (!def) return null
    const mode = effectiveMode(def, this.repos.policies.getModes())
    const dryRun = this.repos.settings.get().dryRun
    return decidePolicy(def, mode, dryRun)
  }

  private async execute(rec: ActionRecord, decidedBy: ActionDecidedBy): Promise<ActionRecord> {
    const def = ACTION_TYPE_BY_ID[rec.actionType]
    const gateway = def.connector === 'github' ? this.gitGateway : this.gateway
    // GitHub actions run gh/git in the session's worktree, so supply its cwd.
    // The payload still wins (e.g. push_branch passes the worktree path explicitly).
    let payload = rec.payload
    if (def.connector === 'github' && rec.sessionId) {
      const session = this.repos.sessions.get(rec.sessionId)
      const base = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      if (session) payload = { cwd: session.cwd, ...base }
    }
    try {
      const res = await gateway.execute({
        actionType: rec.actionType,
        connector: def.connector,
        payload,
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

// Window for collapsing duplicate proposals (lifecycle + agent firing the same
// update). Long enough to cover a transition's overlap, short enough that a
// genuinely-repeated action later still goes through.
const DEDUP_WINDOW_MS = 5 * 60_000

/** Order-insensitive key for a payload so the same logical action dedupes even
 *  if two callers built the object with different key order. */
function stableKey(payload: unknown): string {
  try {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const obj = payload as Record<string, unknown>
      return JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]]))
    }
    return JSON.stringify(payload ?? null)
  } catch {
    return ''
  }
}

/** Seed the policies table with each action type's default mode (first run only). */
export function seedDefaultPolicies(repos: Repositories): void {
  const existing = repos.policies.getModes()
  for (const def of ACTION_TYPES) {
    if (!(def.id in existing)) repos.policies.setMode(def.id, def.defaultPolicy)
  }
}
