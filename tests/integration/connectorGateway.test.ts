import { describe, expect, it } from 'vitest'
import { isConnectorToolAllowed } from '../../src/main/integrations/ConnectorGateway'

// Regression: the worker gate used `toolName.includes(connector)`, which denied
// every Linear tool (save_issue / list_issues have no "linear" token), so the
// worker burned its turns and surfaced "execution agent ended with: error_max_turns".
describe('connector execution worker gate (isConnectorToolAllowed)', () => {
  it('allows the target connector’s MCP tools — including Linear, whose names lack "linear"', () => {
    expect(isConnectorToolAllowed('mcp__ab0a5aff-0000-0000-0000-000000000000__save_issue', 'linear')).toBe(true)
    expect(isConnectorToolAllowed('mcp__ab0a5aff-0000-0000-0000-000000000000__list_issues', 'linear')).toBe(true)
    expect(isConnectorToolAllowed('mcp__ab0a5aff-0000-0000-0000-000000000000__save_status_update', 'linear')).toBe(true)
    expect(isConnectorToolAllowed('mcp__2859__slack_send_message', 'slack')).toBe(true)
    expect(isConnectorToolAllowed('mcp__b91f__notion-update-page', 'notion')).toBe(true)
  })

  it('denies shell/fs/local tools so the worker can never escalate', () => {
    for (const t of ['Bash', 'bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'TodoWrite']) {
      expect(isConnectorToolAllowed(t, 'linear')).toBe(false)
    }
  })

  it('denies a different named connector (cross-connector containment)', () => {
    expect(isConnectorToolAllowed('mcp__2859__slack_send_message', 'linear')).toBe(false)
    expect(isConnectorToolAllowed('mcp__2859__slack_send_message', 'notion')).toBe(false)
    expect(isConnectorToolAllowed('mcp__b91f__notion-update-page', 'slack')).toBe(false)
    expect(isConnectorToolAllowed('mcp__b91f__notion-create-pages', 'linear')).toBe(false)
  })
})
