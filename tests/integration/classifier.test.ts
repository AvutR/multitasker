import { describe, expect, it } from 'vitest'
import { classifyRawTool } from '../../src/main/integrations/actionTypes'

describe('classifyRawTool — default-deny connector guard (path #2)', () => {
  it('gates known connector writes', () => {
    expect(classifyRawTool('mcp__slack__slack_send_message')?.actionType).toBe('slack.message')
    expect(classifyRawTool('mcp__slack__slack_create_canvas')?.actionType).toBe('slack.message')
    expect(classifyRawTool('mcp__linear__save_status_update')?.actionType).toBe('linear.status_update')
    expect(classifyRawTool('mcp__linear__save_issue')?.actionType).toBe('linear.issue_update')
    expect(classifyRawTool('mcp__notion__notion-update-page')?.actionType).toBe('notion.page_update')
  })

  it('allows connector reads through ungated', () => {
    expect(classifyRawTool('mcp__slack__slack_search_users')).toBeNull()
    expect(classifyRawTool('mcp__slack__slack_read_channel')).toBeNull()
    expect(classifyRawTool('mcp__linear__list_issues')).toBeNull()
    expect(classifyRawTool('mcp__linear__get_issue')).toBeNull()
    expect(classifyRawTool('mcp__notion__notion-fetch')).toBeNull()
  })

  it('gates unknown / unenumerated connector writes (fail-safe)', () => {
    expect(classifyRawTool('mcp__slack__slack_create_conversation')?.actionType).toBe('slack.message')
    expect(classifyRawTool('mcp__linear__delete_comment')?.actionType).toBe('linear.comment')
    expect(classifyRawTool('mcp__notion__notion-create-database')?.actionType).toBe('notion.page_update')
  })

  it('catches out-of-band connector calls via Bash', () => {
    expect(classifyRawTool('Bash', { command: 'gh pr create --fill' })?.actionType).toBe('github.pr_create')
    expect(classifyRawTool('Bash', { command: 'curl -X POST https://slack.com/api/chat.postMessage' })?.actionType).toBe(
      'slack.message'
    )
  })

  it('never gates our own semantic integration tools (handled by path #1)', () => {
    expect(classifyRawTool('mcp__multitasker-integrations__update_linear_status')).toBeNull()
    expect(classifyRawTool('mcp__multitasker-integrations__post_standup')).toBeNull()
  })

  it('ignores ordinary file/shell tools', () => {
    expect(classifyRawTool('Read')).toBeNull()
    expect(classifyRawTool('Edit')).toBeNull()
    expect(classifyRawTool('Bash', { command: 'npm test' })).toBeNull()
  })
})
