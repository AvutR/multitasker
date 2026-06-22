import type { SessionInfo } from '@shared/types'
import { isRevivableStatus } from '@shared/board'
import { useStore } from '../store/store'
import { Badge, formatCost, StatusDot } from './bits'
import { Icon } from './Icon'

export function SessionCard({
  session,
  selected = false,
  onToggleSelect
}: {
  session: SessionInfo
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const select = useStore((s) => s.select)
  const deleteSession = useStore((s) => s.deleteSession)
  const setPinned = useStore((s) => s.setPinned)
  const resume = useStore((s) => s.resume)
  const markDone = useStore((s) => s.markDone)
  const childCount = useStore((s) => Object.values(s.sessions).filter((x) => x.parentId === session.id).length)
  const presets = useStore((s) => s.presets)
  const presetName = presets.find((p) => p.id === session.presetId)?.name ?? session.presetId ?? ''
  const needsYou = session.status === 'error' || session.status === 'awaiting_plan_approval'
  // A non-live session (Done-lane card) can be woken — resume reattaches its
  // context and waits for the user's prompt (it does not auto-run).
  const revivable = isRevivableStatus(session.status)
  // A live session (running/queued/idle) can be closed out as done.
  const canMarkDone = session.status === 'running' || session.status === 'queued' || session.status === 'awaiting_input'

  const onResume = (e: React.MouseEvent) => {
    e.stopPropagation()
    void resume(session.id)
  }
  const onMarkDone = (e: React.MouseEvent) => {
    e.stopPropagation()
    void markDone(session.id)
  }
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

  // ⌘/Ctrl-click toggles multi-select instead of opening (when selection is wired in).
  const onCardClick = (e: React.MouseEvent) => {
    if (onToggleSelect && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onToggleSelect()
      return
    }
    void select(session.id)
  }

  return (
    <div
      className={`group relative rounded-lg border transition-colors ${
        selected ? 'border-accent bg-accent/10 ring-1 ring-accent' : needsYou ? 'border-[#f5c451]/50 bg-[#f5c451]/5' : 'border-ink-600 bg-ink-800 hover:bg-ink-700'
      } ${session.pinned && !selected ? 'ring-1 ring-accent/40' : ''}`}
    >
      {onToggleSelect && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect()
          }}
          title="Select (⌘-click the card) for a batch action"
          aria-label={selected ? 'Deselect session' : 'Select session'}
          className={`absolute left-1.5 top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded border text-[9px] transition-opacity ${
            selected ? 'border-accent bg-accent text-ink-900 opacity-100' : 'border-ink-500 bg-ink-900/70 text-transparent opacity-0 group-hover:opacity-100'
          }`}
        >
          ✓
        </button>
      )}
      <button
        onClick={onCardClick}
        className="block w-full rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate pr-14 text-sm text-[#d7dbe3]">{session.title}</span>
          {/* Fade the cost out on hover so the action icons swap into the same
              top-right corner instead of colliding with the number. */}
          <span className="shrink-0 text-[10px] tabular-nums text-[#5b6472] transition-opacity duration-200 group-hover:opacity-0">
            {formatCost(session.totalCostUsd)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <StatusDot status={session.status} />
          <div className="flex shrink-0 items-center gap-1">
            {childCount > 0 && (
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent" title="Conductor with delegated sub-agents">
                {childCount} sub-agent{childCount === 1 ? '' : 's'}
              </span>
            )}
            {session.parentId && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[#6b7280]" title="Delegated by a conductor">
                ↳ sub-agent
              </span>
            )}
            {presetName && <Badge>{presetName}</Badge>}
          </div>
        </div>
        {session.branch && <div className="mt-1 truncate font-mono text-[10px] text-[#5b6472]">⎇ {session.branch}</div>}
        {session.error && <div className="mt-1 line-clamp-2 text-[10px] text-[#f06d6d]">{session.error}</div>}
      </button>

      {/* Hover actions — siblings of the select button (no nested buttons). */}
      <div className="absolute right-1 top-1 flex gap-0.5">
        {revivable && (
          <button
            onClick={onResume}
            title="Resume — wake this session; it waits for your prompt before doing anything"
            aria-label="Resume session"
            className="inline-flex items-center justify-center rounded p-1 text-[#8a93a6] opacity-0 transition-opacity duration-200 hover:bg-ink-600 hover:text-[#5bd4a4] group-hover:opacity-100"
          >
            <Icon name="resume" />
          </button>
        )}
        {canMarkDone && (
          <button
            onClick={onMarkDone}
            title="Done — stop the agent and move to Done"
            aria-label="Mark session done"
            className="inline-flex items-center justify-center rounded p-1 text-[#8a93a6] opacity-0 transition-opacity duration-200 hover:bg-ink-600 hover:text-[#5bd4a4] group-hover:opacity-100"
          >
            <Icon name="done" />
          </button>
        )}
        <button
          onClick={onPin}
          title={session.pinned ? 'Unpin' : 'Pin to top'}
          aria-label={session.pinned ? 'Unpin session' : 'Pin session'}
          className={`inline-flex items-center justify-center rounded p-1 transition-opacity duration-200 hover:bg-ink-600 ${
            session.pinned ? 'text-accent opacity-100' : 'text-[#8a93a6] opacity-0 hover:text-[#d7dbe3] group-hover:opacity-100'
          }`}
        >
          <Icon name="pin" filled={session.pinned} />
        </button>
        <button
          onClick={onDelete}
          title="Delete session"
          aria-label="Delete session"
          className="inline-flex items-center justify-center rounded p-1 text-[#8a93a6] opacity-0 transition-opacity duration-200 hover:bg-[#f06d6d]/20 hover:text-[#f06d6d] group-hover:opacity-100"
        >
          <Icon name="delete" />
        </button>
      </div>
    </div>
  )
}
