import type { SessionInfo } from '@shared/types'
import { useStore } from '../store/store'
import { Badge, formatCost, StatusDot } from './bits'

export function SessionCard({ session }: { session: SessionInfo }) {
  const select = useStore((s) => s.select)
  const deleteSession = useStore((s) => s.deleteSession)
  const setPinned = useStore((s) => s.setPinned)
  const presets = useStore((s) => s.presets)
  const presetName = presets.find((p) => p.id === session.presetId)?.name ?? session.presetId ?? ''
  const needsYou = session.status === 'error' || session.status === 'awaiting_plan_approval'

  const onPin = (e: React.MouseEvent) => {
    e.stopPropagation()
    void setPinned(session.id, !session.pinned)
  }
  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (
      window.confirm(
        `Delete "${session.title}"?\nThis stops the agent and removes it from the board. This can't be undone.`
      )
    ) {
      void deleteSession(session.id)
    }
  }

  return (
    <div
      className={`group relative rounded-lg border transition-colors ${
        needsYou ? 'border-[#f5c451]/50 bg-[#f5c451]/5' : 'border-ink-600 bg-ink-800 hover:bg-ink-700'
      } ${session.pinned ? 'ring-1 ring-accent/40' : ''}`}
    >
      <button
        onClick={() => void select(session.id)}
        className="block w-full rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate pr-10 text-sm text-[#d7dbe3]">{session.title}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-[#5b6472]">{formatCost(session.totalCostUsd)}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <StatusDot status={session.status} />
          {presetName && <Badge>{presetName}</Badge>}
        </div>
        {session.branch && <div className="mt-1 truncate font-mono text-[10px] text-[#5b6472]">⎇ {session.branch}</div>}
        {session.error && <div className="mt-1 line-clamp-2 text-[10px] text-[#f06d6d]">{session.error}</div>}
      </button>

      {/* Hover actions — siblings of the select button (no nested buttons). */}
      <div className="absolute right-1.5 top-1.5 flex gap-0.5">
        <button
          onClick={onPin}
          title={session.pinned ? 'Unpin' : 'Pin to top'}
          aria-label={session.pinned ? 'Unpin session' : 'Pin session'}
          className={`rounded px-1 text-[11px] leading-5 text-[#8a93a6] transition-opacity hover:bg-ink-600 hover:text-[#d7dbe3] ${
            session.pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {session.pinned ? '📌' : '📍'}
        </button>
        <button
          onClick={onDelete}
          title="Delete session"
          aria-label="Delete session"
          className="rounded px-1 text-[12px] leading-5 text-[#8a93a6] opacity-0 transition-opacity hover:bg-[#f06d6d]/20 hover:text-[#f06d6d] group-hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
