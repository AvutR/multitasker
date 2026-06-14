import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => h.home }
})

import { listMemory, recall, remember } from '../../src/main/integrations/agentMemory'

describe('agent memory — remember / recall (shared by project root)', () => {
  beforeEach(() => {
    h.home = mkdtempSync(join(tmpdir(), 'mt-mem-'))
  })
  afterEach(() => rmSync(h.home, { recursive: true, force: true }))

  it('remembers and recalls notes, most-recent-first', () => {
    remember('/repo/a', 'auth lives in src/main/auth', 'arch', 's1')
    remember('/repo/a', 'flaky test: login.spec retries', 'gotcha', 's2')
    const notes = recall('/repo/a')
    expect(notes).toHaveLength(2)
    expect(notes[0].text).toContain('flaky test') // newest first
    expect(notes[0].tag).toBe('gotcha')
  })

  it('isolates memory by project root', () => {
    remember('/repo/a', 'note for A')
    remember('/repo/b', 'note for B')
    expect(recall('/repo/a').map((n) => n.text)).toEqual(['note for A'])
    expect(recall('/repo/b').map((n) => n.text)).toEqual(['note for B'])
  })

  it('filters recall by a case-insensitive query (text or tag)', () => {
    remember('/repo/a', 'the migration touches the orders table', 'db')
    remember('/repo/a', 'rate limiter is in middleware')
    expect(recall('/repo/a', 'MIGRATION').map((n) => n.text)).toEqual(['the migration touches the orders table'])
    expect(recall('/repo/a', 'db').map((n) => n.text)).toEqual(['the migration touches the orders table']) // by tag
    expect(recall('/repo/a', 'nothing')).toEqual([])
  })

  it('a sub-agent sharing the parent cwd recalls the parent’s notes', () => {
    // Conductor and sub-agent both key into the same worktree cwd.
    const sharedCwd = '/work/multitasker__conduct-abc'
    remember(sharedCwd, 'sub-task A: schema validated', undefined, 'child-1')
    expect(recall(sharedCwd).map((n) => n.text)).toContain('sub-task A: schema validated')
  })

  it('listMemory returns all notes for the project', () => {
    remember('/repo/a', 'one')
    remember('/repo/a', 'two')
    expect(listMemory('/repo/a').map((n) => n.text)).toEqual(['two', 'one'])
  })
})
