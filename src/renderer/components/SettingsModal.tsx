import { useState } from 'react'
import { useStore } from '../store/store'

/**
 * Settings — full control, sensible defaults. The defaults already do the right
 * thing (Opus conductor, auto-tiered cheap sub-agents); this is where a user
 * overrides: which models, how sub-agent models are assigned, the budget, the
 * concurrency cap, and an optional non-Anthropic gateway.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const models = useStore((s) => s.models)
  const patch = useStore((s) => s.patchSettings)

  const strategy = settings.tieringStrategy ?? 'auto'
  const [gwOpen, setGwOpen] = useState(Boolean(settings.gatewayBaseUrl))
  const [budget, setBudget] = useState(settings.budgetUsd ? String(settings.budgetUsd) : '')

  const set = (p: Parameters<typeof patch>[0]) => void patch(p)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-xl border border-ink-500 bg-ink-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
          <div className="text-sm font-semibold text-white">Settings</div>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-[#8a93a6] hover:bg-ink-700">Done</button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {/* Models */}
          <Section title="Models">
            <Row label="Default model" hint="Conductors and new sessions start on this.">
              <select
                value={settings.defaultModel}
                onChange={(e) => set({ defaultModel: e.target.value })}
                className="rounded border border-ink-500 bg-ink-700 px-2 py-1 text-xs"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </Row>

            <Row label="Sub-agent models" hint="How a conductor's delegated sub-agents get their model.">
              <div className="flex gap-1">
                {(['auto', 'fixed'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => set({ tieringStrategy: s })}
                    className={`rounded px-2 py-1 text-[11px] font-medium ${
                      strategy === s ? 'bg-accent/20 text-accent' : 'bg-ink-700 text-[#8a93a6] hover:bg-ink-600'
                    }`}
                  >
                    {s === 'auto' ? 'Auto (recommended)' : 'Fixed'}
                  </button>
                ))}
              </div>
            </Row>
            <p className="px-0.5 text-[11px] leading-relaxed text-[#6b7280]">
              {strategy === 'auto'
                ? 'Each sub-task runs on the cheapest capable model — research on Haiku, code & tests on Sonnet, orchestration on Opus. The conductor can override per sub-task.'
                : 'Every sub-agent uses the fixed model below, regardless of the sub-task.'}
            </p>

            <Row label={strategy === 'auto' ? 'Sub-agent fallback' : 'Sub-agent model'} hint={strategy === 'auto' ? 'Used when a sub-task can’t be classified.' : 'Used for all sub-agents.'}>
              <select
                value={settings.delegateModel ?? 'sonnet'}
                onChange={(e) => set({ delegateModel: e.target.value })}
                className="rounded border border-ink-500 bg-ink-700 px-2 py-1 text-xs"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </Row>
          </Section>

          {/* Limits */}
          <Section title="Limits">
            <Row label="Concurrency cap" hint="Max live agents at once (each holds a subprocess).">
              <div className="flex items-center gap-1.5 text-xs">
                <button onClick={() => set({ concurrencyCap: Math.max(1, settings.concurrencyCap - 1) })} className="rounded bg-ink-600 px-1.5 hover:bg-ink-500">−</button>
                <span className="w-6 text-center tabular-nums text-[#d7dbe3]">{settings.concurrencyCap}</span>
                <button onClick={() => set({ concurrencyCap: settings.concurrencyCap + 1 })} className="rounded bg-ink-600 px-1.5 hover:bg-ink-500">+</button>
              </div>
            </Row>
            <Row label="Budget (USD)" hint="Soft spend cap; the header warns as you approach it. Blank = none.">
              <div className="flex items-center gap-1 text-xs">
                <span className="text-[#6b7280]">$</span>
                <input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ''))}
                  onBlur={() => set({ budgetUsd: Number(budget) > 0 ? Number(budget) : 0 })}
                  placeholder="none"
                  className="w-20 rounded border border-ink-500 bg-ink-700 px-1.5 py-0.5 text-right tabular-nums"
                />
              </div>
            </Row>
          </Section>

          {/* Gateway */}
          <Section title="Gateway (advanced)">
            <button onClick={() => setGwOpen((v) => !v)} className="text-[11px] text-accent hover:underline">
              {gwOpen ? 'Hide' : 'Configure'} an Anthropic-compatible gateway (LiteLLM / OpenRouter / …) for non-Anthropic models
            </button>
            {gwOpen && (
              <div className="mt-2 space-y-2">
                <GwInput label="Base URL" value={settings.gatewayBaseUrl ?? ''} onSave={(v) => set({ gatewayBaseUrl: v })} placeholder="https://gateway.example/v1" />
                <GwInput label="API key" value={settings.gatewayApiKey ?? ''} onSave={(v) => set({ gatewayApiKey: v })} placeholder="stored locally on this machine" password />
                <GwInput label="Model" value={settings.gatewayModel ?? ''} onSave={(v) => set({ gatewayModel: v })} placeholder="gpt-4o / gemini-2.0-… " />
                <GwInput label="Label" value={settings.gatewayLabel ?? ''} onSave={(v) => set({ gatewayLabel: v })} placeholder="shown in the model picker" />
                <p className="text-[10px] text-[#5b6472]">Stored locally in this app’s settings — never sent anywhere except your gateway.</p>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6b7280]">{title}</div>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-[#d7dbe3]">{label}</div>
        {hint && <div className="text-[10px] text-[#6b7280]">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function GwInput({ label, value, onSave, placeholder, password }: { label: string; value: string; onSave: (v: string) => void; placeholder?: string; password?: boolean }) {
  const [v, setV] = useState(value)
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="w-16 shrink-0 text-[#8a93a6]">{label}</span>
      <input
        type={password ? 'password' : 'text'}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(v.trim())}
        placeholder={placeholder}
        className="flex-1 rounded border border-ink-500 bg-ink-700 px-2 py-1 font-mono text-[11px]"
      />
    </label>
  )
}
