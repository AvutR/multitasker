import type { Connector } from '@shared/types'

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
          // NOT bypassPermissions: this worker is scoped to ONLY the target
          // connector's tools. canUseTool denies Bash, Edit, and every other
          // connector, so a malicious/injected payload can't escalate beyond
          // the single approved action that already passed the policy.
          permissionMode: 'default',
          maxTurns: 2,
          canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
            if (toolName.toLowerCase().includes(connector)) {
              return { behavior: 'allow', updatedInput: toolInput }
            }
            return { behavior: 'deny', message: `execution worker may only call ${connector} tools` }
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
