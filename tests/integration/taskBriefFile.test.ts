import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeWorktreeBrief } from '../../src/main/util/taskBriefFile'

// Exercises the real mechanism: write CLAUDE.local.md into a worktree and make
// it git-invisible via the worktree's own info/exclude.
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

describe('writeWorktreeBrief — git-invisible per-task CLAUDE.local.md', () => {
  let repo: string
  let worktree: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'mt-repo-'))
    git(repo, 'init', '-q')
    git(repo, 'config', 'user.email', 't@t.t')
    git(repo, 'config', 'user.name', 't')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init')
    worktree = join(repo, '..', `wt-${Date.now()}`)
    git(repo, 'worktree', 'add', '-q', worktree, 'HEAD')
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(worktree, { recursive: true, force: true })
  })

  it('writes CLAUDE.local.md with the brief and hides it from git status', async () => {
    await writeWorktreeBrief(worktree, '# Task context\n\n**Task:** do the thing')

    const file = join(worktree, 'CLAUDE.local.md')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('do the thing')

    // The whole point: it must NOT appear as an untracked change (else it would
    // pollute the diff view and get committed by Land).
    const status = git(worktree, 'status', '--porcelain')
    expect(status).not.toContain('CLAUDE.local.md')
  })

  it('is idempotent — a second call does not duplicate the exclude entry', async () => {
    await writeWorktreeBrief(worktree, 'a')
    await writeWorktreeBrief(worktree, 'b')
    const status = git(worktree, 'status', '--porcelain')
    expect(status).not.toContain('CLAUDE.local.md')
    expect(readFileSync(join(worktree, 'CLAUDE.local.md'), 'utf8')).toBe('b') // latest brief wins
  })

  it('never throws on a non-repo directory (best-effort)', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'mt-plain-'))
    try {
      await expect(writeWorktreeBrief(plain, 'x')).resolves.toBeUndefined()
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})
