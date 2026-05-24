import type { SessionInfo } from '@shared/types'
import { useStore } from '../store/store'
import { Badge, formatCost, StatusDot } from './bits'

export function SessionCard({ session }: { session: SessionInfo }) {
  const select = useStore((s) => s.select)
  const presets = useStore((s) => s.presets)
  const presetName = presets.find((p) => p.id === session.presetId)?.name ?? session.presetId ?? ''
  const needsYou = session.status === 'error' || session.status === 'awaiting_plan_approval'

  return (
    <button
      onClick={() => void select(session.id)}
      className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        needsYou ? 'border-[#f5c451]/50 bg-[#f5c451]/5' : 'border-ink-600 bg-ink-800 hover:bg-ink-700'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-[#d7dbe3]">{session.title}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-[#5b6472]">{formatCost(session.totalCostUsd)}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <StatusDot status={session.status} />
        {presetName && <Badge>{presetName}</Badge>}
      </div>
      {session.branch && <div className="mt-1 truncate font-mono text-[10px] text-[#5b6472]">⎇ {session.branch}</div>}
      {session.error && <div className="mt-1 line-clamp-2 text-[10px] text-[#f06d6d]">{session.error}</div>}
    </button>
  )
}
