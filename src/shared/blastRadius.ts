import type { DiffFile, DiffStatus } from './types'

/**
 * Blast-radius detection — the "what's the worst case, and how much does this
 * touch?" instinct, made visible and EXPLAINABLE. Pure + deterministic: given
 * the working-tree diff for a session, it scores how far-reaching the change is
 * AND surfaces why (the contributing factors), which sensitive files it touches,
 * whether code changed without tests, and the most-churned files — so a reviewer
 * sees not just a number but where the risk concentrates.
 *
 * Shared so the renderer and any main-process consumer compute the same result.
 */

export type BlastLevel = 'minimal' | 'low' | 'moderate' | 'high' | 'critical'

export interface CriticalHit {
  path: string
  /** Short label for *why* this file raises the stakes ('migration', 'lockfile'…). */
  reason: string
}

/** One contributing term of the score, so the UI can explain the number. */
export interface BlastFactor {
  label: string
  points: number
  detail: string
}

export interface FileChurn {
  path: string
  churn: number // additions + deletions
  status: DiffStatus
}

export interface BlastRadius {
  level: BlastLevel
  score: number // 0–100
  filesChanged: number
  additions: number
  deletions: number
  /** Number of files deleted outright (removing code is higher-risk). */
  deletedFiles: number
  /** Distinct subsystems (top-2 path segments) the change spans. */
  subsystems: string[]
  /** Sensitive files touched — migrations, lockfiles, CI config, auth, public API… */
  criticalHits: CriticalHit[]
  /** True when source code changed but no test files did — a coverage-risk signal. */
  testGap: boolean
  /** Explainable breakdown of the score. */
  factors: BlastFactor[]
  /** The most-churned files, biggest first (top 5). */
  topFiles: FileChurn[]
  /** One-line, human-readable summary for tooltips / headers. */
  summary: string
}

// Files whose change radically widens the blast radius. Order matters — the
// first match wins, so list the most specific patterns first; the broad
// public-surface pattern is last so concrete infra/auth patterns win.
const CRITICAL_PATTERNS: { test: RegExp; reason: string }[] = [
  { test: /(^|\/)migrations?(\/|\.|$)|\.sql$|schema\.(prisma|sql|graphql)$/i, reason: 'migration / schema' },
  { test: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock)$/i, reason: 'lockfile' },
  { test: /(^|\/)(package\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|Gemfile|pom\.xml|build\.gradle|composer\.json)$/i, reason: 'dependency manifest' },
  { test: /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)Jenkinsfile$|(^|\/)\.circleci\/|azure-pipelines/i, reason: 'CI/CD pipeline' },
  { test: /(^|\/)(Dockerfile|docker-compose\.ya?ml)$|\.tf$|(^|\/)(helm|k8s|kubernetes)\//i, reason: 'infrastructure' },
  { test: /auth|login|password|secret|credential|\btoken\b|jwt|oauth|rbac|permission|crypto/i, reason: 'auth / security' },
  { test: /(^|\/)\.env(\.|$)|(^|\/)(config|settings)(\.|\/)/i, reason: 'config / env' },
  { test: /(^|\/)(tsconfig|vite\.config|webpack\.config|rollup\.config|next\.config|babel\.config|\.eslintrc)/i, reason: 'build config' },
  { test: /(^|\/)shared\/|\.d\.ts$|(^|\/)index\.(ts|tsx|js|jsx)$|(^|\/)(api|types|contracts?|schema)(\/|\.)/i, reason: 'public surface / shared API' }
]

function criticalReason(path: string): string | null {
  for (const { test, reason } of CRITICAL_PATTERNS) if (test.test(path)) return reason
  return null
}

const TEST_RE = /(\.test\.|\.spec\.|_test\.|(^|\/)test_|(^|\/)tests?\/|(^|\/)__tests__\/|(^|\/)spec\/)/i
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|rs|java|kt|c|h|cpp|cc|cs|php|swift|scala)$/i

const isTestFile = (p: string) => TEST_RE.test(p)
const isSourceFile = (p: string) => SOURCE_RE.test(p) && !isTestFile(p)

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
  deletedFiles: 0,
  subsystems: [],
  criticalHits: [],
  testGap: false,
  factors: [],
  topFiles: [],
  summary: 'No changes'
}

