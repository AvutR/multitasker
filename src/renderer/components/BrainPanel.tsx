import { useEffect, useState } from 'react'
import type { BrainSkill, BrainStats, SkillKind } from '@shared/brain'
import { relativeTime } from './bits'

/**
 * The central BRAIN: the learned skills the app accumulates across every task in
 * this project (plus global ones), so future runs recall them up front instead of
 * re-deriving — faster, fewer tokens. Pin the ones you want kept forever; delete
 * noise. This is the memory-optimization surface made legible.
 */

const KIND_LABEL: Record<SkillKind, string> = { skill: 'how-to', gotcha: 'gotcha', map: 'where', pattern: 'pattern' }
const KIND_COLOR: Record<SkillKind, string> = {
  skill: 'text-[#7dd3fc] bg-[#7dd3fc]/10',
  gotcha: 'text-[#fca5a5] bg-[#fca5a5]/10',
  map: 'text-[#86efac] bg-[#86efac]/10',
  pattern: 'text-[#d8b4fe] bg-[#d8b4fe]/10'
}

export function BrainPanel({ sessionId }: { sessionId: string }) {
  const [skills, setSkills] = useState<BrainSkill[] | null>(null)
  const [stats, setStats] = useState<BrainStats | null>(null)

  const load = () => {
    window.api
      .invoke('brain:list', { sessionId })
      .then((r) => {
        setSkills(r.skills)
        setStats(r.stats)
      })
      .catch(() => {
        setSkills([])
        setStats(null)
      })
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 5000) // keep it live as agents learn
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const pin = (id: string, pinned: boolean) => {
    void window.api.invoke('brain:setPinned', { id, pinned }).then(load)
  }
  const remove = (id: string) => {
    void window.api.invoke('brain:delete', { id }).then(load)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Central brain</span>
        {stats && (
          <span className="text-[11px] text-[#5b6472]">
            {stats.total} skill{stats.total === 1 ? '' : 's'} · {stats.reuse} reuse{stats.pinned ? ` · ${stats.pinned} pinned` : ''}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {skills === null ? (
          <div className="py-10 text-center text-xs text-[#5b6472]">Loading…</div>
        ) : skills.length === 0 ? (
          <div className="mx-auto mt-6 max-w-xs rounded-lg border border-ink-700 px-4 py-6 text-center text-xs text-[#6b7280]">
            The brain is empty. As agents work, they <span className="font-mono text-[#8a93a6]">learn</span> durable skills —
            how-tos, gotchas, where things live — and recall them on future tasks so they don&apos;t re-derive. It grows on its own.
          </div>
        ) : (
          skills.map((s) => (
            <div key={s.id} className="group mb-1 rounded-lg border border-ink-700 px-3 py-2 hover:border-ink-600">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${KIND_COLOR[s.kind]}`}>{KIND_LABEL[s.kind]}</span>
                  <span className="text-xs font-semibold text-[#d7dbe3]">{s.title}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => pin(s.id, !s.pinned)}
                    title={s.pinned ? 'Unpin' : 'Pin (keep forever)'}
                    className={`text-[12px] ${s.pinned ? 'text-accent' : 'text-[#5b6472] hover:text-[#8a93a6]'}`}
                  >
                    {s.pinned ? '★' : '☆'}
                  </button>
                  <button onClick={() => remove(s.id)} title="Forget" className="text-[12px] text-[#5b6472] hover:text-[#fca5a5]">
                    ✕
                  </button>
                </div>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[#aeb6c2]">{s.body}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-[#5b6472]">
                {s.scope === 'global' && <span className="rounded bg-[#fbbf24]/10 px-1.5 py-0.5 text-[#fbbf24]">global</span>}
                {s.useCount > 0 && <span>reused {s.useCount}×</span>}
                <span>{relativeTime(s.lastUsedAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
