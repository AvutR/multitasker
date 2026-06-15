import { useState } from 'react'
import type { DiffFile } from '@shared/types'
import { BLAST_META, computeBlastRadius } from '@shared/blastRadius'

/**
 * Blast-radius indicator — a 5-segment meter for the glance, plus an expandable
 * breakdown that explains the number: which factors drove it, which sensitive
 * files it touches, whether code changed without tests, and the biggest files.
 */
const LEVEL_ORDER = ['minimal', 'low', 'moderate', 'high', 'critical'] as const

export function BlastRadiusBar({ files }: { files: DiffFile[] }) {
  const [open, setOpen] = useState(false)
  const blast = computeBlastRadius(files)
  const meta = BLAST_META[blast.level]
  const filled = LEVEL_ORDER.indexOf(blast.level) + 1
  const maxChurn = Math.max(1, ...blast.topFiles.map((f) => f.churn))

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 text-left" title={blast.summary}>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">Blast radius</span>
        <div className="flex items-center gap-0.5" aria-label={`Blast radius: ${meta.label}`}>
          {LEVEL_ORDER.map((_, i) => (
            <span key={i} className="h-1.5 w-4 rounded-full transition-colors" style={{ background: i < filled ? meta.color : '#222734' }} />
          ))}
        </div>
        <span className="text-[11px] font-medium" style={{ color: meta.color }}>{meta.label}</span>
        <span className="text-[11px] text-[#6b7280]">
          {blast.filesChanged} file{blast.filesChanged === 1 ? '' : 's'} ·{' '}
          <span className="text-[#5bd4a4]">+{blast.additions}</span> <span className="text-[#f06d6d]">−{blast.deletions}</span>
        </span>
        {blast.testGap && (
          <span className="rounded bg-[#f5a623]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#f5a623]" title="Source changed but no test files did">
            ⚠ no tests
          </span>
        )}
        {blast.criticalHits.length > 0 && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: `${meta.color}1a`, color: meta.color }}
          >
            ⚠ {[...new Set(blast.criticalHits.map((h) => h.reason))].slice(0, 2).join(', ')}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[#3a4150]">{open ? '−' : 'details'}</span>
      </button>

      {open && (
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 text-[11px]">
          {/* Why this score */}
          <div>
            <div className="mb-1 font-semibold uppercase tracking-wide text-[#6b7280]">What drives it</div>
            {blast.factors.length === 0 ? (
              <div className="text-[#5b6472]">—</div>
            ) : (
              blast.factors.map((f) => (
                <div key={f.label} className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="text-[#c7cdd8]">{f.label}</span>
                  <span className="text-[#6b7280]">{f.detail} · <span className="tabular-nums text-[#8a93a6]">+{f.points}</span></span>
                </div>
              ))
            )}
          </div>

          {/* Sensitive files */}
          <div>
            <div className="mb-1 font-semibold uppercase tracking-wide text-[#6b7280]">Sensitive paths</div>
            {blast.criticalHits.length === 0 ? (
              <div className="text-[#5b6472]">none</div>
            ) : (
              blast.criticalHits.slice(0, 6).map((h) => (
                <div key={h.path} className="mb-0.5 truncate" title={`${h.path} — ${h.reason}`}>
                  <span className="font-mono text-[#c7cdd8]">{h.path.split('/').slice(-2).join('/')}</span>{' '}
                  <span className="text-[#6b7280]">· {h.reason}</span>
                </div>
              ))
            )}
          </div>

          {/* Biggest files */}
          <div className="col-span-2">
            <div className="mb-1 font-semibold uppercase tracking-wide text-[#6b7280]">Biggest changes{blast.deletedFiles > 0 ? ` · ${blast.deletedFiles} deleted` : ''}</div>
            {blast.topFiles.map((f) => (
              <div key={f.path} className="mb-1">
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[#c7cdd8]">{f.path}</span>
                  <span className="shrink-0 text-[#6b7280]">{f.status === 'deleted' ? 'deleted · ' : ''}{f.churn} lines</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-ink-700">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(3, (f.churn / maxChurn) * 100)}%`, background: f.status === 'deleted' ? '#f06d6d' : meta.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
