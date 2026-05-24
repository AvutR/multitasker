import { useStore } from '../store/store'

/** Compact trust summary for a session: branch + a roll-up of its policy-gated
 *  integration actions (the audit trail, condensed). The seed of the trust card. */
export function TrustBar({ sessionId, branch }: { sessionId: string; branch?: string | null }) {
  const actions = useStore((s) => s.actions)
  const mine = actions.filter((a) => a.sessionId === sessionId)
  const fired = mine.filter((a) => a.status === 'fired').length
  const pending = mine.filter((a) => a.status === 'pending').length
  const failed = mine.filter((a) => a.status === 'failed').length

  return (
    <div className="flex items-center gap-3 text-[11px] text-[#6b7280]">
      {branch && <span className="font-mono">⎇ {branch}</span>}
      <span>
        actions:{' '}
        <span className="text-[#5bd4a4]">{fired} fired</span>
        {pending > 0 && <span className="text-[#f5c451]">, {pending} pending</span>}
        {failed > 0 && <span className="text-[#f06d6d]">, {failed} failed</span>}
        {mine.length === 0 && <span>none yet</span>}
      </span>
    </div>
  )
}
