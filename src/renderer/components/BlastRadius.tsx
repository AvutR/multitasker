import type { DiffFile } from '@shared/types'
import { BLAST_META, computeBlastRadius } from '@shared/blastRadius'

/**
 * Visual blast-radius indicator. A 5-segment meter + level label, so the
 * reach of a change is legible in a glance — green for a one-file tweak,
 * red when it spans subsystems or touches migrations / lockfiles / CI.
 */
const LEVEL_ORDER = ['minimal', 'low', 'moderate', 'high', 'critical'] as const

export function BlastRadiusBar({ files }: { files: DiffFile[] }) {
  const blast = computeBlastRadius(files)
  const meta = BLAST_META[blast.level]
  const filled = LEVEL_ORDER.indexOf(blast.level) + 1

  return (
    <div className="flex items-center gap-2.5" title={blast.summary}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">Blast radius</span>
      <div className="flex items-center gap-0.5" aria-label={`Blast radius: ${meta.label}`}>
        {LEVEL_ORDER.map((_, i) => (
          <span
            key={i}
            className="h-1.5 w-4 rounded-full transition-colors"
            style={{ background: i < filled ? meta.color : '#222734' }}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium" style={{ color: meta.color }}>
        {meta.label}
      </span>
      <span className="text-[11px] text-[#6b7280]">
        {blast.filesChanged} file{blast.filesChanged === 1 ? '' : 's'} ·{' '}
        <span className="text-[#5bd4a4]">+{blast.additions}</span>{' '}
        <span className="text-[#f06d6d]">−{blast.deletions}</span>
      </span>
      {blast.criticalHits.length > 0 && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: `${meta.color}1a`, color: meta.color }}
          title={blast.criticalHits.map((h) => `${h.path} — ${h.reason}`).join('\n')}
        >
          ⚠ {[...new Set(blast.criticalHits.map((h) => h.reason))].slice(0, 2).join(', ')}
        </span>
      )}
    </div>
  )
}
