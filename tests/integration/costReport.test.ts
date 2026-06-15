import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '@shared/types'
import { buildCostReport, formatTokens } from '../../src/shared/costReport'

function session(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: Math.random().toString(36), sdkSessionId: null, title: 't', model: 'opus', cwd: '/x', repoId: null,
    branch: null, worktreePath: null, status: 'completed', permissionMode: 'default', presetId: 'build',
    totalCostUsd: 0, numTurns: 0, inputTokens: 0, outputTokens: 0, createdAt: 0, updatedAt: 0, error: null,
    ...over
  }
}

describe('buildCostReport', () => {
  const sessions = [
    session({ id: 'a', model: 'opus', presetId: 'conduct', totalCostUsd: 5, inputTokens: 1000, outputTokens: 200 }),
    session({ id: 'b', model: 'sonnet', presetId: 'build', totalCostUsd: 2, inputTokens: 500, outputTokens: 100 }),
    session({ id: 'c', model: 'sonnet', presetId: 'build', totalCostUsd: 1, inputTokens: 300, outputTokens: 50 }),
    session({ id: 'd', model: 'haiku', presetId: 'explore', totalCostUsd: 0 })
  ]

  it('totals spend, sessions, and tokens', () => {
    const r = buildCostReport(sessions)
    expect(r.totalUsd).toBe(8)
    expect(r.sessionCount).toBe(4)
    expect(r.inputTokens).toBe(1800)
    expect(r.outputTokens).toBe(350)
  })

  it('buckets by model, cost desc', () => {
    const r = buildCostReport(sessions)
    expect(r.byModel.map((b) => b.key)).toEqual(['opus', 'sonnet', 'haiku']) // 5, 3, 0
    const sonnet = r.byModel.find((b) => b.key === 'sonnet')!
    expect(sonnet.costUsd).toBe(3)
    expect(sonnet.sessions).toBe(2)
    expect(sonnet.inputTokens).toBe(800)
  })

  it('buckets by workflow, cost desc', () => {
    const r = buildCostReport(sessions)
    expect(r.byWorkflow.map((b) => b.key)).toEqual(['conduct', 'build', 'explore']) // 5, 3, 0
  })

  it('lists the priciest sessions and excludes zero-cost ones', () => {
    const r = buildCostReport(sessions, null, 2)
    expect(r.top.map((t) => t.id)).toEqual(['a', 'b']) // top 2 by cost
    expect(r.top.some((t) => t.id === 'd')).toBe(false) // zero-cost excluded
  })

  it('computes budget usage and over-budget state', () => {
    expect(buildCostReport(sessions, 10).budgetUsedPct).toBe(80)
    expect(buildCostReport(sessions, 10).overBudget).toBe(false)
    expect(buildCostReport(sessions, 8).overBudget).toBe(true) // total >= budget
    expect(buildCostReport(sessions, 0).budgetUsd).toBeNull() // 0 = no budget
    expect(buildCostReport(sessions).budgetUsedPct).toBeNull()
  })
})

describe('formatTokens', () => {
  it('formats with k/M suffixes', () => {
    expect(formatTokens(640)).toBe('640')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(1_250_000)).toBe('1.25M')
  })
})
