import { describe, expect, it } from 'vitest'
import { extractIssueId, shortLabel, taskColor, taskKey } from '../../src/shared/agentBadge'

const s = (over: { id?: string; title?: string; linearIssueId?: string | null }) => ({ id: 'id1', title: '', linearIssueId: null, ...over })

describe('agentBadge — short-form + color-coded agents', () => {
  it('extracts a tracker id from the title', () => {
    expect(extractIssueId('ENG-1234 Fix the policy form')).toBe('ENG-1234')
    expect(extractIssueId('PROJ-12 export CSV')).toBe('PROJ-12')
    expect(extractIssueId('no tracker here')).toBeNull()
  })

  it('shortLabel prefers the tracker number', () => {
    expect(shortLabel(s({ title: 'ENG-1234 Fix the policy form' }))).toBe('ENG-1234')
  })

  it('shortLabel keeps the first MEANINGFUL words (not an acronym), skipping leading filler', () => {
    // reads as what the task IS, not "ABL"
    expect(shortLabel(s({ title: 'Fix the login race condition' }))).toBe('login race') // fix/the skipped, trimmed to budget
    expect(shortLabel(s({ title: 'Cost observatory panel' }))).toBe('Cost observatory')
    expect(shortLabel(s({ title: 'Add user onboarding flow' }))).toBe('user onboarding') // 'add' skipped
  })

  it('shortLabel keeps a single word, ellipsizing only when it overflows', () => {
    expect(shortLabel(s({ title: 'maintenance' }))).toBe('maintenance')
    expect(shortLabel(s({ title: 'internationalization' }))).toBe('internationaliz…') // >16 chars
    expect(shortLabel(s({ title: '' }))).toBe('·')
  })

  it('taskColor is deterministic and shares across siblings of one issue', () => {
    const a = taskColor(s({ id: 'a', title: 'ENG-1234 part one' }))
    const b = taskColor(s({ id: 'b', title: 'ENG-1234 part two' }))
    expect(a).toBe(b) // same tracker id → same color, regardless of session id
    expect(a).toMatch(/^#[0-9a-f]{6}$/)
    // a different task gets its key from the title
    expect(taskKey(s({ title: 'unrelated work' }))).toBe('unrelated work')
  })
})
