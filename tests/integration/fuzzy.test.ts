import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from '../../src/shared/fuzzy'

describe('fuzzyScore', () => {
  it('returns 0 when the query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'New session')).toBe(0)
    expect(fuzzyScore('zzz', 'abc')).toBe(0)
  })

  it('returns a positive score for a subsequence match', () => {
    expect(fuzzyScore('ns', 'New session')).toBeGreaterThan(0)
    expect(fuzzyScore('', 'anything')).toBeGreaterThan(0) // empty query matches
  })

  it('ranks a contiguous / word-start match higher than a scattered one', () => {
    expect(fuzzyScore('con', 'New conductor')).toBeGreaterThan(fuzzyScore('con', 'cancel notification on'))
  })
})

describe('fuzzyFilter', () => {
  const items = ['New session', 'New conductor', 'Go to Mission Control', 'Toggle dry-run', 'Open Tasks']

  it('returns all items (unranked) for an empty query', () => {
    expect(fuzzyFilter('', items, (s) => s)).toEqual(items)
  })

  it('filters out non-matches and ranks best first', () => {
    const r = fuzzyFilter('nc', items, (s) => s)
    expect(r[0]).toBe('New conductor') // n-c contiguous at word starts
    expect(r).not.toContain('Toggle dry-run')
  })

  it('matches across word boundaries', () => {
    expect(fuzzyFilter('tasks', items, (s) => s)).toContain('Open Tasks')
    expect(fuzzyFilter('mission', items, (s) => s)).toEqual(['Go to Mission Control'])
  })
})
