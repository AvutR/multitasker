import type { ActionRecord, BoardGroup, NeedsYouItem, PlanApprovalRequest, SessionInfo, WorkState } from './types'

/** A session that has finished running — its subprocess is gone. The single
 *  source of truth for "done" used by both resume (revivable) and await. */
export function isTerminalStatus(status: SessionInfo['status']): boolean {
  return status === 'stopped' || status === 'error' || status === 'completed' || status === 'landed'
}

/** A non-live session that resume() can re-run (i.e. a terminal one). */
export function isRevivableStatus(status: SessionInfo['status']): boolean {
  return isTerminalStatus(status)
}

/** Persistent work-state implied by a runtime status. Used to seed/refresh
 *  workState; 'stopped' is intentionally absent (a stop preserves the prior
 *  work-state) — callers fall back here only when workState is unknown. */
export function deriveWorkState(status: SessionInfo['status']): WorkState {
  if (status === 'completed') return 'done'
  if (status === 'landed') return 'review'
  if (status === 'stopped') return 'done' // unknown prior (e.g. pre-migration row) → treat as terminal
  return 'active' // queued / running / awaiting_input / awaiting_plan_approval / error
}

// Kind dominates the rank (error > plan > action); wait-time only breaks ties
// within a kind (capped so it can never outrank a more urgent kind).
const KIND_WEIGHT: Record<NeedsYouItem['kind'], number> = { error: 300, plan: 200, action: 100 }
const MAX_AGE_BOOST = 99

/**
 * The attention queue's ranking — the product's "brain". Unifies three signals
 * into one ordered list: errored sessions, sessions blocked on plan approval,
 * and outward actions pending approval. Pure + deterministic (pass `now` in tests).
 */
export function rankNeedsYou(
  sessions: SessionInfo[],
  planRequests: PlanApprovalRequest[],
  actions: ActionRecord[],
  now: number = Date.now()
): NeedsYouItem[] {
  const items: NeedsYouItem[] = []

  for (const s of sessions) {
    if (s.status === 'error') {
      items.push({ kind: 'error', sessionId: s.id, title: s.title, detail: s.error ?? 'Session errored', waitedMs: Math.max(0, now - s.updatedAt), priority: 0 })
    }
  }
  for (const p of planRequests) {
    const s = sessions.find((x) => x.id === p.sessionId)
    items.push({ kind: 'plan', sessionId: p.sessionId, title: s?.title ?? p.sessionId, detail: 'Plan ready for review', waitedMs: Math.max(0, now - p.requestedAt), priority: 0 })
  }
  for (const a of actions) {
    if (a.status === 'pending') {
      items.push({ kind: 'action', sessionId: a.sessionId ?? '', actionId: a.id, title: a.summary, detail: `${a.connector} action awaiting approval`, waitedMs: Math.max(0, now - a.createdAt), priority: 0 })
    }
  }

  for (const item of items) {
    item.priority = KIND_WEIGHT[item.kind] + Math.min(MAX_AGE_BOOST, Math.floor(item.waitedMs / 1000))
  }
  return items.sort((a, b) => b.priority - a.priority)
}

/** Group sessions into the four Mission Control lanes; pinned float to the top
 *  of each lane (V8's sort is stable, so order is otherwise preserved). */
export function groupSessions(sessions: SessionInfo[]): Record<BoardGroup, SessionInfo[]> {
  const groups: Record<BoardGroup, SessionInfo[]> = { needs_you: [], running: [], idle: [], done: [] }
  for (const s of sessions) {
    if (s.status === 'error' || s.status === 'awaiting_plan_approval') groups.needs_you.push(s)
    else if (s.status === 'running' || s.status === 'queued') groups.running.push(s)
    else if (s.status === 'awaiting_input') groups.idle.push(s)
    else if (s.status === 'stopped') {
      // A stopped session is grouped by its PERSISTENT work-state: work that was
      // still active (incl. everything paused by an app restart) stays in Idle —
      // visible and resumable — instead of being buried in the (collapsed) Done lane.
      const ws = s.workState ?? deriveWorkState(s.status)
      ;(ws === 'active' ? groups.idle : groups.done).push(s)
    } else groups.done.push(s) // landed, completed
  }
  for (const lane of Object.values(groups)) {
    lane.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  }
  return groups
}

/** Sessions that hold a live subprocess but are idle (candidates to reclaim). */
export function idleSessionIds(sessions: SessionInfo[]): string[] {
  return sessions.filter((s) => s.status === 'awaiting_input').map((s) => s.id)
}
