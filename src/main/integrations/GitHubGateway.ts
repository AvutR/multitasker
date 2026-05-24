import { simpleGit } from 'simple-git'
import type { ConnectorExecuteInput, ConnectorExecuteResult, ConnectorGateway } from './ConnectorGateway'

/**
 * Executes git-backed GitHub actions (currently: push a branch to origin).
 * Implements the same ConnectorGateway shape so ActionService can route
 * github.* actions here instead of to the MCP connector gateway. No-ops
 * gracefully when the repo has no remote (local-branch-only).
 */
export class SimpleGitHubGateway implements ConnectorGateway {
  async execute(input: ConnectorExecuteInput): Promise<ConnectorExecuteResult> {
    if (input.actionType !== 'github.push_branch') {
      return { ok: false, error: `unsupported github action: ${input.actionType}` }
    }
    const payload = input.payload as { cwd?: string; branch?: string }
    if (!payload?.cwd || !payload?.branch) return { ok: false, error: 'missing cwd/branch' }

    try {
      const git = simpleGit(payload.cwd)
      const remotes = await git.getRemotes()
      if (!remotes.some((r) => r.name === 'origin')) {
        return { ok: true, result: { skipped: 'no origin remote — local branch only' } }
      }
      await git.push(['-u', 'origin', payload.branch])
      return { ok: true, result: { pushed: payload.branch } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
