import { describe, expect, it } from 'vitest'
import type { ActionRecord, PlanApprovalRequest, SessionInfo } from '@shared/types'
import { groupSessions, idleSessionIds, isRevivableStatus, rankNeedsYou } from '../../src/shared/board'

function session(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: 's',
    sdkSessionId: null,
    title: 't',
    model: null,
    cwd: '/x',
    repoId: null,
    branch: null,
    worktreePath: null,
    status: 'running',
    permissionMode: 'default',
    presetId: null,
    totalCostUsd: 0,
    numTurns: 0,
    createdAt: 0,
    updatedAt: 0,
    error: null,
    ...over
  }
}

function action(over: Partial<ActionRecord>): ActionRecord {
  return {
    id: 'a',
    sessionId: 's',
    actionType: 'slack.message',
    connector: 'slack',
    direction: 'outward_post',
    summary: 'post',
    payload: {},
    status: 'pending',
    decidedBy: null,
    result: null,
    error: null,
    createdAt: 0,
    decidedAt: null,
    ...over
  }
}

const NOW = 1_000_000

describe('rankNeedsYou', () => {
  it('ranks error > plan > action regardless of age', () => {
    const sessions = [session({ id: 'e', status: 'error', error: 'boom', updatedAt: NOW })] // 0s waited
    const plans: PlanApprovalRequest[] = [{ sessionId: 'p', plan: 'x', requestedAt: NOW - 90_000 }] // 90s waited
    const actions = [action({ id: 'act', sessionId: 'a', createdAt: NOW - 90_000 })] // 90s
    const ranked = rankNeedsYou([...sessions, session({ id: 'p' }), session({ id: 'a' })], plans, actions, NOW)
    expect(ranked.map((r) => r.kind)).toEqual(['error', 'plan', 'action'])
  })

  it('uses wait-time as a tiebreaker within a kind', () => {
    const plans: PlanApprovalRequest[] = [
      { sessionId: 'new', plan: 'x', requestedAt: NOW - 5_000 },
      { sessionId: 'old', plan: 'x', requestedAt: NOW - 60_000 }
    ]
    const ranked = rankNeedsYou([session({ id: 'new' }), session({ id: 'old' })], plans, [], NOW)
    expect(ranked.map((r) => r.sessionId)).toEqual(['old', 'new']) // older waited longer → higher
  })

  it('only counts pending actions', () => {
    const actions = [action({ id: 'p1', status: 'pending' }), action({ id: 'f1', status: 'fired' })]
    const ranked = rankNeedsYou([], [], actions, NOW)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].actionId).toBe('p1')
  })

  it('is empty when nothing needs attention', () => {
    expect(rankNeedsYou([session({ status: 'running' })], [], [], NOW)).toEqual([])
  })
})

describe('groupSessions', () => {
  it('routes statuses into the four lanes', () => {
    const g = groupSessions([
      session({ id: '1', status: 'error' }),
      session({ id: '2', status: 'awaiting_plan_approval' }),
      session({ id: '3', status: 'running' }),
      session({ id: '4', status: 'queued' }),
      session({ id: '5', status: 'awaiting_input' }),
      session({ id: '6', status: 'landed' }),
      session({ id: '7', status: 'completed' }),
      session({ id: '8', status: 'stopped' })
    ])
    expect(g.needs_you.map((s) => s.id)).toEqual(['1', '2'])
    expect(g.running.map((s) => s.id)).toEqual(['3', '4'])
    expect(g.idle.map((s) => s.id)).toEqual(['5'])
    expect(g.done.map((s) => s.id)).toEqual(['6', '7', '8'])
  })

  it('floats pinned sessions to the top of their lane, preserving order otherwise', () => {
    const g = groupSessions([
      session({ id: 'r1', status: 'running' }),
      session({ id: 'r2', status: 'running', pinned: true }),
      session({ id: 'r3', status: 'running' }),
      session({ id: 'd1', status: 'completed' }),
      session({ id: 'd2', status: 'stopped', pinned: true })
    ])
    expect(g.running.map((s) => s.id)).toEqual(['r2', 'r1', 'r3']) // pinned first; r1/r3 order kept (stable)
    expect(g.done.map((s) => s.id)).toEqual(['d2', 'd1'])
  })
})

describe('isRevivableStatus', () => {
  it('is true for non-live sessions (resume can re-run them)', () => {
    for (const s of ['stopped', 'error', 'completed', 'landed'] as const) expect(isRevivableStatus(s)).toBe(true)
  })
  it('is false for live sessions', () => {
    for (const s of ['queued', 'running', 'awaiting_input', 'awaiting_plan_approval'] as const) expect(isRevivableStatus(s)).toBe(false)
  })
})

describe('idleSessionIds', () => {
  it('returns awaiting_input sessions (slot-holding, reclaimable)', () => {
    const ids = idleSessionIds([session({ id: 'a', status: 'awaiting_input' }), session({ id: 'b', status: 'running' })])
    expect(ids).toEqual(['a'])
  })
})
