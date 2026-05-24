import { useEffect, useState } from 'react'
import { useStore } from './store/store'
import { formatCost } from './components/bits'
import { SessionsRail } from './components/SessionsRail'
import { Workspace } from './components/Workspace'
import { PolicyConsole } from './components/PolicyConsole'
import { ActivityFeed } from './components/ActivityFeed'
import { NewSessionModal } from './components/NewSessionModal'
import { LinearPanel } from './components/LinearPanel'

export function App() {
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  const [showNew, setShowNew] = useState(false)
  const [showLinear, setShowLinear] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="flex h-full flex-col bg-ink-900 text-[#d7dbe3]">
      <Header onNew={() => setShowNew(true)} onLinear={() => setShowLinear(true)} />
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '300px minmax(0, 1fr) 380px' }}>
        <SessionsRail onNew={() => setShowNew(true)} />
        <Workspace />
        <aside className="flex min-h-0 flex-col border-l border-ink-600 bg-ink-900">
          <PolicyConsole />
          <ActivityFeed />
        </aside>
      </div>
      {showNew && <NewSessionModal onClose={() => setShowNew(false)} />}
      {showLinear && <LinearPanel onClose={() => setShowLinear(false)} />}
      {!ready && (
        <div className="pointer-events-none fixed inset-0 grid place-items-center">
          <span className="rounded bg-ink-700 px-3 py-1.5 text-sm text-[#8a93a6]">Connecting to orchestrator…</span>
        </div>
      )}
    </div>
  )
}

function Header({ onNew, onLinear }: { onNew: () => void; onLinear: () => void }) {
  // Select the stable state slice; derive arrays in render. Returning
  // Object.values(...) directly from the selector makes a new array each call
  // and sends Zustand's useSyncExternalStore into an infinite loop.
  const sessionMap = useStore((s) => s.sessions)
  const dryRun = useStore((s) => s.policy.dryRun)
  const setDryRun = useStore((s) => s.setDryRun)

  const sessions = Object.values(sessionMap)
  const active = sessions.filter((s) => s.status === 'running' || s.status === 'awaiting_plan_approval').length
  const queued = sessions.filter((s) => s.status === 'queued').length
  const cost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0)

  return (
    <header className="drag flex h-12 shrink-0 items-center justify-between border-b border-ink-600 bg-ink-800 pl-20 pr-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-tight text-white">Multitasker</span>
        <span className="text-[11px] text-[#5b6472]">parallel agents, atop Claude Code</span>
      </div>
      <div className="no-drag flex items-center gap-3 text-xs text-[#8a93a6]">
        <span>
          <span className="text-accent">{active}</span> active · {queued} queued
        </span>
        <span className="tabular-nums">{formatCost(cost)} today</span>
        <button
          onClick={() => void setDryRun(!dryRun)}
          title="Global dry-run: when ON, no action ever hits a live connector."
          className={`rounded px-2 py-1 font-medium ${
            dryRun ? 'bg-accent/20 text-accent' : 'bg-ink-600 text-[#8a93a6]'
          }`}
        >
          Dry-run {dryRun ? 'ON' : 'OFF'}
        </button>
        <button
          onClick={onLinear}
          title="Start work from a Linear issue assigned to you"
          className="rounded bg-ink-600 px-2.5 py-1 font-medium text-[#b9c0cc] hover:bg-ink-500"
        >
          Linear
        </button>
        <button
          onClick={onNew}
          className="rounded bg-accent px-2.5 py-1 font-semibold text-ink-900 hover:bg-[#8bbcff]"
        >
          + New
        </button>
      </div>
    </header>
  )
}
