import { useEffect, useState } from 'react'
import type { SessionInfo } from '@shared/types'
import { groupSessions, idleSessionIds } from '@shared/board'
import { useStore } from '../store/store'
import { Icon } from './Icon'
import { NeedsYouInbox } from './NeedsYouInbox'
import { SessionCard } from './SessionCard'

// Persist the Done-lane collapse so the board stays decluttered across restarts.
const DONE_COLLAPSED_KEY = 'mc.doneCollapsed'

export function MissionControl({ onNew }: { onNew: () => void }) {
  const sessions = useStore((s) => s.sessions)
  const order = useStore((s) => s.order)
  const reclaimIdle = useStore((s) => s.reclaimIdle)
  const steerMany = useStore((s) => s.steerMany)
  const stopMany = useStore((s) => s.stopMany)
  const markDoneMany = useStore((s) => s.markDoneMany)
  const [doneCollapsed, setDoneCollapsed] = useState<boolean>(
    () => localStorage.getItem(DONE_COLLAPSED_KEY) !== 'false' // default collapsed (declutter)
  )
  // Multi-select: ⌘-click cards (or their checkbox) to build a selection, then act
  // on all at once. "Drive a dozen agents" in one gesture instead of N clicks.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [batchText, setBatchText] = useState('')
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const clearSelect = () => setSelected(new Set())
  const selectedIds = [...selected].filter((id) => sessions[id]) // drop any since-removed

  // Esc clears the selection (a no-op for App's Esc handler on the board view).
  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected.size])

  const toggleDone = () =>
    setDoneCollapsed((v) => {
      const next = !v
      localStorage.setItem(DONE_COLLAPSED_KEY, String(next))
      return next
    })

  const ordered = order.map((id) => sessions[id]).filter(Boolean) as SessionInfo[]
  const groups = groupSessions(ordered)
  const total = ordered.length
  // Only sessions that actually hold a live subprocess slot are reclaimable —
  // the Idle lane also contains stopped-but-resumable sessions, which hold none.
  const reclaimable = idleSessionIds(ordered).length

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-ink-900 px-5 py-4">
      <div className="mb-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Needs you</h2>
        <NeedsYouInbox />
      </div>

      {total === 0 ? (
        <div className="mx-auto mt-10 max-w-sm rounded-2xl border border-ink-700 bg-ink-800/40 px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Icon name="sparkle" size={18} />
          </div>
          <div className="text-sm text-[#d7dbe3]">Nothing running yet</div>
          <div className="mt-1 text-xs text-[#6b7280]">Spawn an agent and watch it work — many in parallel.</div>
          <button onClick={onNew} className="mt-5 inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-[#8bbcff]">
            <Icon name="plus" /> New session
          </button>
        </div>
      ) : (
        <>
          <Lane title="Running" sessions={groups.running} selected={selected} onToggleSelect={toggleSelect} />
          <Lane
            title="Idle"
            sessions={groups.idle}
            selected={selected}
            onToggleSelect={toggleSelect}
            action={
              reclaimable > 0 ? (
                <button onClick={() => void reclaimIdle()} className="text-[11px] text-accent hover:underline" title="Stop live idle sessions to free their concurrency slots">
                  Reclaim {reclaimable} slot{reclaimable > 1 ? 's' : ''}
                </button>
              ) : undefined
            }
          />
          <Lane title="Done" sessions={groups.done} collapsed={doneCollapsed} onToggle={toggleDone} selected={selected} onToggleSelect={toggleSelect} />
        </>
      )}

      {selectedIds.length > 0 && (
        <div className="sticky bottom-0 z-20 mt-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-ink-800/95 px-3 py-2 shadow-2xl backdrop-blur">
          <span className="shrink-0 text-xs font-semibold text-accent">{selectedIds.length} selected</span>
          <input
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && batchText.trim()) {
                void steerMany(selectedIds, batchText.trim())
                setBatchText('')
                clearSelect()
              }
            }}
            placeholder="Steer all selected…  (↵ to broadcast)"
            className="min-w-0 flex-1 rounded border border-ink-500 bg-ink-700 px-2 py-1 text-xs"
          />
          <button
            onClick={() => {
              const t = batchText.trim()
              if (!t) return
              void steerMany(selectedIds, t)
              setBatchText('')
              clearSelect()
            }}
            disabled={!batchText.trim()}
            className="shrink-0 rounded bg-accent px-2.5 py-1 text-xs font-semibold text-ink-900 disabled:opacity-40 hover:bg-[#8bbcff]"
          >
            Send
          </button>
          <button onClick={() => { void stopMany(selectedIds); clearSelect() }} className="shrink-0 rounded border border-[#f06d6d]/50 px-2 py-1 text-xs text-[#f06d6d] hover:bg-[#f06d6d]/10">
            Stop
          </button>
          <button onClick={() => { void markDoneMany(selectedIds); clearSelect() }} className="shrink-0 rounded border border-ink-500 px-2 py-1 text-xs text-[#8a93a6] hover:bg-ink-700 hover:text-[#5bd4a4]">
            Done
          </button>
          <button onClick={clearSelect} className="shrink-0 rounded px-2 py-1 text-xs text-[#8a93a6] hover:bg-ink-700" title="Clear selection (Esc)">
            Clear
          </button>
        </div>
      )}
    </section>
  )
}

function Lane({
  title,
  sessions,
  action,
  collapsed,
  onToggle,
  selected,
  onToggleSelect
}: {
  title: string
  sessions: SessionInfo[]
  action?: React.ReactNode
  collapsed?: boolean
  onToggle?: () => void
  selected?: Set<string>
  onToggleSelect?: (id: string) => void
}) {
  if (sessions.length === 0) return null
  const header = (
    <>
      {title} <span className="text-[#3a4150]">· {sessions.length}</span>
    </>
  )
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        {onToggle ? (
          <button
            onClick={onToggle}
            className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#6b7280] transition-colors hover:text-[#8a93a6]"
            aria-expanded={!collapsed}
          >
            <span className="text-[#3a4150]"><Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={10} /></span>
            {header}
          </button>
        ) : (
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">{header}</h2>
        )}
        {action}
      </div>
      {!collapsed && (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              selected={selected?.has(s.id) ?? false}
              onToggleSelect={onToggleSelect ? () => onToggleSelect(s.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
