import { useStore } from '../store/store'
import { Badge, formatCost, StatusDot } from './bits'

export function SessionsRail({ onNew }: { onNew: () => void }) {
  const order = useStore((s) => s.order)
  const sessions = useStore((s) => s.sessions)
  const presets = useStore((s) => s.presets)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)

  const presetName = (id: string | null) => presets.find((p) => p.id === id)?.name ?? id ?? ''

  return (
    <nav className="flex min-h-0 flex-col border-r border-ink-600 bg-ink-800">
      <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Sessions</span>
        <button onClick={onNew} className="text-xs font-medium text-accent hover:underline">
          + New
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {order.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-[#5b6472]">
            No sessions yet.
            <br />
            <button onClick={onNew} className="mt-2 text-accent hover:underline">
              Spawn your first agent →
            </button>
          </div>
        )}
        {order.map((id) => {
          const s = sessions[id]
          if (!s) return null
          const selected = id === selectedId
          return (
            <button
              key={id}
              onClick={() => void select(id)}
              className={`block w-full border-b border-ink-700 px-3 py-2.5 text-left transition-colors ${
                selected ? 'bg-ink-600' : 'hover:bg-ink-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-[#d7dbe3]">{s.title}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-[#5b6472]">{formatCost(s.totalCostUsd)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <StatusDot status={s.status} />
                <Badge>{presetName(s.presetId)}</Badge>
              </div>
              {s.branch && (
                <div className="mt-1 truncate font-mono text-[10px] text-[#5b6472]">⎇ {s.branch}</div>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
