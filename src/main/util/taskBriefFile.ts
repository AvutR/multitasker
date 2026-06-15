import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { simpleGit } from 'simple-git'

/**
 * Write the per-task brief into a worktree as `CLAUDE.local.md` — which Claude
 * Code auto-loads as localized memory at launch — and hide it from git via the
 * worktree's own `info/exclude`, so it never shows up in the diff view or gets
 * committed by Land. `git rev-parse --git-path info/exclude` resolves the right
 * exclude file for linked worktrees too. Best-effort; never blocks a spawn.
 */
export async function writeWorktreeBrief(worktreePath: string, brief: string): Promise<void> {
  try {
    await writeFile(join(worktreePath, 'CLAUDE.local.md'), brief)
    const git = simpleGit(worktreePath)
    const rel = (await git.raw(['rev-parse', '--git-path', 'info/exclude'])).trim()
    if (!rel) return
    const excludePath = isAbsolute(rel) ? rel : join(worktreePath, rel)
    let current = ''
    try {
      current = await readFile(excludePath, 'utf8')
    } catch {
      // no exclude file yet — appendFile creates it
    }
    if (!current.includes('CLAUDE.local.md')) {
      await appendFile(excludePath, '\n# Multitasker per-task brief (auto)\nCLAUDE.local.md\n')
    }
  } catch {
    // best-effort: a missing brief just means the agent isn't pre-primed
  }
}
