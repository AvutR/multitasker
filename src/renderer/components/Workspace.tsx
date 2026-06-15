import { useState } from 'react'
import { isRevivableStatus } from '@shared/board'
import { useStore } from '../store/store'
import { Icon } from './Icon'
import { formatCost, StatusDot } from './bits'
import { Transcript } from './Transcript'
import { CodeView } from './CodeView'
import { DiffView } from './DiffView'
import { CIPanel } from './CIPanel'
import { MemoryPanel } from './MemoryPanel'
import { SubAgentsPanel } from './SubAgentsPanel'
import { TrustBar } from './TrustBar'

type Tab = 'transcript' | 'code' | 'diff' | 'ci' | 'memory' | 'subagents'
const BASE_TABS: { id: Tab; label: string }[] = [
  { id: 'transcript', label: 'Transcript' },
  { id: 'code', label: 'Code' },
  { id: 'diff', label: 'Diff' },
  { id: 'ci', label: 'CI/CD' },
  { id: 'memory', label: 'Memory' }
]

export function Workspace() {
  const selectedId = useStore((s) => s.selectedId)
  const session = useStore((s) => (selectedId ? s.sessions[selectedId] : undefined))
  const models = useStore((s) => s.models)
  const resume = useStore((s) => s.resume)
  const markDone = useStore((s) => s.markDone)
  // A conductor's sub-agents get their own tab — only when it has delegated any.
  const childCount = useStore((s) => (selectedId ? Object.values(s.sessions).filter((x) => x.parentId === selectedId).length : 0))
  const [tab, setTab] = useState<Tab>('transcript')
  const TABS = childCount > 0 ? [...BASE_TABS, { id: 'subagents' as Tab, label: `Sub-agents (${childCount})` }] : BASE_TABS
  // Fall back if the active tab no longer exists (e.g. the sub-agents tab vanished).
  const activeTab: Tab = TABS.some((t) => t.id === tab) ? tab : 'transcript'

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
        <div className="flex items-center gap-2">
          {(session.status === 'running' || session.status === 'queued' || session.status === 'awaiting_input') && (
            <button
              onClick={() => void markDone(session.id)}
              title="Done — stop the agent and move this task to Done"
              className="inline-flex items-center gap-1.5 rounded border border-ink-500 px-2.5 py-1 text-xs font-medium text-[#8a93a6] transition-colors hover:bg-ink-700 hover:text-[#5bd4a4]"
            >
              <Icon name="done" /> Done
            </button>
          )}
          {isRevivableStatus(session.status) && (
            <button
              onClick={() => void resume(session.id)}
              title="Resume — wake this session with its full context; it waits for your prompt before doing anything"
              className="inline-flex items-center gap-1.5 rounded border border-[#5bd4a4]/40 px-2.5 py-1 text-xs font-medium text-[#5bd4a4] transition-colors hover:bg-[#5bd4a4]/10"
            >
              <Icon name="resume" /> Resume
            </button>
          )}
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  activeTab === t.id ? 'bg-ink-600 text-white' : 'text-[#8a93a6] hover:bg-ink-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {activeTab === 'transcript' && <Transcript sessionId={session.id} />}
        {activeTab === 'code' && <CodeView sessionId={session.id} />}
        {activeTab === 'diff' && <DiffView sessionId={session.id} />}
        {activeTab === 'ci' && <CIPanel sessionId={session.id} />}
        {activeTab === 'memory' && <MemoryPanel sessionId={session.id} />}
        {activeTab === 'subagents' && <SubAgentsPanel sessionId={session.id} />}
      </div>
    </section>
  )
}
