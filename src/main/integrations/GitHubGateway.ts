import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { simpleGit } from 'simple-git'
import type { ConnectorExecuteInput, ConnectorExecuteResult, ConnectorGateway } from './ConnectorGateway'

const run = promisify(execFile)

interface GitHubPayload {
  cwd?: string
  branch?: string
  title?: string
  body?: string
  base?: string
  head?: string
  pr?: string | number
}

/**
 * Executes the github.* action types in the session's repo:
 *   - github.push_branch : push the session branch to origin (simple-git)
 *   - github.pr_create   : open a PR (gh CLI)
 *   - github.pr_comment  : comment on a PR (gh CLI)
 *
 * PR actions shell out to `gh` with ARGUMENT ARRAYS via execFile (never a shell
 * string), so an agent-supplied title/body/base can't inject commands. Only ever
 * invoked for an action that already cleared the policy (AUTO + non-dry-run, or
 * human approval), and scoped to the repo in `cwd`.
 */
export class SimpleGitHubGateway implements ConnectorGateway {
  async execute(input: ConnectorExecuteInput): Promise<ConnectorExecuteResult> {
    const p = (input.payload && typeof input.payload === 'object' ? input.payload : {}) as GitHubPayload
    switch (input.actionType) {
      case 'github.push_branch':
        return this.pushBranch(p)
      case 'github.pr_create':
        return this.createPr(p)
      case 'github.pr_comment':
        return this.commentPr(p)
      default:
        return { ok: false, error: `unsupported github action: ${input.actionType}` }
    }
  }

  private async pushBranch(p: GitHubPayload): Promise<ConnectorExecuteResult> {
    if (!p.cwd || !p.branch) return { ok: false, error: 'missing cwd/branch' }
    try {
      const git = simpleGit(p.cwd)
      if (!(await git.checkIsRepo().catch(() => false))) {
        return { ok: true, result: { skipped: 'not a git repository' } }
      }
      const remotes = await git.getRemotes()
      if (!remotes.some((r) => r.name === 'origin')) {
        return { ok: true, result: { skipped: 'no origin remote — local branch only' } }
      }
      await git.push(['-u', 'origin', p.branch])
      return { ok: true, result: { pushed: p.branch } }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  }

  private async createPr(p: GitHubPayload): Promise<ConnectorExecuteResult> {
    if (!p.cwd) return { ok: false, error: 'missing cwd' }
    if (!p.title) return { ok: false, error: 'missing PR title' }
    const args = ['pr', 'create', '--title', p.title, '--body', p.body ?? '']
    if (p.base) args.push('--base', p.base)
    if (p.head) args.push('--head', p.head)
    return this.gh(args, p.cwd)
  }

  private async commentPr(p: GitHubPayload): Promise<ConnectorExecuteResult> {
    if (!p.cwd) return { ok: false, error: 'missing cwd' }
    if (!p.body) return { ok: false, error: 'missing comment body' }
    // The PR ref is a positional arg; reject a leading '-' so it can't be
    // misparsed as a gh flag. (title/body/base are flag *values* — already safe.)
    const pr = p.pr != null ? String(p.pr) : undefined
    if (pr && pr.startsWith('-')) return { ok: false, error: 'invalid PR reference' }
    // No pr ref → gh targets the PR for the current branch.
    const args = ['pr', 'comment', ...(pr ? [pr] : []), '--body', p.body]
    return this.gh(args, p.cwd)
  }

  private async gh(args: string[], cwd: string): Promise<ConnectorExecuteResult> {
    try {
      const { stdout } = await run('gh', args, { cwd, timeout: 60_000 })
      return { ok: true, result: { output: stdout.trim() } }
    } catch (err) {
      return { ok: false, error: errMsg(err) }
    }
  }
}

function errMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'stderr' in err) {
    const stderr = String((err as { stderr: unknown }).stderr ?? '').trim()
    if (stderr) return stderr
  }
  return err instanceof Error ? err.message : String(err)
}
