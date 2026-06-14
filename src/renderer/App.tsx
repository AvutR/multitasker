import { useEffect, useState } from 'react'
import { rankNeedsYou } from '@shared/board'
import { useStore } from './store/store'
import { formatCost } from './components/bits'
import { MissionControl } from './components/MissionControl'
import { Workspace } from './components/Workspace'
import { PolicyConsole } from './components/PolicyConsole'
import { ActivityFeed } from './components/ActivityFeed'
import { NewSessionModal } from './components/NewSessionModal'
import { LinearPanel } from './components/LinearPanel'
import { CommandPalette } from './components/CommandPalette'

export function App() {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const selectedId = useStore((s) => s.selectedId)
  const hasSession = useStore((s) => (s.selectedId ? Boolean(s.sessions[s.selectedId]) : false))
  const openBoard = useStore((s) => s.openBoard)
  const [showNew, setShowNew] = useState(false)
  const [showLinear, setShowLinear] = useState(false)
  const [showPalette, setShowPalette] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  // Global keyboard home base: ⌘K palette, ⌘N new, esc steps back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((v) => !v)
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setShowNew(true)
      } else if (e.key === 'Escape') {
        // Let an open overlay handle its own Escape; otherwise step back to the board.
        if (showPalette || showNew || showLinear) return
        if (view === 'session') openBoard()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showPalette, showNew, showLinear, view, openBoard])

  const inSession = view === 'session' && selectedId && hasSession

  return (
    <div className="flex h-full flex-col bg-ink-900 text-[#d7dbe3]">
      <Header onNew={() => setShowNew(true)} onLinear={() => setShowLinear(true)} onPalette={() => setShowPalette(true)} />
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }}>
        {inSession ? (
          <section className="flex min-h-0 flex-col bg-ink-900">
            <button
              onClick={openBoard}
              className="flex items-center gap-1 border-b border-ink-600 px-3 py-1.5 text-left text-xs text-[#8a93a6] hover:text-white"
            >
              ← Mission Control
            </button>
            <Workspace />
          </section>
        ) : (
          <MissionControl onNew={() => setShowNew(true)} />
        )}
        <aside className="flex min-h-0 flex-col border-l border-ink-600 bg-ink-900">
          <PolicyConsole />
          <ActivityFeed />
        </aside>
      </div>
      {showNew && <NewSessionModal onClose={() => setShowNew(false)} />}
      {showLinear && <LinearPanel onClose={() => setShowLinear(false)} />}
      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          onNew={() => setShowNew(true)}
          onTasks={() => setShowLinear(true)}
        />
      )}
      {!ready && (
        <div className="pointer-events-none fixed inset-0 grid place-items-center">
          <span className="rounded bg-ink-700 px-3 py-1.5 text-sm text-[#8a93a6]">Connecting to orchestrator…</span>
        </div>
      )}
    </div>
  )
}

function Header({ onNew, onLinear, onPalette }: { onNew: () => void; onLinear: () => void; onPalette: () => void }) {
  const sessions = useStore((s) => s.sessions)
  const planRequests = useStore((s) => s.planRequests)
  const actions = useStore((s) => s.actions)
  const dryRun = useStore((s) => s.policy.dryRun)
  const setDryRun = useStore((s) => s.setDryRun)
  const cap = useStore((s) => s.settings.concurrencyCap)
  const patchSettings = useStore((s) => s.patchSettings)
  const openBoard = useStore((s) => s.openBoard)

  const list = Object.values(sessions)
  const active = list.filter((s) => s.status === 'running' || s.status === 'awaiting_plan_approval').length
  const queued = list.filter((s) => s.status === 'queued').length
  const cost = list.reduce((sum, s) => sum + s.totalCostUsd, 0)
  const needsYou = rankNeedsYou(list, Object.values(planRequests), actions).length

  return (
    <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-ink-600 bg-ink-800 pl-20 pr-3">
      <button onClick={openBoard} className="no-drag flex items-baseline gap-2 text-left">
        <span className="text-sm font-semibold tracking-tight text-white">Multitasker</span>
        {needsYou > 0 && (
          <span className="rounded-full bg-[#f5c451] px-1.5 text-[10px] font-bold text-ink-900" title="items need your attention">
            {needsYou} needs you
          </span>
        )}
      </button>
      <div className="no-drag flex items-center gap-3 text-xs text-[#8a93a6]">
        <span>
          <span className="text-accent">{active}</span> active{queued > 0 && ` · ${queued} queued`}
        </span>
        <span className="flex items-center gap-1" title="Max concurrent live agents (each holds a Claude Code subprocess)">
          cap
          <button onClick={() => void patchSettings({ concurrencyCap: Math.max(1, cap - 1) })} className="rounded bg-ink-600 px-1.5 hover:bg-ink-500">
            −
          </button>
          <span className="tabular-nums text-[#d7dbe3]">{cap}</span>
          <button onClick={() => void patchSettings({ concurrencyCap: cap + 1 })} className="rounded bg-ink-600 px-1.5 hover:bg-ink-500">
            +
          </button>
        </span>
        <span className="tabular-nums">{formatCost(cost)}</span>
        <button
          onClick={() => void setDryRun(!dryRun)}
          title="Global dry-run: when ON, no action ever hits a live connector."
          className={`rounded px-2 py-1 font-semibold ${dryRun ? 'bg-accent/20 text-accent' : 'bg-[#f06d6d]/20 text-[#f06d6d]'}`}
        >
          Dry-run {dryRun ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={onPalette}
          title="Command palette — jump to any session or run a command (⌘K)"
          className="flex items-center gap-1.5 rounded bg-ink-600 px-2.5 py-1 font-medium text-[#b9c0cc] hover:bg-ink-500"
        >
          <span>Search</span>
          <kbd className="rounded bg-ink-800 px-1 text-[10px] text-[#6b7280]">⌘K</kbd>
        </button>
        <button onClick={onLinear} className="rounded bg-ink-600 px-2.5 py-1 font-medium text-[#b9c0cc] hover:bg-ink-500">
          Tasks
        </button>
        <button onClick={onNew} className="rounded bg-accent px-2.5 py-1 font-semibold text-ink-900 hover:bg-[#8bbcff]">
          + New
        </button>
      </div>
    </header>
  )
}
