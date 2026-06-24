import { useEffect, useMemo, useState } from 'react'
import type { FileEntry, TranscriptMessage } from '@shared/types'
import { activeFile, recentFiles, relativeTo, type FileAction } from '@shared/activeFile'
import { taskColor } from '@shared/agentBadge'
import { useStore } from '../store/store'
import { MonacoEditor } from './MonacoEditor'
import { AgentMascot } from './AgentMascot'

interface OpenFile {
  relPath: string
  content: string
  language: string
}

interface Presence {
  activeRel: string | null
  action: FileAction | null
  running: boolean
  recentRel: Set<string>
  ancestors: Set<string> // ancestor dir relPaths of the active file
  color: string
}

const EMPTY: TranscriptMessage[] = []
const VERB: Record<FileAction, string> = { read: 'Reading', edit: 'Editing', write: 'Writing' }

export function CodeView({ sessionId }: { sessionId: string }) {
  const session = useStore((s) => s.sessions[sessionId])
  const messages = useStore((s) => s.messages[sessionId] ?? EMPTY)
  const [open, setOpen] = useState<OpenFile | null>(null)
  const [follow, setFollow] = useState(false)

  const cwd = session?.cwd ?? ''
  const color = session ? taskColor(session) : '#6ea8fe'

  const active = useMemo(() => activeFile(messages), [messages])
  const activeRel = active ? relativeTo(cwd, active.path) : null
  const recentRel = useMemo(() => new Set(recentFiles(messages).map((f) => relativeTo(cwd, f.path))), [messages, cwd])
  const ancestors = useMemo(() => {
    const set = new Set<string>()
    if (activeRel) {
      const parts = activeRel.split('/')
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'))
    }
    return set
  }, [activeRel])

  const openFile = async (relPath: string) => {
    const f = await window.api.invoke('fs:readFile', { sessionId, relPath })
    setOpen({ relPath, content: f.content, language: f.language })
  }

  // Follow mode: open the file the agent is on as it moves through the tree.
  useEffect(() => {
    if (follow && activeRel && activeRel.includes('.') && activeRel !== open?.relPath) void openFile(activeRel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, activeRel])

  const presence: Presence = { activeRel, action: active?.action ?? null, running: active?.running ?? false, recentRel, ancestors, color }

  return (
    <div className="grid h-full min-h-0" style={{ gridTemplateColumns: '280px minmax(0, 1fr)' }}>
      <div className="flex min-h-0 flex-col border-r border-ink-600">
        <div className="flex items-center justify-between px-2 py-1.5 text-[11px] uppercase tracking-wide text-[#6b7280]">
          <span>Files</span>
          {activeRel && (
            <button
              onClick={() => setFollow((v) => !v)}
              title="Open the file the agent is on, and follow as it moves"
              className={`rounded px-1.5 py-0.5 text-[10px] normal-case ${follow ? 'bg-accent/20 text-accent' : 'text-[#6b7280] hover:bg-ink-700'}`}
            >
              {follow ? '◉ Following' : '○ Follow agent'}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1 text-sm">
          <Dir sessionId={sessionId} relPath="" depth={0} onOpen={openFile} presence={presence} />
        </div>
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
  onOpen,
  presence
}: {
  sessionId: string
  relPath: string
  depth: number
  onOpen: (relPath: string) => void
  presence: Presence
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
        <Node key={e.relPath} sessionId={sessionId} entry={e} depth={depth} onOpen={onOpen} presence={presence} />
      ))}
    </>
  )
}

function Node({
  sessionId,
  entry,
  depth,
  onOpen,
  presence
}: {
  sessionId: string
  entry: FileEntry
  depth: number
  onOpen: (relPath: string) => void
  presence: Presence
}) {
  const isActive = !entry.isDir && entry.relPath === presence.activeRel
  const isAncestor = entry.isDir && presence.ancestors.has(entry.relPath)
  const isRecent = !entry.isDir && !isActive && presence.recentRel.has(entry.relPath)
  const [open, setOpen] = useState(isAncestor)

  // Auto-reveal: as the agent moves into a folder, expand it so its location shows.
  useEffect(() => {
    if (isAncestor) setOpen(true)
  }, [isAncestor])

  return (
    <div>
      <button
        onClick={() => (entry.isDir ? setOpen(!open) : onOpen(entry.relPath))}
        className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left hover:bg-ink-700"
        style={{ paddingLeft: depth * 12 + 8, background: isActive ? `${presence.color}22` : undefined }}
      >
        <span className="w-3 shrink-0 text-[#6b7280]">{entry.isDir ? (open ? '▾' : '▸') : ''}</span>
        <span
          className={`truncate text-[13px] ${isActive ? 'font-medium' : 'text-[#c7cdd8]'}`}
          style={isActive ? { color: presence.color } : undefined}
        >
          {entry.name}
        </span>
        {isActive && presence.action && (
          <AgentMascot color={presence.color} running={presence.running} title={`${VERB[presence.action]} ${entry.name}`} />
        )}
        {isAncestor && !open && <AgentMascot color={presence.color} running={presence.running} size={12} title="agent is working in here" />}
        {isRecent && (
          <span className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `${presence.color}aa` }} title="recently touched" />
        )}
      </button>
      {entry.isDir && open && <Dir sessionId={sessionId} relPath={entry.relPath} depth={depth + 1} onOpen={onOpen} presence={presence} />}
    </div>
  )
}
