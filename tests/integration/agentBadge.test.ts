import { describe, expect, it } from 'vitest'
import { extractIssueId, shortLabel, taskColor, taskKey } from '../../src/shared/agentBadge'

const s = (over: { id?: string; title?: string; linearIssueId?: string | null }) => ({ id: 'id1', title: '', linearIssueId: null, ...over })

describe('agentBadge — short-form + color-coded agents', () => {
  it('extracts a tracker id from the title', () => {
    expect(extractIssueId('WEB-4849 Fix the policy form')).toBe('WEB-4849')
    expect(extractIssueId('ENG-12 export CSV')).toBe('ENG-12')
    expect(extractIssueId('no tracker here')).toBeNull()
  })

  it('shortLabel prefers the tracker number', () => {
    expect(shortLabel(s({ title: 'WEB-4849 Fix the policy form' }))).toBe('WEB-4849')
  })

  it('shortLabel acronyms a multi-word task (skipping stopwords)', () => {
    expect(shortLabel(s({ title: 'Fix the authentication bug in login' }))).toBe('ABL') // authentication, bug, login (fix/the/in skipped)
    expect(shortLabel(s({ title: 'Cost observatory panel' }))).toBe('COP')
  })

  it('shortLabel truncates a single meaningful word', () => {
    expect(shortLabel(s({ title: 'maintenance' }))).toBe('MAIN')
    expect(shortLabel(s({ title: '' }))).toBe('·')
  })

  it('taskColor is deterministic and shares across siblings of one issue', () => {
    const a = taskColor(s({ id: 'a', title: 'WEB-4849 part one' }))
    const b = taskColor(s({ id: 'b', title: 'WEB-4849 part two' }))
    expect(a).toBe(b) // same tracker id → same color, regardless of session id
    expect(a).toMatch(/^#[0-9a-f]{6}$/)
    // a different task gets its key from the title
    expect(taskKey(s({ title: 'unrelated work' }))).toBe('unrelated work')
  })
})
