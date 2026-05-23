import { useEffect, useState } from 'react'
import type { FileEntry } from '@shared/types'
import { MonacoEditor } from './MonacoEditor'

interface OpenFile {
  relPath: string
  content: string
  language: string
}

export function CodeView({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState<OpenFile | null>(null)

  const openFile = async (relPath: string) => {
    const f = await window.api.invoke('fs:readFile', { sessionId, relPath })
    setOpen({ relPath, content: f.content, language: f.language })
  }

  return (
    <div className="grid h-full min-h-0" style={{ gridTemplateColumns: '260px minmax(0, 1fr)' }}>
      <div className="min-h-0 overflow-y-auto border-r border-ink-600 py-1 text-sm">
        <Dir sessionId={sessionId} relPath="" depth={0} onOpen={openFile} />
      </div>
      <div className="min-h-0">
        {open ? (
          <MonacoEditor value={open.content} language={open.language} />
        ) : (
          <div className="grid h-full place-items-center text-xs text-[#5b6472]">Open a file to view it.</div>
        )}
      </div>
    </div>
  )
}

function Dir({
  sessionId,
  relPath,
  depth,
  onOpen
}: {
  sessionId: string
  relPath: string
  depth: number
  onOpen: (relPath: string) => void
}) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null)

  useEffect(() => {
    let alive = true
    window.api
      .invoke('fs:readDir', { sessionId, relPath })
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setEntries([]))
    return () => {
      alive = false
    }
  }, [sessionId, relPath])

  if (!entries) {
    return (
      <div className="px-2 py-0.5 text-[11px] text-[#5b6472]" style={{ paddingLeft: depth * 12 + 8 }}>
        …
      </div>
    )
  }
  return (
    <>
      {entries.map((e) => (
        <Node key={e.relPath} sessionId={sessionId} entry={e} depth={depth} onOpen={onOpen} />
      ))}
    </>
  )
}

function Node({
  sessionId,
  entry,
  depth,
  onOpen
}: {
  sessionId: string
  entry: FileEntry
  depth: number
  onOpen: (relPath: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => (entry.isDir ? setOpen(!open) : onOpen(entry.relPath))}
        className="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-ink-700"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <span className="w-3 shrink-0 text-[#6b7280]">{entry.isDir ? (open ? '▾' : '▸') : ''}</span>
        <span className="truncate text-[13px] text-[#c7cdd8]">{entry.name}</span>
      </button>
      {entry.isDir && open && <Dir sessionId={sessionId} relPath={entry.relPath} depth={depth + 1} onOpen={onOpen} />}
    </div>
  )
}
