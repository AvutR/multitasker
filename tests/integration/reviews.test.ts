import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '@shared/types'
import { openDatabase } from '../../src/main/db/database'
import { createRepositories } from '../../src/main/db/repositories'

const setup = () => createRepositories(openDatabase(':memory:'))
let n = 0
const cm = (over: Partial<ReviewComment>): ReviewComment => ({ id: `c${n++}`, sessionId: 's1', relPath: 'src/a.ts', line: 1, body: 'looks off', createdAt: n, ...over })

describe('ReviewRepo — line-by-line review comments', () => {
  it('adds and lists by session, ordered by file then line', () => {
    const r = setup()
    r.reviews.add(cm({ relPath: 'src/b.ts', line: 5 }))
    r.reviews.add(cm({ relPath: 'src/a.ts', line: 10 }))
    r.reviews.add(cm({ relPath: 'src/a.ts', line: 2 }))
    expect(r.reviews.list('s1').map((x) => `${x.relPath}:${x.line}`)).toEqual(['src/a.ts:2', 'src/a.ts:10', 'src/b.ts:5'])
  })

  it('filters to one file', () => {
    const r = setup()
    r.reviews.add(cm({ relPath: 'a.ts' }))
    r.reviews.add(cm({ relPath: 'b.ts' }))
    expect(r.reviews.list('s1', 'a.ts').map((x) => x.relPath)).toEqual(['a.ts'])
  })

  it('deletes one, and all-by-session', () => {
    const r = setup()
    r.reviews.add(cm({ id: 'keep', relPath: 'a.ts', line: 1 }))
    r.reviews.add(cm({ id: 'gone', relPath: 'a.ts', line: 3 }))
    r.reviews.delete('gone')
    expect(r.reviews.list('s1').map((c) => c.id)).toEqual(['keep'])
    r.reviews.deleteBySession('s1')
    expect(r.reviews.list('s1')).toEqual([])
  })

  it('isolates comments by session', () => {
    const r = setup()
    r.reviews.add(cm({ sessionId: 's1', relPath: 'a.ts' }))
    r.reviews.add(cm({ sessionId: 's2', relPath: 'a.ts' }))
    expect(r.reviews.list('s2')).toHaveLength(1)
    expect(r.reviews.list('s1')).toHaveLength(1)
  })
})
