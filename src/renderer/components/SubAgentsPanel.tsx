import type { SessionInfo } from '@shared/types'
import { useStore } from '../store/store'
import { formatCost, StatusDot } from './bits'

/**
 * A conductor's fan-out, made legible: every delegated sub-agent with its model
 * TIER (color-coded cheap→expensive) and cost, so the orchestration and the
 * auto-tiering are visible at a glance — you can see the cheap work running
 * cheap. Click a sub-agent to drill in.
 */

// Tier colors — green = cheap, blue = mid, amber = expensive. Makes the
// cost/quality trade-off readable without reading the model name.
function tierColor(model: string | null): string {
  if (!model) return '#7e8796'
  if (model.includes('haiku')) return '#5bd4a4'
  if (model.includes('sonnet')) return '#6ea8fe'
  if (model.includes('opus')) return '#f5a623'
  return '#8a93a6'
}

export function SubAgentsPanel({ sessionId }: { sessionId: string }) {
  const children = useStore((s) =>
    Object.values(s.sessions)
      .filter((x) => x.parentId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
  ) as SessionInfo[]
  const models = useStore((s) => s.models)
  const select = useStore((s) => s.select)

  const totalCost = children.reduce((sum, c) => sum + c.totalCostUsd, 0)
  const live = children.filter((c) => c.status === 'running' || c.status === 'queued').length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
          Sub-agents <span className="text-[#3a4150]">· {children.length}</span>
        </span>
        <span className="text-[11px] text-[#6b7280]">
          {live > 0 && <span className="text-accent">{live} running · </span>}
          <span className="tabular-nums text-[#c7cdd8]">{formatCost(totalCost)}</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {children.length === 0 ? (
          <div className="mx-auto mt-6 max-w-xs rounded-lg border border-ink-700 px-4 py-6 text-center text-xs text-[#6b7280]">
            No sub-agents yet. As the conductor delegates, each one appears here with its model tier and cost.
          </div>
        ) : (
          children.map((c) => {
            const label = models.find((m) => m.id === c.model)?.label ?? c.model ?? '—'
            const color = tierColor(c.model)
            return (
              <button
                key={c.id}
                onClick={() => void select(c.id)}
                className="mb-1 flex w-full items-center gap-2.5 rounded-lg border border-ink-700 px-2.5 py-2 text-left hover:bg-ink-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-[#d7dbe3]">{c.title}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusDot status={c.status} />
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${color}1a`, color }}>
                      {label}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-[#6b7280]">{formatCost(c.totalCostUsd)}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
