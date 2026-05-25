import type { Connector } from '@shared/types'
import { claudeExecutablePath } from '../sdkRuntime'

export interface ConnectorExecuteInput {
  actionType: string
  connector: Connector
  payload: unknown
  summary: string
}

export interface ConnectorExecuteResult {
  ok: boolean
  result?: unknown
  error?: string
}

/** Performs a real external action. Injected so tests can supply a fake. */
export interface ConnectorGateway {
  execute(input: ConnectorExecuteInput): Promise<ConnectorExecuteResult>
}

/**
 * Real gateway. Carries out one integration action through the user's OWN
 * MCP connectors by launching a tightly-scoped, short-lived headless Agent
 * SDK run. This reuses the exact connector auth the sessions use
 * (settingSources loads the user's MCP config) — no separate connector
 * client management. Only invoked for AUTO + non-dry-run actions or on human
 * approval, so the per-action subprocess cost is acceptable.
 */
export class SdkConnectorGateway implements ConnectorGateway {
  async execute(input: ConnectorExecuteInput): Promise<ConnectorExecuteResult> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const connector = input.connector
    try {
      const run = query({
        prompt: buildPrompt(input),
        options: {
          settingSources: ['user', 'project', 'local'],
          pathToClaudeCodeExecutable: claudeExecutablePath(),
          // NOT bypassPermissions: this worker may ONLY call MCP connector
          // tools (never shell/fs/local tools like Bash/Edit/Read), and never a
          // different *named* connector — so an injected payload can't escalate
          // beyond the single approved action that already passed the policy.
          // Match by MCP namespace, NOT the connector word: some connectors
          // (e.g. Linear) name their tools `save_issue` / `list_issues` with no
          // "linear" token, so a substring check denied every tool and the run
          // burned its turns to error_max_turns.
          permissionMode: 'default',
          // A single action often needs a lookup turn (resolve an id) before the
          // write, plus a final summary turn — 2 was too few and tripped
          // error_max_turns even when the right tool was allowed.
          maxTurns: 8,
          canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
            if (isConnectorToolAllowed(toolName, connector)) {
              return { behavior: 'allow', updatedInput: toolInput }
            }
            return { behavior: 'deny', message: `execution worker may only call ${connector} connector tools` }
          },
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append:
              'You are a single-action execution worker. Perform ONLY the one requested integration action using the matching connector tool, then stop. Never improvise or take additional actions.'
          }
        }
      })
      let last: unknown = null
      for await (const msg of run) {
        if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            return { ok: true, result: (msg as { result?: unknown }).result ?? last }
          }
          return { ok: false, error: `execution agent ended with: ${msg.subtype}` }
        }
        if (msg.type === 'assistant') last = msg
      }
      return { ok: true, result: last }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

// Connectors whose MCP tool names embed their own name, so we can recognize a
// *different* connector's tool and refuse it. Linear is intentionally absent:
// its tools (save_issue, list_issues, save_status_update, …) carry no "linear"
// token, so it can't be excluded by name — only the named connectors below are
// used for cross-connector containment.
const NAMED_CONNECTOR_HINTS: Record<string, string[]> = {
  slack: ['slack'],
  notion: ['notion'],
  github: ['github']
}

/**
 * Permission rule for the single-action execution worker. Allows ONLY MCP
 * connector tools (anything not `mcp__`-prefixed — Bash, Edit, Read, … — is an
 * escalation path and stays denied), and refuses tools that clearly belong to a
 * *different* named connector. Pure + exported so the rule is unit-tested
 * without spawning a subprocess.
 */
export function isConnectorToolAllowed(toolName: string, connector: string): boolean {
  const n = toolName.toLowerCase()
  if (!n.startsWith('mcp__')) return false // shell/fs/local tools never allowed
  for (const [other, hints] of Object.entries(NAMED_CONNECTOR_HINTS)) {
    if (other !== connector && hints.some((h) => n.includes(h))) return false
  }
  return true
}

function buildPrompt(input: ConnectorExecuteInput): string {
  return [
    `Perform this ${input.connector} action and nothing else.`,
    `Action type: ${input.actionType}`,
    `Summary: ${input.summary}`,
    'Payload (JSON):',
    '```json',
    JSON.stringify(input.payload, null, 2),
    '```',
    `Use the ${input.connector} connector tool that matches this action, then report success or the error.`
  ].join('\n')
}
