import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => h.home }
})

import { getActiveCIProvider, listCIProviderIds } from '../../src/main/integrations/ci/registry'
import { normalizeRun } from '../../src/main/integrations/ci/github'

function writeConfig(active: string | undefined): void {
  const dir = join(h.home, '.multitasker')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'ci.json'), JSON.stringify(active === undefined ? {} : { active }))
}

describe('CI provider registry', () => {
  beforeEach(() => {
    h.home = mkdtempSync(join(tmpdir(), 'mt-ci-'))
  })
  afterEach(() => rmSync(h.home, { recursive: true, force: true }))

  it('defaults to GitHub Actions when no ci.json is present', () => {
    expect(getActiveCIProvider().id).toBe('github-actions')
  })

  it('falls back to the default on an unknown provider id', () => {
    writeConfig('jenkins-not-yet')
    expect(getActiveCIProvider().id).toBe('github-actions')
  })

  it('lists the built-in default', () => {
    expect(listCIProviderIds()).toContain('github-actions')
  })
})

describe('normalizeRun — maps gh run rows onto CIRun', () => {
  it('maps in-progress and completed conclusions', () => {
    expect(normalizeRun({ databaseId: 1, name: 'CI', status: 'in_progress', headBranch: 'main', createdAt: '2026-01-01T00:00:00Z' })?.status).toBe('running')
    expect(normalizeRun({ databaseId: 2, name: 'CI', status: 'completed', conclusion: 'success' })?.status).toBe('success')
    expect(normalizeRun({ databaseId: 3, name: 'CI', status: 'completed', conclusion: 'failure' })?.status).toBe('failure')
    expect(normalizeRun({ databaseId: 4, name: 'CI', status: 'queued' })?.status).toBe('queued')
    expect(normalizeRun({ databaseId: 5, name: 'CI', status: 'completed', conclusion: 'cancelled' })?.status).toBe('cancelled')
  })

  it('parses the timestamp and carries the provider id', () => {
    const r = normalizeRun({ databaseId: 9, name: 'Deploy', status: 'completed', conclusion: 'success', createdAt: '2026-05-01T12:00:00Z' })
    expect(r?.createdAt).toBe(Date.parse('2026-05-01T12:00:00Z'))
    expect(r?.providerId).toBe('github-actions')
  })

  it('drops a row with no id', () => {
    expect(normalizeRun({ name: 'x' })).toBeNull()
  })
})
