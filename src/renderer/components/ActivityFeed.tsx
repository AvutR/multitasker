import { ACTION_STATUS_META, Badge, relativeTime } from './bits'
import { useStore } from '../store/store'

export function ActivityFeed() {
  const actions = useStore((s) => s.actions)
  const decide = useStore((s) => s.decideAction)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">
        Activity &amp; audit log
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {actions.length === 0 && (
          <div className="px-2 py-6 text-center text-[11px] text-[#5b6472]">
            No integration actions yet. Agents post here as they update Linear/Notion/Slack.
          </div>
        )}
        {actions.map((a) => {
          const meta = ACTION_STATUS_META[a.status]
          return (
            <div key={a.id} className="mb-1.5 rounded border border-ink-700 p-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs text-[#c7cdd8]">
                  {a.summary}
                  {a.repeatCount > 1 && (
                    <span
                      className="ml-1.5 rounded bg-ink-700 px-1 py-0.5 text-[10px] font-semibold text-[#9aa3b2]"
                      title={`${a.repeatCount} identical attempts collapsed`}
                    >
                      ×{a.repeatCount}
                    </span>
                  )}
                </span>
                <Badge color={meta.color}>{meta.label}</Badge>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-[#5b6472]">
                  {a.connector} · {relativeTime(a.createdAt)}
                </span>
                {a.status === 'pending' && (
                  <span className="flex gap-1">
                    <button
                      onClick={() => void decide(a.id, false)}
                      className="rounded px-1.5 py-0.5 text-[11px] text-[#f06d6d] hover:bg-[#f06d6d]/10"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => void decide(a.id, true)}
                      className="rounded bg-[#5bd4a4] px-1.5 py-0.5 text-[11px] font-semibold text-ink-900"
                    >
                      Approve
                    </button>
                  </span>
                )}
              </div>
              {a.error && <div className="mt-1 text-[10px] text-[#f06d6d]">{a.error}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
