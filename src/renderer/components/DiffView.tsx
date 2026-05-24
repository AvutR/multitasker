import { useEffect, useState } from 'react'
import type { DiffFile } from '@shared/types'
import { useStore } from '../store/store'
import { MonacoDiff } from './MonacoDiff'

export function DiffView({ sessionId }: { sessionId: string }) {
  const branch = useStore((s) => s.sessions[sessionId]?.branch)
  const undoLastCommit = useStore((s) => s.undoLastCommit)
  const [files, setFiles] = useState<DiffFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const reload = async () => {
    const d = await window.api.invoke('git:diff', { sessionId })
    setFiles(d)
    setSelected((prev) => (prev && d.some((f) => f.relPath === prev) ? prev : d[0]?.relPath ?? null))
  }

  useEffect(() => {
    let alive = true
    window.api
      .invoke('git:diff', { sessionId })
      .then((d) => {
        if (!alive) return
        setFiles(d)
        setSelected(d[0]?.relPath ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [sessionId])

  const current = files.find((f) => f.relPath === selected) ?? null

  const commit = async () => {
    if (!message.trim()) return
    setBusy(true)
    try {
      const r = await window.api.invoke('git:commit', { sessionId, message: message.trim() })
      setNote(r.committed ? `Committed ${r.hash?.slice(0, 7) ?? ''}` : r.reason ?? 'nothing to commit')
      if (r.committed) {
        setMessage('')
        await reload()
      }
    } finally {
      setBusy(false)
    }
  }

  const undo = async () => {
    setBusy(true)
    try {
      const r = await undoLastCommit(sessionId)
      setNote(r.undone ? `Undid "${(r.subject ?? '').slice(0, 40)}" — changes restored to the working tree` : r.reason ?? 'nothing to undo')
      if (r.undone) await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '260px minmax(0, 1fr)' }}>
        <div className="min-h-0 overflow-y-auto border-r border-ink-600">
          <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-[#6b7280]">
            <span>{files.length} changed</span>
            <button onClick={() => void reload()} className="hover:text-accent" title="Refresh">
              ↻
            </button>
          </div>
          {files.map((f) => (
            <button
              key={f.relPath}
              onClick={() => setSelected(f.relPath)}
              className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs ${
                selected === f.relPath ? 'bg-ink-600' : 'hover:bg-ink-700'
              }`}
            >
              <span className="truncate font-mono text-[#c7cdd8]" title={f.relPath}>
                {f.relPath}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="text-[#5bd4a4]">+{f.additions}</span>{' '}
                <span className="text-[#f06d6d]">-{f.deletions}</span>
              </span>
            </button>
          ))}
          {files.length === 0 && (
            <div className="px-2 py-6 text-center text-[11px] text-[#5b6472]">Working tree clean.</div>
          )}
        </div>
        <div className="min-h-0">
          {current ? (
            <MonacoDiff original={current.oldContent} modified={current.newContent} language={langFor(current.relPath)} />
          ) : (
            <div className="grid h-full place-items-center text-xs text-[#5b6472]">No changes to review.</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-ink-600 px-3 py-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={`Commit locally${branch ? ` to ⎇ ${branch}` : ''} — no push`}
          className="flex-1 rounded border border-ink-500 bg-ink-700 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => void commit()}
          disabled={busy || !message.trim() || files.length === 0}
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-ink-900 disabled:opacity-40 hover:bg-[#8bbcff]"
        >
          {busy ? 'Committing…' : 'Land (commit)'}
        </button>
        <button
          onClick={() => void undo()}
          disabled={busy}
          title="Soft-reset the last commit; changes return to the working tree"
          className="rounded border border-ink-500 px-3 py-1.5 text-sm text-[#b9c0cc] disabled:opacity-40 hover:bg-ink-700"
        >
          Undo
        </button>
        {note && <span className="text-[11px] text-[#6b7280]">{note}</span>}
      </div>
    </div>
  )
}

function langFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    py: 'python',
    sql: 'sql',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml'
  }
  return map[ext] ?? 'plaintext'
}
