import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Redirect homedir() to a throwaway temp dir so loadWorkflows reads a workflows
// file we control instead of the real ~/.multitasker. Only node:os is mocked;
// fs and JSON parsing run for real (outermost-layer integration style).
const h = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => h.home }
})

import {
  BUILTIN_PRESETS,
  getPreset,
  loadWorkflows,
  userWorkflowsPath
} from '../../src/main/skills/launchPresets'

function writeWorkflows(content: unknown): void {
  const path = userWorkflowsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
}

describe('launchPresets — plug-and-play workflow import', () => {
  beforeEach(() => {
    h.home = mkdtempSync(join(tmpdir(), 'mt-home-'))
  })
  afterEach(() => {
    rmSync(h.home, { recursive: true, force: true })
  })

  it('returns exactly the neutral built-ins when no user file exists', () => {
    const ids = loadWorkflows().map((p) => p.id)
    expect(ids).toEqual(BUILTIN_PRESETS.map((p) => p.id))
    expect(ids).toEqual(expect.arrayContaining(['build', 'explore', 'standup', 'tracker-sync']))
  })

  it('drops a documented example file so the format is discoverable', () => {
    loadWorkflows()
    expect(existsSync(join(h.home, '.multitasker', 'workflows.example.json'))).toBe(true)
  })

  it('merges a user workflow in addition to the built-ins', () => {
    writeWorkflows([
      { id: 'my-flow', name: 'My flow', systemPromptAppend: 'do the thing', permissionMode: 'plan', useWorktree: true }
    ])
    const flows = loadWorkflows()
    expect(flows).toHaveLength(BUILTIN_PRESETS.length + 1)
    const mine = getPreset('my-flow')
    expect(mine).toMatchObject({ name: 'My flow', permissionMode: 'plan', useWorktree: true })
  })

  it('lets a user workflow override a built-in by reusing its id', () => {
    writeWorkflows([{ id: 'explore', name: 'My explore', systemPromptAppend: 'custom' }])
    const flows = loadWorkflows()
    expect(flows).toHaveLength(BUILTIN_PRESETS.length) // override, not addition
    expect(getPreset('explore')?.name).toBe('My explore')
  })

  it('coerces unknown permissionMode and missing fields to safe defaults', () => {
    writeWorkflows([{ id: 'x', name: 'X', systemPromptAppend: 's', permissionMode: 'root', useWorktree: 'yes' }])
    const x = getPreset('x')!
    expect(x.permissionMode).toBe('default') // 'root' is not a valid mode
    expect(x.useWorktree).toBe(true) // truthy string coerced to boolean
    expect(x.description).toBe('')
  })

  it('sanitizes policyProfile: keeps known action+valid mode, drops the rest', () => {
    writeWorkflows([
      {
        id: 'p',
        name: 'P',
        systemPromptAppend: 's',
        policyProfile: {
          'linear.status_update': 'auto', // known id + valid mode → kept
          'evil.action': 'auto', // unknown action type → dropped
          'slack.message': 'yolo' // invalid mode → dropped
        }
      }
    ])
    expect(getPreset('p')?.policyProfile).toEqual({ 'linear.status_update': 'auto' })
  })

  it('drops policyProfile entirely when nothing in it is valid', () => {
    writeWorkflows([{ id: 'q', name: 'Q', systemPromptAppend: 's', policyProfile: { 'evil.action': 'auto' } }])
    expect(getPreset('q')?.policyProfile).toBeUndefined()
  })

  it('ignores malformed user files instead of breaking startup', () => {
    for (const bad of ['{ not json', JSON.stringify({ not: 'an array' }), JSON.stringify([{ id: 'no-name' }])]) {
      writeWorkflows(bad)
      const ids = loadWorkflows().map((p) => p.id)
      expect(ids).toEqual(BUILTIN_PRESETS.map((p) => p.id)) // falls back to built-ins, never throws
    }
  })
})
