import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => h.home }
})

import { brainStats, deleteSkill, learn, listSkills, recallSkills, setSkillPinned } from '../../src/main/integrations/brainStore'

const DAY = 86_400_000
const NOW = 1_000 * DAY

describe('central brain — learn / recall (the persistence layer)', () => {
  beforeEach(() => {
    h.home = mkdtempSync(join(tmpdir(), 'mt-brain-'))
  })
  afterEach(() => rmSync(h.home, { recursive: true, force: true }))

  it('learns a skill and recalls it by relevance', () => {
    learn('/repo/a', { title: 'auth lives in src/main/auth', body: 'the login flow is in login.ts', kind: 'map' }, NOW)
    learn('/repo/a', { title: 'css tips', body: 'tailwind utilities live in index.css' }, NOW)
    const hits = recallSkills('/repo/a', 'how does auth login work', 5, NOW)
    expect(hits[0].title).toBe('auth lives in src/main/auth')
    expect(hits.map((s) => s.title)).not.toContain('css tips') // no overlap → excluded
  })

  it('recall surfaces a project’s OWN skills plus GLOBAL ones, but not another project’s', () => {
    learn('/repo/a', { title: 'project A auth', body: 'auth detail for A' }, NOW)
    learn('/repo/b', { title: 'project B auth', body: 'auth detail for B' }, NOW)
    learn('global', { title: 'global auth rule', body: 'auth applies everywhere' }, NOW)
    const titles = recallSkills('/repo/a', 'auth', 5, NOW).map((s) => s.title)
    expect(titles).toContain('project A auth')
    expect(titles).toContain('global auth rule')
    expect(titles).not.toContain('project B auth')
  })

  it('recall bumps reuse so popular skills rank up and earn their keep', () => {
    learn('/repo/a', { title: 'redis token bucket', body: 'rate limiting uses a redis token bucket' }, NOW)
    recallSkills('/repo/a', 'rate limiting token', 5, NOW)
    recallSkills('/repo/a', 'rate limiting token', 5, NOW)
    expect(listSkills('/repo/a')[0].useCount).toBe(2)
    expect(brainStats('/repo/a').reuse).toBe(2)
  })

  it('merges same-title learns instead of bloating (dedupe on write)', () => {
    learn('/repo/a', { title: 'Build gate', body: 'old: run npm test', kind: 'gotcha' }, NOW)
    learn('/repo/a', { title: 'build gate', body: 'new: npm run typecheck && npm test && npm run build', kind: 'gotcha' }, NOW + 1)
    const all = listSkills('/repo/a')
    expect(all).toHaveLength(1)
    expect(all[0].body).toContain('typecheck')
  })

  it('ignores empty learns (no title or no body)', () => {
    learn('/repo/a', { title: '', body: 'orphan body' }, NOW)
    learn('/repo/a', { title: 'orphan title', body: '' }, NOW)
    expect(listSkills('/repo/a')).toHaveLength(0)
  })

  it('pin protects a skill and surfaces it even with no query overlap; delete removes it', () => {
    const pinned = learn('/repo/a', { title: 'always read CLAUDE.md', body: 'project conventions live there' }, NOW)
    setSkillPinned(pinned.id, true)
    expect(recallSkills('/repo/a', 'something totally unrelated xyzzy', 5, NOW).map((s) => s.title)).toContain('always read CLAUDE.md')
    deleteSkill(pinned.id)
    expect(listSkills('/repo/a')).toHaveLength(0)
  })

  it('brainStats reports total / reuse / pinned for the panel', () => {
    const a = learn('/repo/a', { title: 'one', body: 'first' }, NOW)
    learn('/repo/a', { title: 'two', body: 'second' }, NOW)
    setSkillPinned(a.id, true)
    const stats = brainStats('/repo/a')
    expect(stats.total).toBe(2)
    expect(stats.pinned).toBe(1)
  })
})
