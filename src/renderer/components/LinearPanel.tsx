import { useEffect, useState } from 'react'
import { useStore } from '../store/store'
import { Badge } from './bits'

export function LinearPanel({ onClose }: { onClose: () => void }) {
  const issues = useStore((s) => s.myLinearIssues)
  const loading = useStore((s) => s.linearLoading)
  const error = useStore((s) => s.linearError)
  const fetchIssues = useStore((s) => s.fetchLinearIssues)
  const startFromIssue = useStore((s) => s.startFromIssue)
  const order = useStore((s) => s.order)
  const sessions = useStore((s) => s.sessions)
  const repos = useStore((s) => s.repos)

  // Directory automation: default to the most-recently-used working dir.
  const [cwd, setCwd] = useState(sessions[order[0]]?.cwd ?? repos[0]?.path ?? '')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void fetchIssues()
  }, [fetchIssues])

  const start = async (key: string) => {
    const issue = issues.find((i) => (i.id || i.identifier) === key)
    if (!issue || !cwd.trim()) return
    setBusy(key)
    try {
      await startFromIssue(issue, cwd.trim())
      onClose()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[640px] flex-col overflow-hidden rounded-lg border border-ink-500 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
          <div className="text-sm font-semibold text-white">Your tasks</div>
          <button onClick={() => void fetchIssues(true)} className="text-xs text-accent hover:underline">
            ↻ Refresh
          </button>
        </div>

        <div className="border-b border-ink-600 px-4 py-2">
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-[#6b7280]">
            Working directory — a branch is auto-created per issue
          </label>
          <input
            list="repo-paths-linear"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/absolute/path/to/repo"
            className="w-full rounded border border-ink-500 bg-ink-700 px-2 py-1.5 font-mono text-xs"
          />
          <datalist id="repo-paths-linear">
            {repos.map((r) => (
              <option key={r.id} value={r.path} />
            ))}
          </datalist>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && (
            <div className="px-2 py-8 text-center text-xs text-[#6b7280]">Fetching your assigned issues from Linear…</div>
          )}
          {error && <div className="px-2 py-6 text-center text-xs text-[#f06d6d]">{error}</div>}
          {!loading && !error && issues.length === 0 && (
            <div className="px-2 py-8 text-center text-xs text-[#5b6472]">No open issues assigned to you.</div>
          )}
          {issues.map((i) => {
            const key = i.id || i.identifier
            return (
              <div
                key={key}
                className="mb-1.5 flex items-center justify-between gap-3 rounded border border-ink-700 px-3 py-2 hover:bg-ink-700"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-accent">{i.identifier}</span>
                    {i.state && <Badge>{i.state}</Badge>}
                  </div>
                  <div className="truncate text-sm text-[#d7dbe3]">{i.title}</div>
                  <div className="truncate font-mono text-[10px] text-[#5b6472]">⎇ {i.branchName}</div>
                </div>
                <button
                  onClick={() => void start(key)}
                  disabled={busy !== null || !cwd.trim()}
                  className="shrink-0 rounded bg-accent px-2.5 py-1 text-xs font-semibold text-ink-900 disabled:opacity-40 hover:bg-[#8bbcff]"
                >
                  {busy === key ? 'Starting…' : 'Start work →'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="border-t border-ink-600 px-4 py-2 text-right">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-[#8a93a6] hover:bg-ink-700">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
