import type { SessionInfo } from './types'

/**
 * Cost & token observability — turn the session ledger into a spend report so
 * runaway API bills are visible before they're a surprise: total spend, where
 * it's going (by model and by workflow), the priciest sessions, and progress
 * against a budget. Pure + deterministic.
 */
export interface CostBucket {
  key: string
  costUsd: number
  sessions: number
  inputTokens: number
  outputTokens: number
}

export interface TopSession {
  id: string
  title: string
  model: string | null
  presetId: string | null
  costUsd: number
}

export interface CostReport {
  totalUsd: number
  sessionCount: number
  inputTokens: number
  outputTokens: number
  byModel: CostBucket[] // cost desc
  byWorkflow: CostBucket[] // cost desc
  top: TopSession[] // priciest sessions, cost desc
  budgetUsd: number | null
  budgetUsedPct: number | null // null when no budget set
  overBudget: boolean
}

function bucketize(sessions: SessionInfo[], keyOf: (s: SessionInfo) => string): CostBucket[] {
  const map = new Map<string, CostBucket>()
  for (const s of sessions) {
    const key = keyOf(s)
    const b = map.get(key) ?? { key, costUsd: 0, sessions: 0, inputTokens: 0, outputTokens: 0 }
    b.costUsd += s.totalCostUsd
    b.sessions += 1
    b.inputTokens += s.inputTokens ?? 0
    b.outputTokens += s.outputTokens ?? 0
    map.set(key, b)
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd)
}

export function buildCostReport(sessions: SessionInfo[], budgetUsd?: number | null, topN = 8): CostReport {
  const totalUsd = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0)
  const inputTokens = sessions.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0)
  const outputTokens = sessions.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0)

  const top = [...sessions]
    .filter((s) => s.totalCostUsd > 0)
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    .slice(0, topN)
    .map((s) => ({ id: s.id, title: s.title, model: s.model, presetId: s.presetId, costUsd: s.totalCostUsd }))

  const budget = budgetUsd && budgetUsd > 0 ? budgetUsd : null
  return {
    totalUsd,
    sessionCount: sessions.length,
    inputTokens,
    outputTokens,
    byModel: bucketize(sessions, (s) => s.model ?? 'unknown'),
    byWorkflow: bucketize(sessions, (s) => s.presetId ?? 'unknown'),
    top,
    budgetUsd: budget,
    budgetUsedPct: budget ? (totalUsd / budget) * 100 : null,
    overBudget: budget ? totalUsd >= budget : false
  }
}

/** Compact token formatter — 1234 → "1.2k", 1_200_000 → "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
