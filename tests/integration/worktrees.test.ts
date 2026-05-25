import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAll, computeDiff, isGitRepo } from '../../src/main/git/Worktrees'

// Regression: a session pointed at a non-repo directory used to surface
// "failed to run git: fatal: not a git repository" from computeDiff/commitAll.
describe('git ops degrade gracefully on a non-repo directory', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mt-norepo-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('isGitRepo is false for a plain directory and never throws', async () => {
    await expect(isGitRepo(dir)).resolves.toBe(false)
    await expect(isGitRepo(join(dir, 'does-not-exist'))).resolves.toBe(false)
  })

  it('computeDiff returns [] instead of throwing', async () => {
    await expect(computeDiff(dir)).resolves.toEqual([])
  })

  it('commitAll reports not-a-repo instead of throwing', async () => {
    const res = await commitAll(dir, 'msg')
    expect(res.committed).toBe(false)
    expect(res.reason).toMatch(/not a git repository/i)
  })
})