export function computeBlastRadius(files: DiffFile[]): BlastRadius {
  if (files.length === 0) return EMPTY

  let additions = 0
  let deletions = 0
  let deletedFiles = 0
  let sourceChanged = 0
  let testChanged = 0
  const subsystems = new Set<string>()
  const criticalHits: CriticalHit[] = []
  const churn: FileChurn[] = []

  for (const f of files) {
    additions += f.additions
    deletions += f.deletions
    if (f.status === 'deleted') deletedFiles += 1
    if (isTestFile(f.relPath)) testChanged += 1
    else if (isSourceFile(f.relPath)) sourceChanged += 1
    subsystems.add(subsystemOf(f.relPath))
    const reason = criticalReason(f.relPath)
    if (reason) criticalHits.push({ path: f.relPath, reason })
    churn.push({ path: f.relPath, churn: f.additions + f.deletions, status: f.status })
  }

  // Deterministic, explainable score — each term capped so no single factor
  // dominates, except critical-path hits, which are meant to.
  const breadth = Math.min(30, files.length * 5)
  const volume = Math.min(25, Math.round((additions + deletions) / 20))
  const crossCut = Math.min(20, Math.max(0, subsystems.size - 1) * 7)
  const sensitive = Math.min(35, criticalHits.length * 15)
  const netDelete = deletions > additions && deletions > 50 ? 8 : 0
  const score = Math.min(100, breadth + volume + crossCut + sensitive + netDelete)

  const factors: BlastFactor[] = [
    { label: 'Breadth', points: breadth, detail: `${files.length} file${files.length === 1 ? '' : 's'} changed` },
    { label: 'Volume', points: volume, detail: `${additions + deletions} lines` },
    { label: 'Cross-cutting', points: crossCut, detail: `${subsystems.size} subsystem${subsystems.size === 1 ? '' : 's'}` },
    { label: 'Sensitive paths', points: sensitive, detail: `${criticalHits.length} critical-path hit${criticalHits.length === 1 ? '' : 's'}` },
    { label: 'Net deletion', points: netDelete, detail: netDelete ? `${deletions} deletions` : 'balanced' }
  ].filter((f) => f.points > 0)

  const level: BlastLevel =
    score >= 80 ? 'critical' : score >= 55 ? 'high' : score >= 30 ? 'moderate' : score >= 5 ? 'low' : 'minimal'

  return {
    level,
    score,
    filesChanged: files.length,
    additions,
    deletions,
    deletedFiles,
    subsystems: [...subsystems].sort(),
    criticalHits,
    // Changed real source but touched no tests — flagged (not scored) so a
    // reviewer notices, without perturbing the deterministic score.
    testGap: sourceChanged > 0 && testChanged === 0,
    factors,
    topFiles: churn.sort((a, b) => b.churn - a.churn).slice(0, 5),
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

/**
 * Should landing this change ask for confirmation? A soft pre-commit gate: a
 * high/critical-blast-radius change, or one that touches source without any
 * tests, is worth a second look before it's committed. Returns the reasons so
 * the UI can explain the warning. (Warns — never blocks.)
 */
export function landRisk(blast: BlastRadius): { risky: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (blast.level === 'critical') reasons.push('critical blast radius')
  else if (blast.level === 'high') reasons.push('high blast radius')
  if (blast.testGap) reasons.push('source changed but no tests')
  const critical = [...new Set(blast.criticalHits.map((h) => h.reason))]
  if (critical.length) reasons.push(`touches ${critical.slice(0, 2).join(', ')}`)
  const risky = blast.level === 'high' || blast.level === 'critical' || blast.testGap
  return { risky, reasons }
}

export const BLAST_META: Record<BlastLevel, { label: string; color: string }> = {
  minimal: { label: 'Minimal', color: '#7e8796' },
  low: { label: 'Low', color: '#5bd4a4' },
  moderate: { label: 'Moderate', color: '#6ea8fe' },
  high: { label: 'High', color: '#f5a623' },
  critical: { label: 'Critical', color: '#f06d6d' }
}
