import { describe, expect, it } from 'vitest'
import { classifySubtask, recommendModelForSubtask, tierForKind, TASK_KINDS } from '../../src/shared/modelTier'

describe('modelTier — auto-select a model for a delegated sub-task', () => {
  it('routes research/exploration to the cheap tier (haiku)', () => {
    expect(recommendModelForSubtask('find where the auth middleware lives')).toBe('haiku')
    expect(recommendModelForSubtask('research how the cache is invalidated')).toBe('haiku')
    expect(recommendModelForSubtask('search the repo for all callers of foo()')).toBe('haiku')
  })

  it('routes implementation/test/review to the mid tier (sonnet)', () => {
    expect(recommendModelForSubtask('implement the CSV export endpoint')).toBe('sonnet')
    expect(recommendModelForSubtask('write unit tests for the parser')).toBe('sonnet')
    expect(recommendModelForSubtask('review the diff for security issues')).toBe('sonnet')
    expect(recommendModelForSubtask('refactor the policy engine')).toBe('sonnet')
  })

  it('routes orchestration/architecture to the strong tier (opus)', () => {
    expect(recommendModelForSubtask('decompose this epic into independent workstreams')).toBe('opus')
    expect(recommendModelForSubtask('architect the migration plan')).toBe('opus')
  })

  it('routes docs to the cheap tier', () => {
    expect(classifySubtask('document the new API in the README')).toBe('docs')
    expect(recommendModelForSubtask('summarize what changed for the changelog')).toBe('haiku')
  })

  it('returns null when nothing classifies (caller falls back to the default tier)', () => {
    expect(classifySubtask('do A')).toBeNull()
    expect(recommendModelForSubtask('piece A')).toBeNull()
    expect(recommendModelForSubtask('xyzzy')).toBeNull()
  })

  it('prefers the more specific intent (review over implement)', () => {
    // "review the changes you implement" — review wins (listed first, more specific).
    expect(classifySubtask('review the implementation')).toBe('review')
  })

  it('tierForKind maps a conductor-judged kind to the right tier (LLM-as-judge)', () => {
    expect(tierForKind('research')).toBe('haiku')
    expect(tierForKind('docs')).toBe('haiku')
    expect(tierForKind('implement')).toBe('sonnet')
    expect(tierForKind('test')).toBe('sonnet')
    expect(tierForKind('review')).toBe('sonnet')
    expect(tierForKind('orchestrate')).toBe('opus')
  })

  it('TASK_KINDS covers every kind tierForKind handles', () => {
    expect(TASK_KINDS).toHaveLength(6)
    for (const k of TASK_KINDS) expect(['haiku', 'sonnet', 'opus']).toContain(tierForKind(k))
  })
})
