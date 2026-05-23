import type { PolicyMode } from '@shared/types'
import { useStore } from '../store/store'

const MODES: PolicyMode[] = ['auto', 'approve', 'off']
const MODE_LABEL: Record<PolicyMode, string> = { auto: 'Auto', approve: 'Approve', off: 'Off' }

export function PolicyConsole() {
  const defs = useStore((s) => s.policyDefs)
  const policy = useStore((s) => s.policy)
  const setMode = useStore((s) => s.setPolicyMode)
  const setDryRun = useStore((s) => s.setDryRun)

  return (
    <div className="flex max-h-[48%] min-h-0 flex-col border-b border-ink-600">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Integration policy</span>
        <label className="no-drag flex items-center gap-1.5 text-[11px] text-[#8a93a6]">
          <input type="checkbox" checked={policy.dryRun} onChange={(e) => void setDryRun(e.target.checked)} />
          Dry-run
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {defs.map((def) => {
          const mode = policy.modes[def.id] ?? def.defaultPolicy
          return (
            <div
              key={def.id}
              className={`mb-1.5 rounded border border-ink-700 p-2 ${def.enabled ? '' : 'opacity-50'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-[#c7cdd8]" title={def.description}>
                  {def.label}
                </span>
                {!def.enabled && <span className="shrink-0 text-[10px] text-[#5b6472]">disabled</span>}
              </div>
              <div className="mt-1.5 flex gap-1">
                {MODES.map((m) => (
                  <button
                    key={m}
                    disabled={!def.enabled}
                    onClick={() => void setMode(def.id, m)}
                    className={`flex-1 rounded px-1.5 py-0.5 text-[11px] font-medium disabled:cursor-not-allowed ${
                      mode === m ? toneFor(m) : 'bg-ink-700 text-[#6b7280] hover:bg-ink-600'
                    }`}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function toneFor(m: PolicyMode): string {
  if (m === 'auto') return 'bg-[#5bd4a4]/20 text-[#5bd4a4]'
  if (m === 'approve') return 'bg-[#f5c451]/20 text-[#f5c451]'
  return 'bg-[#f06d6d]/20 text-[#f06d6d]'
}
