import { useMemo, useRef, useState, useEffect } from 'react'
import { fuzzyFilter } from '@shared/fuzzy'
import { STATUS_META } from './bits'
import { useStore } from '../store/store'

interface Command {
  id: string
  label: string
  hint?: string
  dot?: string // status color for session jumps
  run: () => void
}

/**
 * ⌘K quick-switcher — the keyboard home base. Fuzzy-search across actions
 * (new session, toggle dry-run, go to board, open tasks) AND every live
 * session (jump by title). ↑/↓ to move, ↵ to run, esc to close.
 */
export function CommandPalette({ onClose, onNew, onTasks, onCost, onSettings }: { onClose: () => void; onNew: () => void; onTasks: () => void; onCost: () => void; onSettings: () => void }) {
  const sessions = useStore((s) => s.sessions)
  const order = useStore((s) => s.order)
  const select = useStore((s) => s.select)
  const openBoard = useStore((s) => s.openBoard)
  const dryRun = useStore((s) => s.policy.dryRun)
  const setDryRun = useStore((s) => s.setDryRun)

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const commands = useMemo<Command[]>(() => {
    const run = (fn: () => void) => () => {
      fn()
      onClose()
    }
    const actions: Command[] = [
      { id: 'new', label: 'New session', hint: '⌘N', run: run(onNew) },
      { id: 'board', label: 'Go to Mission Control', hint: 'esc', run: run(openBoard) },
      { id: 'tasks', label: 'Open Tasks (tracker inbox)', run: run(onTasks) },
      { id: 'cost', label: 'Cost & token observatory', run: run(onCost) },
      { id: 'settings', label: 'Settings', run: run(onSettings) },
      { id: 'dryrun', label: `Turn dry-run ${dryRun ? 'OFF' : 'ON'}`, hint: dryRun ? 'live actions' : 'safe', run: run(() => void setDryRun(!dryRun)) }
    ]
    const sessionCmds: Command[] = order
      .map((id) => sessions[id])
      .filter(Boolean)
      .map((s) => ({
        id: `s:${s.id}`,
        label: s.title,
        hint: STATUS_META[s.status].label,
        dot: STATUS_META[s.status].color,
        run: run(() => void select(s.id))
      }))
    return [...actions, ...sessionCmds]
  }, [sessions, order, dryRun, onNew, onTasks, onCost, onSettings, openBoard, select, setDryRun, onClose])

  const filtered = useMemo(() => fuzzyFilter(query, commands, (c) => c.label).slice(0, 40), [query, commands])
  useEffect(() => setActive(0), [query])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[active]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[12vh]" onClick={onClose}>
      <div
        className="w-[560px] overflow-hidden rounded-xl border border-ink-500 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to a session or run a command…"
          className="w-full border-b border-ink-600 bg-transparent px-4 py-3 text-sm text-white placeholder:text-[#5b6472] focus:outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[#5b6472]">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                onClick={c.run}
                onMouseMove={() => setActive(i)}
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm ${
                  i === active ? 'bg-accent/15 text-white' : 'text-[#c7cdd8]'
                }`}
              >
                {c.dot ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.dot }} />
                ) : (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3a4150]" />
                )}
                <span className="flex-1 truncate">{c.label}</span>
                {c.hint && <span className="shrink-0 text-[10px] text-[#5b6472]">{c.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
