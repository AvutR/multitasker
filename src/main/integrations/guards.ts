import type { ActionService } from './ActionService'
import { classifyRawTool } from './actionTypes'

export interface GateDecision {
  allow: boolean
  message?: string
}

/**
 * Path #2 — the safety net, wired into the session's `canUseTool` permission
 * authority. Intercepts RAW connector tool calls (e.g. an agent calling
 * slack_send_message directly) and applies the same policy. Non-connector
 * tools and connector READS return allow immediately. Guarantees nothing
 * outward escapes the policy regardless of how the agent phrases the call.
 */
export function createConnectorGate(actionService: ActionService, sessionId: string) {
  return async (toolName: string, toolInput: Record<string, unknown>): Promise<GateDecision> => {
    const cls = classifyRawTool(toolName, toolInput)
    if (!cls) return { allow: true } // not a gated connector write

    const outcome = await actionService.guard({
      sessionId,
      actionType: cls.actionType,
      summary: summarizeRawCall(cls.actionType, toolInput),
      payload: toolInput
    })
    return { allow: outcome.allow, message: outcome.message }
  }
}

function summarizeRawCall(actionType: string, input: Record<string, unknown>): string {
  const target = input.channel ?? input.issueId ?? input.pageId ?? input.id ?? input.url ?? ''
  return `${actionType}${target ? ` (${String(target)})` : ''} [raw call]`
}
