import { describe, expect, it } from 'vitest'
import { resolvePresetId, routePreset } from '../../src/main/skills/taskRouter'

describe('taskRouter — automatic skill selection (no slash command)', () => {
  it('routes feature / fix / refactor work to the build pipeline', () => {
    expect(routePreset('Add a CSV export endpoint')).toBe('build')
    expect(routePreset('fix the flaky login test')).toBe('build')
    expect(routePreset('refactor the auth module')).toBe('build')
  })

  it('routes standup and Linear ops to their presets', () => {
    expect(routePreset('post my standup for the gateway project')).toBe('standup')
    expect(routePreset('update Linear statuses for this cycle')).toBe('linear-sync')
  })

  it('falls back to explore for open-ended tasks', () => {
    expect(routePreset('explain how the policy engine works')).toBe('explore')
  })

  it('resolvePresetId honors an explicit preset but routes auto/empty by intent', () => {
    expect(resolvePresetId('explore', 'add a feature')).toBe('explore')
    expect(resolvePresetId('auto', 'add a feature')).toBe('build')
    expect(resolvePresetId(undefined, 'post standup')).toBe('standup')
  })
})
