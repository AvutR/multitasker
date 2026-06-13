import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CIRun, CIStatus } from '@shared/types'
import { isGitRepo } from '../../git/Worktrees'
import type { CIProvider } from './types'

const run = promisify(execFile)

interface GhRun {
  databaseId?: number
  name?: string
  status?: string // queued | in_progress | completed
  conclusion?: string | null // success | failure | cancelled | …
  headBranch?: string
  url?: string
  event?: string
  createdAt?: string
}

/**
 * Default CI provider — reads GitHub Actions runs via the `gh` CLI (reuses the
 * user's gh auth; no token plumbing). Read-only and scoped to the repo at `cwd`.
 */
export class GithubActionsProvider implements CIProvider {
  readonly id = 'github-actions'
  readonly label = 'GitHub Actions'

  async listRecentRuns(cwd: string): Promise<CIRun[]> {
    if (!(await isGitRepo(cwd))) return []
    try {
      const { stdout } = await run(
        'gh',
        ['run', 'list', '--limit', '15', '--json', 'databaseId,name,status,conclusion,headBranch,url,event,createdAt'],
        { cwd, timeout: 20_000 }
      )
      const raw = JSON.parse(stdout) as unknown
      if (!Array.isArray(raw)) return []
      return raw.map((r) => normalizeRun(r as GhRun)).filter((r): r is CIRun => r !== null)
    } catch {
      return [] // gh missing / not authed / no remote — degrade quietly
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await run('gh', ['--version'], { timeout: 5_000 })
      return true
    } catch {
      return false
    }
  }
}

/** Map a raw `gh run list` row onto the normalized CIRun. Exported for tests. */
export function normalizeRun(r: GhRun): CIRun | null {
  if (r.databaseId == null) return null
  return {
    id: String(r.databaseId),
    name: r.name || 'workflow',
    status: normalizeStatus(r.status, r.conclusion),
    branch: r.headBranch || '',
    url: r.url || '',
    event: r.event || '',
    createdAt: r.createdAt ? Date.parse(r.createdAt) || 0 : 0,
    providerId: 'github-actions'
  }
}

function normalizeStatus(status: string | undefined, conclusion: string | null | undefined): CIStatus {
  if (status === 'queued' || status === 'waiting' || status === 'pending') return 'queued'
  if (status === 'in_progress') return 'running'
  // status === 'completed' → look at conclusion
  switch (conclusion) {
    case 'success':
      return 'success'
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'failure'
    case 'cancelled':
    case 'skipped':
    case 'neutral':
    case 'action_required':
      return 'cancelled'
    default:
      return 'unknown'
  }
}
