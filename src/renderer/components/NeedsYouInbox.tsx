import { useState } from 'react'
import type { NeedsYouItem } from '@shared/types'
import { rankNeedsYou } from '@shared/board'
import { useStore } from '../store/store'
import { Icon } from './Icon'

const KIND_GLYPH: Record<NeedsYouItem['kind'], string> = { error: '✕', plan: '◆', action: '↗' }
const KIND_COLOR: Record<NeedsYouItem['kind'], string> = { error: '#f06d6d', plan: '#f5c451', action: '#6ea8fe' }

export function NeedsYouInbox() {
  const sessions = useStore((s) => s.sessions)
  const planRequests = useStore((s) => s.planRequests)
  const actions = useStore((s) => s.actions)
  const select = useStore((s) => s.select)
  const approvePlan = useStore((s) => s.approvePlan)
  const decideAction = useStore((s) => s.decideAction)
  const deleteSession = useStore((s) => s.deleteSession)
  const resume = useStore((s) => s.resume)
  // Disable an action's buttons the instant it's clicked, so the (brief) window
  // before the item leaves the queue can't be double-clicked.
  const [deciding, setDeciding] = useState<Set<string>>(() => new Set())

  const items = rankNeedsYou(Object.values(sessions), Object.values(planRequests), actions)
  const running = Object.values(sessions).filter((s) => s.status === 'running').length

  const onDecide = (actionId: string, approve: boolean) => {
    if (deciding.has(actionId)) return
    setDeciding((s) => new Set(s).add(actionId))
    void decideAction(actionId, approve)
  }

  const onDelete = (sessionId: string, title: string) => {
    if (window.confirm(`Delete "${title}"?\nThis stops the agent and removes it from the board. This can't be undone.`)) {
      void deleteSession(sessionId)
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[#5bd4a4]/20 bg-[#5bd4a4]/[0.04] px-4 py-5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#5bd4a4]/30 text-[#5bd4a4]">
          <Icon name="done" size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-sm text-[#d7dbe3]">All caught up</div>
          <div className="mt-0.5 text-[11px] text-[#6b7280]">
            {running > 0 ? `${running} agent${running > 1 ? 's' : ''} running clean — nothing needs you right now.` : 'Nothing needs your attention.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div
          key={`${item.kind}-${item.sessionId}-${item.actionId ?? i}`}
          className="flex items-center gap-3 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2"
        >
          <span className="shrink-0 text-sm" style={{ color: KIND_COLOR[item.kind] }} aria-label={item.kind}>
            {KIND_GLYPH[item.kind]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-[#d7dbe3]">{item.title}</div>
            <div className="truncate text-[11px] text-[#6b7280]">
              {item.detail} · waited {formatWaited(item.waitedMs)}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            {item.kind === 'plan' && (
              <>
                <button onClick={() => void select(item.sessionId)} className="rounded border border-ink-500 px-2 py-1 text-[11px] text-[#b9c0cc] hover:bg-ink-700">
                  Review
                </button>
                <button onClick={() => void approvePlan(item.sessionId, true)} className="rounded bg-[#5bd4a4] px-2 py-1 text-[11px] font-semibold text-ink-900">
                  Approve
                </button>
                <button onClick={() => onDelete(item.sessionId, item.title)} title="Delete session" aria-label="Delete session" className="rounded px-2 py-1 text-[11px] text-[#8a93a6] hover:bg-[#f06d6d]/10 hover:text-[#f06d6d]">
                  ✕
                </button>
              </>
            )}
            {item.kind === 'action' && item.actionId && (
              <>
                <button
                  disabled={deciding.has(item.actionId)}
                  onClick={() => onDecide(item.actionId!, false)}
                  className="rounded px-2 py-1 text-[11px] text-[#f06d6d] hover:bg-[#f06d6d]/10 disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  disabled={deciding.has(item.actionId)}
                  onClick={() => onDecide(item.actionId!, true)}
                  className="rounded bg-[#5bd4a4] px-2 py-1 text-[11px] font-semibold text-ink-900 disabled:opacity-50"
                >
                  {deciding.has(item.actionId) ? '…' : 'Approve'}
                </button>
              </>
            )}
            {item.kind === 'error' && (
              <>
                <button onClick={() => void resume(item.sessionId)} title="Retry — resume this session" className="inline-flex items-center gap-1 rounded border border-[#5bd4a4]/40 px-2 py-1 text-[11px] font-medium text-[#5bd4a4] transition-colors hover:bg-[#5bd4a4]/10">
                  <Icon name="resume" /> Retry
                </button>
                <button onClick={() => void select(item.sessionId)} className="rounded border border-ink-500 px-2 py-1 text-[11px] text-[#b9c0cc] hover:bg-ink-700">
                  Open
                </button>
                <button onClick={() => onDelete(item.sessionId, item.title)} title="Delete session" aria-label="Delete session" className="rounded px-2 py-1 text-[11px] text-[#8a93a6] hover:bg-[#f06d6d]/10 hover:text-[#f06d6d]">
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function formatWaited(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.round(m / 60)}h`
}
