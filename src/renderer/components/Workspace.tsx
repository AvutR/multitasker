import { useState } from 'react'
import { useStore } from '../store/store'
import { formatCost, StatusDot } from './bits'
import { Transcript } from './Transcript'
import { CodeView } from './CodeView'
import { DiffView } from './DiffView'
import { TrustBar } from './TrustBar'

type Tab = 'transcript' | 'code' | 'diff'
const TABS: { id: Tab; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'code', label: 'Code' },
  { id: 'diff', label: 'Diff' }
]

export function Workspace() {
  const selectedId = useStore((s) => s.selectedId)
  const session = useStore((s) => (selectedId ? s.sessions[selectedId] : undefined))
  const models = useStore((s) => s.models)
  const [tab, setTab] = useState<Tab>('transcript')

  if (!session) {
    return (
      <section className="grid min-h-0 place-items-center bg-ink-900 text-sm text-[#5b6472]">
        Select a session, or spawn a new agent to begin.
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-col bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">{session.title}</div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-[#6b7280]">
            <StatusDot status={session.status} />
            {session.model && <span>{models.find((m) => m.id === session.model)?.label ?? session.model}</span>}
            <span>{session.numTurns} turns</span>
            <span className="tabular-nums">{formatCost(session.totalCostUsd)}</span>
          </div>
          <div className="mt-0.5">
            <TrustBar sessionId={session.id} branch={session.branch} />
          </div>
        </div>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                tab === t.id ? 'bg-ink-600 text-white' : 'text-[#8a93a6] hover:bg-ink-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'transcript' && <Transcript sessionId={session.id} />}
        {tab === 'code' && <CodeView sessionId={session.id} />}
        {tab === 'diff' && <DiffView sessionId={session.id} />}
      </div>
    </section>
  )
}
