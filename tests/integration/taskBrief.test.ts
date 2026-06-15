import { describe, expect, it } from 'vitest'
import type { MemoryNote } from '@shared/types'
import { buildTaskBrief } from '../../src/shared/taskBrief'

function note(text: string, tag?: string): MemoryNote {
  return { id: Math.random().toString(36), text, tag, createdAt: 1 }
}

describe('buildTaskBrief — per-task min-maxed context', () => {
  it('always includes the task title and a scope reminder', () => {
    const brief = buildTaskBrief({ title: 'Add CSV export', notes: [] })
    expect(brief).toContain('# Task context')
    expect(brief).toContain('**Task:** Add CSV export')
    expect(brief).toMatch(/recall/) // points the agent at the memory tools
    expect(brief).not.toContain('## Relevant project memory') // no section when no notes
  })

  it('includes the tracker reference when present', () => {
    const brief = buildTaskBrief({ title: 'Fix login', issueIdentifier: 'ENG-12', issueUrl: 'https://l/ENG-12', notes: [] })
    expect(brief).toContain('**Tracker:** ENG-12 — https://l/ENG-12')
  })

  it('embeds relevant project memory, capped at 5 and clamped in length', () => {
    const notes = Array.from({ length: 8 }, (_, i) => note(`finding number ${i}`, i === 0 ? 'arch' : undefined))
    const brief = buildTaskBrief({ title: 'T', notes })
    expect(brief).toContain('## Relevant project memory')
    expect(brief).toContain('finding number 0')
    expect(brief).toContain('_[arch]_')
    expect(brief).not.toContain('finding number 5') // capped at 5
  })

  it('clamps a very long note', () => {
    const brief = buildTaskBrief({ title: 'T', notes: [note('x'.repeat(400))] })
    expect(brief).toContain('…')
    expect(brief.length).toBeLessThan(400)
  })
})
