import type { SessionInfo } from '@shared/types'
import { groupSessions } from '@shared/board'
import { useStore } from '../store/store'
import { NeedsYouInbox } from './NeedsYouInbox'
import { SessionCard } from './SessionCard'

export function MissionControl({ onNew }: { onNew: () => void }) {
  const sessions = useStore((s) => s.sessions)
  const order = useStore((s) => s.order)
  const reclaimIdle = useStore((s) => s.reclaimIdle)

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
          <Lane title="Done" sessions={groups.done} />
        </>
      )}
    </section>
  )
}

function Lane({ title, sessions, action }: { title: string; sessions: SessionInfo[]; action?: React.ReactNode }) {
  if (sessions.length === 0) return null
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
          {title} <span className="text-[#3a4150]">· {sessions.length}</span>
        </h2>
        {action}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
        {sessions.map((s) => (
          <SessionCard key={s.id} session={s} />
        ))}
      </div>
    </div>
  )
}
