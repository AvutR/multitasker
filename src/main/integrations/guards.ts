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
      // Audit the call, but never persist raw secrets (a curl -H Authorization, a
      // token in a body). The agent still EXECUTES with the real values — only the
      // append-only audit copy is scrubbed.
      payload: redactSecrets(toolInput)
    })
    return { allow: outcome.allow, message: outcome.message }
  }
}

function summarizeRawCall(actionType: string, input: Record<string, unknown>): string {
  const target = input.channel ?? input.issueId ?? input.pageId ?? input.id ?? input.url ?? ''
  return `${actionType}${target ? ` (${String(target)})` : ''} [raw call]`
}

// Keys whose VALUE is a secret regardless of content, and inline secret shapes
// (bearer tokens, sk-/gh*_/xox*- keys, JWTs) that show up in command strings/bodies.
const SENSITIVE_KEY = /(authorization|api[-_]?key|token|password|passwd|secret|cookie|bearer|credential|private[-_]?key)/i
const SECRET_PATTERN = /(bearer\s+[\w.-]+|sk-[\w-]{16,}|gh[pousr]_[\w]{20,}|xox[baprs]-[\w-]+|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+)/gi

/** Deep-redact secrets from an audited payload (does not touch the live call). */
function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]'
  if (typeof value === 'string') return value.replace(SECRET_PATTERN, '[REDACTED]')
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redactSecrets(v, depth + 1)
    }
    return out
  }
  return value
}
