import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Redirect homedir() so the registry reads our throwaway trackers.json instead
// of the real ~/.multitasker. Mirrors the launchPresets test pattern.
const h = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => h.home }
})

import { getActiveTracker, listProviderIds } from '../../src/main/integrations/trackers/registry'

function writeConfig(active: string | undefined): void {
  const dir = join(h.home, '.multitasker')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'trackers.json'), JSON.stringify(active === undefined ? {} : { active }))
}

describe('tracker registry — plug-and-play providers', () => {
  beforeEach(() => {
    h.home = mkdtempSync(join(tmpdir(), 'mt-tracker-'))
  })
  afterEach(() => rmSync(h.home, { recursive: true, force: true }))

  it('defaults to Linear when no trackers.json is present', () => {
    expect(getActiveTracker().id).toBe('linear')
    expect(getActiveTracker().label).toBe('Linear')
  })

  it('honors an explicit active provider', () => {
    writeConfig('linear')
    expect(getActiveTracker().id).toBe('linear')
  })

  it('falls back to Linear on an unknown provider id', () => {
    writeConfig('jira-not-yet-implemented')
    expect(getActiveTracker().id).toBe('linear')
  })

  it('falls back to Linear on a malformed config file', () => {
    const dir = join(h.home, '.multitasker')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'trackers.json'), '{ not valid json')
    expect(getActiveTracker().id).toBe('linear')
  })

  it('listProviderIds includes the built-in default', () => {
    expect(listProviderIds()).toContain('linear')
  })
})
