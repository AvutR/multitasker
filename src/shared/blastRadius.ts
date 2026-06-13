import type { DiffFile } from './types'

/**
 * Blast-radius detection — the "what's the worst case, and how much does this
 * touch?" instinct, made visible. Pure + deterministic: given the working-tree
 * diff for a session, score how far-reaching the change is so the UI can show
 * it at a glance (a small change to one file reads green; a change that rewrites
 * a migration + the lockfile + three subsystems reads red).
 *
 * Shared so both the renderer and any future main-process consumer compute the
 * exact same number.
 */

export type BlastLevel = 'minimal' | 'low' | 'moderate' | 'high' | 'critical'

export interface CriticalHit {
  path: string
  /** Short label for *why* this file raises the stakes ('migration', 'lockfile'…). */
  reason: string
}

export interface BlastRadius {
  level: BlastLevel
  score: number // 0–100
  filesChanged: number
  additions: number
  deletions: number
  /** Distinct subsystems (top-2 path segments) the change spans. */
  subsystems: string[]
  /** Sensitive files touched — migrations, lockfiles, CI config, auth, … */
  criticalHits: CriticalHit[]
  /** One-line, human-readable summary for tooltips / headers. */
  summary: string
}

// Files whose change radically widens the blast radius. Order matters — the
// first match wins, so list the most specific patterns first.
const CRITICAL_PATTERNS: { test: RegExp; reason: string }[] = [
  { test: /(^|\/)migrations?(\/|\.|$)|\.sql$|schema\.(prisma|sql|graphql)$/i, reason: 'migration / schema' },
  { test: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock)$/i, reason: 'lockfile' },
  { test: /(^|\/)(package\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|Gemfile|pom\.xml|build\.gradle|composer\.json)$/i, reason: 'dependency manifest' },
  { test: /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)Jenkinsfile$|(^|\/)\.circleci\/|azure-pipelines/i, reason: 'CI/CD pipeline' },
  { test: /(^|\/)(Dockerfile|docker-compose\.ya?ml)$|\.tf$|(^|\/)(helm|k8s|kubernetes)\//i, reason: 'infrastructure' },
  { test: /auth|login|password|secret|credential|\btoken\b|jwt|oauth|rbac|permission|crypto/i, reason: 'auth / security' },
  { test: /(^|\/)\.env(\.|$)|(^|\/)(config|settings)(\.|\/)/i, reason: 'config / env' },
  { test: /(^|\/)(tsconfig|vite\.config|webpack\.config|rollup\.config|next\.config|babel\.config|\.eslintrc)/i, reason: 'build config' }
]

function criticalReason(path: string): string | null {
  for (const { test, reason } of CRITICAL_PATTERNS) if (test.test(path)) return reason
  return null
}

/** The subsystem a file belongs to — its first two path segments (or one). */
function subsystemOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return '(root)'
  return parts.slice(0, 2).join('/')
}

const EMPTY: BlastRadius = {
  level: 'minimal',
  score: 0,
  filesChanged: 0,
  additions: 0,
  deletions: 0,
  subsystems: [],
  criticalHits: [],
  summary: 'No changes'
}

export function computeBlastRadius(files: DiffFile[]): BlastRadius {
  if (files.length === 0) return EMPTY

  let additions = 0
  let deletions = 0
  const subsystems = new Set<string>()
  const criticalHits: CriticalHit[] = []

  for (const f of files) {
    additions += f.additions
    deletions += f.deletions
    subsystems.add(subsystemOf(f.relPath))
    const reason = criticalReason(f.relPath)
    if (reason) criticalHits.push({ path: f.relPath, reason })
  }

  // Deterministic, explainable score. Each term is capped so no single factor
  // dominates — except critical-path hits, which are meant to.
  const breadth = Math.min(30, files.length * 5)
  const volume = Math.min(25, Math.round((additions + deletions) / 20))
  const crossCut = Math.min(20, Math.max(0, subsystems.size - 1) * 7)
  const sensitive = Math.min(35, criticalHits.length * 15)
  const netDelete = deletions > additions && deletions > 50 ? 8 : 0
  const score = Math.min(100, breadth + volume + crossCut + sensitive + netDelete)

  const level: BlastLevel =
    score >= 80 ? 'critical' : score >= 55 ? 'high' : score >= 30 ? 'moderate' : score >= 5 ? 'low' : 'minimal'

  return {
    level,
    score,
    filesChanged: files.length,
    additions,
    deletions,
    subsystems: [...subsystems].sort(),
    criticalHits,
    summary: buildSummary(files.length, subsystems.size, criticalHits)
  }
}

function buildSummary(files: number, subsystems: number, hits: CriticalHit[]): string {
  const parts = [`${files} file${files === 1 ? '' : 's'}`]
  if (subsystems > 1) parts.push(`${subsystems} subsystems`)
  if (hits.length > 0) {
    const reasons = [...new Set(hits.map((h) => h.reason))]
    parts.push(`touches ${reasons.slice(0, 2).join(', ')}${reasons.length > 2 ? '…' : ''}`)
  }
  return parts.join(' · ')
}

export const BLAST_META: Record<BlastLevel, { label: string; color: string }> = {
  minimal: { label: 'Minimal', color: '#7e8796' },
  low: { label: 'Low', color: '#5bd4a4' },
  moderate: { label: 'Moderate', color: '#6ea8fe' },
  high: { label: 'High', color: '#f5a623' },
  critical: { label: 'Critical', color: '#f06d6d' }
}
