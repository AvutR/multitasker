import { describe, expect, it } from 'vitest'
import { LinearService, parseLinearIssues, type LinearReader } from '../../src/main/integrations/LinearService'

describe('parseLinearIssues', () => {
  it('parses a clean JSON array', () => {
    const raw = JSON.stringify([
      { id: 'i1', identifier: 'ENG-1', title: 'Fix export', url: 'http://x', state: 'Todo', branchName: 'eng-1-fix-export', description: 'd' }
    ])
    const issues = parseLinearIssues(raw)
    expect(issues).toHaveLength(1)
    expect(issues[0].identifier).toBe('ENG-1')
    expect(issues[0].branchName).toBe('eng-1-fix-export')
  })

  it('extracts JSON embedded in prose / a code fence', () => {
    const raw = 'Here are your issues:\n```json\n[{"identifier":"ENG-2","title":"Add CSV export"}]\n```\nLet me know!'
    const issues = parseLinearIssues(raw)
    expect(issues).toHaveLength(1)
    expect(issues[0].identifier).toBe('ENG-2')
    // branchName derived from identifier+title when the model omits it
    expect(issues[0].branchName).toContain('eng-2')
  })

  it('returns [] on non-JSON or empty', () => {
    expect(parseLinearIssues('no issues found')).toEqual([])
    expect(parseLinearIssues('')).toEqual([])
  })

  it('skips malformed entries (missing title)', () => {
    const raw = '[{"identifier":"ENG-3"},{"identifier":"ENG-4","title":"Real one"}]'
    const issues = parseLinearIssues(raw)
    expect(issues).toHaveLength(1)
    expect(issues[0].identifier).toBe('ENG-4')
  })
})

describe('LinearService', () => {
  it('reads + parses assigned issues via the injected reader', async () => {
    const reader: LinearReader = {
      fetchAssignedIssuesRaw: async () => '[{"identifier":"ENG-9","title":"Wire it up"}]'
    }
    const issues = await new LinearService(reader).listMyIssues()
    expect(issues[0].identifier).toBe('ENG-9')
    expect(issues[0].branchName).toContain('eng-9')
  })
})
