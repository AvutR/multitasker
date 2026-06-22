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

  it('gates a UUID-namespaced Linear server, whose tool names carry no "linear" token (regression)', () => {
    const srv = 'mcp__ab0a5aff-baf3-4030-8fb8-f3fa078c7b7c__'
    expect(classifyRawTool(`${srv}save_issue`)?.actionType).toBe('linear.issue_update')
    expect(classifyRawTool(`${srv}save_status_update`)?.actionType).toBe('linear.status_update')
    expect(classifyRawTool(`${srv}save_comment`)?.actionType).toBe('linear.comment')
    expect(classifyRawTool(`${srv}create_issue_label`)?.actionType).toBe('linear.issue_update')
  })

  it('passes UUID-namespaced Linear reads through ungated', () => {
    const srv = 'mcp__ab0a5aff-baf3-4030-8fb8-f3fa078c7b7c__'
    expect(classifyRawTool(`${srv}get_issue`)).toBeNull()
    expect(classifyRawTool(`${srv}list_issues`)).toBeNull()
    expect(classifyRawTool(`${srv}list_cycles`)).toBeNull()
  })

  it('does not over-gate non-connector MCP tools that lack tracker nouns', () => {
    expect(classifyRawTool('mcp__Claude_in_Chrome__navigate')).toBeNull()
    expect(classifyRawTool('mcp__Claude_Preview__preview_screenshot')).toBeNull()
    expect(classifyRawTool('mcp__scheduled-tasks__create_scheduled_task')).toBeNull()
  })

  it('catches out-of-band connector calls via Bash', () => {
    expect(classifyRawTool('Bash', { command: 'gh pr create --fill' })?.actionType).toBe('github.pr_create')
    expect(classifyRawTool('Bash', { command: 'curl -X POST https://slack.com/api/chat.postMessage' })?.actionType).toBe(
      'slack.message'
    )
  })

  it('gates a raw `git push` via Bash (the gh check alone missed it)', () => {
    expect(classifyRawTool('Bash', { command: 'git push origin my-branch' })?.actionType).toBe('github.push_branch')
    expect(classifyRawTool('Bash', { command: 'git   push -u origin HEAD' })?.actionType).toBe('github.push_branch')
    expect(classifyRawTool('Bash', { command: 'git commit -m wip' })).toBeNull() // local-only, not gated
  })

  it('classifies by action VERB, not noun — a write can’t smuggle through on a read-ish noun', () => {
    // These carry a read-ish NOUN (documents/members/comments/labels) but a WRITE
    // verb — previously they slipped through as "reads"; now they're gated.
    expect(classifyRawTool('mcp__notion__notion-update-documents')?.actionType).toBe('notion.page_update')
    expect(classifyRawTool('mcp__slack__slack_update_members')?.actionType).toBe('slack.message')
    expect(classifyRawTool('mcp__linear__create_comment')?.actionType).toBe('linear.comment')
    expect(classifyRawTool('mcp__linear__archive_project')?.actionType).toBe('linear.issue_update')
    // Genuine reads with those nouns still pass (read verb, no write verb).
    expect(classifyRawTool('mcp__linear__list_comments')).toBeNull()
    expect(classifyRawTool('mcp__notion__notion-get-documents')).toBeNull()
    expect(classifyRawTool('mcp__slack__slack_list_channel_members')).toBeNull()
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
