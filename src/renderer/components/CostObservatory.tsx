import { useState } from 'react'
import { buildCostReport, formatTokens, type CostBucket } from '@shared/costReport'
import { useStore } from '../store/store'
import { formatCost } from './bits'

/**
 * Cost & token observatory — where the spend goes, and how close it is to the
 * budget. Built from the session ledger so a conductor fanning out to many
 * sub-agents can't quietly run up the bill.
 */
export function CostObservatory({ onClose }: { onClose: () => void }) {
  const sessions = useStore((s) => s.sessions)
  const budgetUsd = useStore((s) => s.settings.budgetUsd)
  const patchSettings = useStore((s) => s.patchSettings)
  const select = useStore((s) => s.select)

  const [budgetInput, setBudgetInput] = useState(budgetUsd ? String(budgetUsd) : '')

  const report = buildCostReport(Object.values(sessions), budgetUsd)
  const maxModel = Math.max(1, ...report.byModel.map((b) => b.costUsd))
  const maxWorkflow = Math.max(1, ...report.byWorkflow.map((b) => b.costUsd))

  const saveBudget = () => {
    const v = Number(budgetInput)
    void patchSettings({ budgetUsd: Number.isFinite(v) && v > 0 ? v : 0 })
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[720px] flex-col overflow-hidden rounded-xl border border-ink-500 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
          <div className="text-sm font-semibold text-white">Cost &amp; token observatory</div>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-[#8a93a6] hover:bg-ink-700">Close</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Headline */}
          <div className="mb-5 flex items-end gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[#6b7280]">Total spend</div>
              <div className="text-2xl font-semibold tabular-nums text-white">{formatCost(report.totalUsd)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[#6b7280]">Tokens (in / out)</div>
              <div className="text-sm tabular-nums text-[#c7cdd8]">
                {formatTokens(report.inputTokens)} <span className="text-[#5b6472]">/</span> {formatTokens(report.outputTokens)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[#6b7280]">Sessions</div>
              <div className="text-sm tabular-nums text-[#c7cdd8]">{report.sessionCount}</div>
            </div>
          </div>

          {/* Budget guardrail */}
          <div className="mb-5 rounded-lg border border-ink-700 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7280]">Budget guardrail</span>
              <div className="flex items-center gap-1 text-xs">
                <span className="text-[#6b7280]">$</span>
                <input
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value.replace(/[^0-9.]/g, ''))}
                  onBlur={saveBudget}
                  onKeyDown={(e) => e.key === 'Enter' && saveBudget()}
                  placeholder="no cap"
                  className="w-20 rounded border border-ink-500 bg-ink-700 px-1.5 py-0.5 text-right tabular-nums"
                />
              </div>
            </div>
            {report.budgetUsd ? (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, report.budgetUsedPct ?? 0)}%`,
                      background: report.overBudget ? '#f06d6d' : (report.budgetUsedPct ?? 0) > 80 ? '#f5a623' : '#5bd4a4'
                    }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-[#6b7280]">
                  {formatCost(report.totalUsd)} of {formatCost(report.budgetUsd)} ·{' '}
                  <span style={{ color: report.overBudget ? '#f06d6d' : '#8a93a6' }}>
                    {(report.budgetUsedPct ?? 0).toFixed(0)}%{report.overBudget ? ' — over budget' : ''}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-[11px] text-[#6b7280]">Set a soft cap to track spend against a budget and get a header warning as you approach it.</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Breakdown title="By model" buckets={report.byModel} max={maxModel} />
            <Breakdown title="By workflow" buckets={report.byWorkflow} max={maxWorkflow} />
          </div>

          {/* Top sessions */}
          <div className="mt-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6b7280]">Priciest sessions</div>
            {report.top.length === 0 ? (
              <div className="text-xs text-[#5b6472]">No spend yet.</div>
            ) : (
              report.top.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { void select(t.id); onClose() }}
                  className="mb-1 flex w-full items-center justify-between gap-3 rounded border border-ink-700 px-3 py-1.5 text-left hover:bg-ink-700"
                >
                  <span className="truncate text-xs text-[#d7dbe3]">{t.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px] text-[#6b7280]">
                    {t.model && <span>{t.model}</span>}
                    <span className="tabular-nums text-[#c7cdd8]">{formatCost(t.costUsd)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Breakdown({ title, buckets, max }: { title: string; buckets: CostBucket[]; max: number }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6b7280]">{title}</div>
      {buckets.length === 0 ? (
        <div className="text-xs text-[#5b6472]">—</div>
      ) : (
        buckets.map((b) => (
          <div key={b.key} className="mb-1.5">
            <div className="mb-0.5 flex items-center justify-between text-[11px]">
              <span className="truncate text-[#c7cdd8]">{b.key}</span>
              <span className="shrink-0 tabular-nums text-[#6b7280]">{formatCost(b.costUsd)} · {b.sessions}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
              <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(2, (b.costUsd / max) * 100)}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}
