import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { simpleGit } from 'simple-git'

/**
 * Resolve a working directory to its PROJECT ROOT (the main repo), so memory and
 * task context are keyed per-project rather than per-worktree. `git rev-parse
 * --git-common-dir` returns the main repo's .git even from a linked worktree, so
 * a conductor's worktree, its sub-agents' shared cwd, and a plain session on the
 * same repo all resolve to one key — memory becomes truly project-wide. Cached;
 * falls back to cwd for non-repos.
 */
const cache = new Map<string, string>()

export async function projectRoot(cwd: string): Promise<string> {
  const cached = cache.get(cwd)
  if (cached !== undefined) return cached

  let root = cwd
  if (existsSync(cwd)) {
    try {
      const common = (await simpleGit(cwd).raw(['rev-parse', '--git-common-dir'])).trim()
      if (common) {
        const abs = isAbsolute(common) ? common : resolve(cwd, common)
        root = dirname(abs) // parent of .git
      }
    } catch {
      // not a git repo — key by cwd
    }
  }
  cache.set(cwd, root)
  return root
}
