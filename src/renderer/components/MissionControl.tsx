import { useState } from 'react'
import type { SessionInfo } from '@shared/types'
import { groupSessions } from '@shared/board'
import { useStore } from '../store/store'
import { NeedsYouInbox } from './NeedsYouInbox'
import { SessionCard } from './SessionCard'

// Persist the Done-lane collapse so the board stays decluttered across restarts.
const DONE_COLLAPSED_KEY = 'mc.doneCollapsed'

export function MissionControl({ onNew }: { onNew: () => void }) {
  const sessions = useStore((s) => s.sessions)
  const order = useStore((s) => s.order)
  const reclaimIdle = useStore((s) => s.reclaimIdle)
  const [doneCollapsed, setDoneCollapsed] = useState<boolean>(
    () => localStorage.getItem(DONE_COLLAPSED_KEY) !== 'false' // default collapsed (declutter)
  )

  const toggleDone = () =>
    setDoneCollapsed((v) => {
      const next = !v
      localStorage.setItem(DONE_COLLAPSED_KEY, String(next))
      return next
    })

  const ordered = order.map((id) => sessions[id]).filter(Boolean) as SessionInfo[]
  const groups = groupSessions(ordered)
  const total = ordered.length

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-ink-900 px-5 py-4">
      <div className="mb-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Needs you</h2>
        <NeedsYouInbox />
      </div>

      {total === 0 ? (
        <div className="grid place-items-center py-16 text-center">
          <div>
            <div className="text-sm text-[#8a93a6]">No agents yet.</div>
            <button onClick={onNew} className="mt-3 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-ink-900 hover:bg-[#8bbcff]">
              Spawn your first agent
            </button>
          </div>
        </div>
      ) : (
        <>
          <Lane title="Running" sessions={groups.running} />
          <Lane
            title="Idle"
            sessions={groups.idle}
            action={
              groups.idle.length > 0 ? (
                <button onClick={() => void reclaimIdle()} className="text-[11px] text-accent hover:underline" title="Stop idle sessions to free their concurrency slots">
                  Reclaim {groups.idle.length} slot{groups.idle.length > 1 ? 's' : ''}
                </button>
              ) : undefined
            }
          />
          <Lane title="Done" sessions={groups.done} collapsed={doneCollapsed} onToggle={toggleDone} />
        </>
      )}
    </section>
  )
}

function Lane({
  title,
  sessions,
  action,
  collapsed,
  onToggle
}: {
  title: string
  sessions: SessionInfo[]
  action?: React.ReactNode
  collapsed?: boolean
  onToggle?: () => void
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
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#6b7280] hover:text-[#8a93a6]"
            aria-expanded={!collapsed}
          >
            <span className="text-[9px] text-[#3a4150]">{collapsed ? '▸' : '▾'}</span>
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
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  )
}
