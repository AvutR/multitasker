import type { NeedsYouItem } from '@shared/types'
import { rankNeedsYou } from '@shared/board'
import { useStore } from '../store/store'

const KIND_GLYPH: Record<NeedsYouItem['kind'], string> = { error: '✕', plan: '◆', action: '↗' }
const KIND_COLOR: Record<NeedsYouItem['kind'], string> = { error: '#f06d6d', plan: '#f5c451', action: '#6ea8fe' }

export function NeedsYouInbox() {
  const sessions = useStore((s) => s.sessions)
  const planRequests = useStore((s) => s.planRequests)
  const actions = useStore((s) => s.actions)
  const select = useStore((s) => s.select)
  const approvePlan = useStore((s) => s.approvePlan)
  const decideAction = useStore((s) => s.decideAction)

  const items = rankNeedsYou(Object.values(sessions), Object.values(planRequests), actions)
  const running = Object.values(sessions).filter((s) => s.status === 'running').length

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-[#5bd4a4]/30 bg-[#5bd4a4]/5 px-4 py-6 text-center">
        <div className="text-sm font-medium text-[#5bd4a4]">✓ All caught up</div>
        <div className="mt-1 text-xs text-[#6b7280]">
          {running > 0 ? `${running} agent${running > 1 ? 's' : ''} running clean — nothing needs you.` : 'Nothing needs your attention.'}
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
              </>
            )}
            {item.kind === 'action' && item.actionId && (
              <>
                <button onClick={() => void decideAction(item.actionId!, false)} className="rounded px-2 py-1 text-[11px] text-[#f06d6d] hover:bg-[#f06d6d]/10">
                  Reject
                </button>
                <button onClick={() => void decideAction(item.actionId!, true)} className="rounded bg-[#5bd4a4] px-2 py-1 text-[11px] font-semibold text-ink-900">
                  Approve
                </button>
              </>
            )}
            {item.kind === 'error' && (
              <button onClick={() => void select(item.sessionId)} className="rounded border border-ink-500 px-2 py-1 text-[11px] text-[#b9c0cc] hover:bg-ink-700">
                Open
              </button>
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
