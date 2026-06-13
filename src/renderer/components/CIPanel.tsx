import { useEffect, useState } from 'react'
import type { CIRun, CIStatus } from '@shared/types'
import { relativeTime } from './bits'

const CI_META: Record<CIStatus, { color: string; label: string }> = {
  queued: { color: '#8a93a6', label: 'Queued' },
  running: { color: '#6ea8fe', label: 'Running' },
  success: { color: '#5bd4a4', label: 'Passed' },
  failure: { color: '#f06d6d', label: 'Failed' },
  cancelled: { color: '#7e8796', label: 'Cancelled' },
  unknown: { color: '#7e8796', label: 'Unknown' }
}

export function CIPanel({ sessionId }: { sessionId: string }) {
  const [runs, setRuns] = useState<CIRun[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    window.api
      .invoke('ci:recentRuns', { sessionId })
      .then((r) => setRuns(r))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">CI / CD · recent runs</span>
        <button onClick={load} className="text-[11px] text-accent hover:underline" disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {runs === null ? (
          <div className="py-10 text-center text-xs text-[#5b6472]">Loading pipeline runs…</div>
        ) : runs.length === 0 ? (
          <div className="mx-auto mt-6 max-w-xs rounded-lg border border-ink-700 px-4 py-6 text-center text-xs text-[#6b7280]">
            No CI runs found. Needs a GitHub remote with Actions and an authenticated <span className="font-mono">gh</span> CLI.
          </div>
        ) : (
          runs.map((r) => {
            const meta = CI_META[r.status]
            return (
              <a
                key={r.id}
                href={r.url || undefined}
                target="_blank"
                rel="noreferrer"
                className="mb-1 flex items-center gap-2.5 rounded-lg border border-ink-700 px-2.5 py-2 hover:bg-ink-800"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${r.status === 'running' ? 'animate-pulse' : ''}`}
                  style={{ background: meta.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-[#d7dbe3]">{r.name}</div>
                  <div className="truncate text-[11px] text-[#6b7280]">
                    {r.branch && <span className="font-mono">⎇ {r.branch}</span>}
                    {r.event && <span> · {r.event}</span>}
                    {r.createdAt > 0 && <span> · {relativeTime(r.createdAt)}</span>}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-medium" style={{ color: meta.color }}>
                  {meta.label}
                </span>
              </a>
            )
          })
        )}
      </div>
    </div>
  )
}
