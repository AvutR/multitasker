import { useEffect, useState } from 'react'
import type { MemoryNote } from '@shared/types'
import { useStore } from '../store/store'
import { relativeTime } from './bits'

/**
 * The agent's context window into a project: the per-task brief it was primed
 * with at spawn (context min-maxing, made visible), plus the shared project
 * memory that accumulates across runs. Read-only — so the orchestration is
 * legible: you can see what context it had and what it learned.
 */
export function MemoryPanel({ sessionId }: { sessionId: string }) {
  const taskBrief = useStore((s) => s.sessions[sessionId]?.taskBrief)
  const [notes, setNotes] = useState<MemoryNote[] | null>(null)

  const load = () => {
    window.api
      .invoke('memory:list', { sessionId })
      .then(setNotes)
      .catch(() => setNotes([]))
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 5000) // keep it live as agents write notes
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Project memory</span>
        <span className="text-[11px] text-[#5b6472]">{notes?.length ?? 0} note{notes?.length === 1 ? '' : 's'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {taskBrief && (
          <div className="mb-3 rounded-lg border border-accent/25 bg-accent/[0.04] px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent/80">Task context · primed at spawn</div>
            <div className="whitespace-pre-wrap text-[11px] leading-relaxed text-[#c7cdd8]">
              {taskBrief.replace(/^# Task context\n+/, '').trim()}
            </div>
          </div>
        )}
        {notes === null ? (
          <div className="py-10 text-center text-xs text-[#5b6472]">Loading…</div>
        ) : notes.length === 0 ? (
          <div className="mx-auto mt-6 max-w-xs rounded-lg border border-ink-700 px-4 py-6 text-center text-xs text-[#6b7280]">
            No memory yet. Agents save notes here with the <span className="font-mono text-[#8a93a6]">remember</span> tool — decisions, gotchas, what a sub-task concluded — and recall them in later runs.
          </div>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="mb-1 rounded-lg border border-ink-700 px-3 py-2">
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-[#d7dbe3]">{n.text}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-[#5b6472]">
                {n.tag && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">{n.tag}</span>}
                <span>{relativeTime(n.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
