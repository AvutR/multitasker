import { describe, expect, it } from 'vitest'
import type { TrackerItem } from '@shared/types'
import { extractNotionUrl, issueToPrefill } from '../../src/shared/issuePrefill'

function issue(over: Partial<TrackerItem> = {}): TrackerItem {
  return { id: 'id-1', identifier: 'ENG-12', title: 'Add export', url: '', state: 'Todo', branchName: 'eng-12-add-export', ...over }
}

describe('issueToPrefill — pre-fill the composer, do NOT spawn', () => {
  it('builds an editable prompt from the issue, plus links and branch', () => {
    const p = issueToPrefill(issue({ description: 'Export CSV from the dashboard.' }))
    expect(p.prompt).toContain('ENG-12 — Add export')
    expect(p.prompt).toContain('Export CSV')
    expect(p.presetId).toBe('build')
    expect(p.title).toBe('ENG-12 Add export')
    expect(p.linearIssueId).toBe('id-1')
    expect(p.branchName).toBe('eng-12-add-export')
    expect(p.useWorktree).toBe(true)
  })

  it('extracts a linked Notion page from the description', () => {
    const p = issueToPrefill(issue({ description: 'spec: https://www.notion.so/team/Spec-abc123 thanks' }))
    expect(p.notionPageId).toBe('https://www.notion.so/team/Spec-abc123')
  })

  it('handles a missing description', () => {
    const p = issueToPrefill(issue({ description: undefined }))
    expect(p.prompt).toBe('ENG-12 — Add export')
    expect(p.notionPageId).toBeUndefined()
  })

  it('truncates a very long title to 80 chars', () => {
    const p = issueToPrefill(issue({ title: 'x'.repeat(200) }))
    expect((p.title ?? '').length).toBeLessThanOrEqual(80)
  })

  it('extractNotionUrl returns undefined when no URL is present', () => {
    expect(extractNotionUrl('no links here')).toBeUndefined()
    expect(extractNotionUrl(undefined)).toBeUndefined()
  })
})
