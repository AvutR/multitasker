import type { EngineProtocol } from './engines'

/**
 * Normalizes one line of a CLI engine's stdout into a transcript event. Pure +
 * deterministic so the orchestrator can drive any tool through one code path.
 *
 * - claude-json (cursor-agent, and the Claude SDK): NDJSON {type:system|user|
 *   assistant|result|...} — the SAME protocol Claude Code emits.
 * - codex-jsonl (codex exec --json): NDJSON {type:thread.started|turn.*|item.*|error}.
 * - text (gemini/aider/unknown): raw lines, captured as assistant text.
 */
export interface ParsedEvent {
  kind: 'system' | 'assistant' | 'user' | 'result' | 'error' | 'ignore'
  text?: string
  sessionId?: string
  model?: string
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  isError?: boolean
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/** Extract concatenated text from a content array (claude/cursor message shape). */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: string }).text ?? '') : ''))
    .join('')
}

export function parseEngineLine(protocol: EngineProtocol, line: string): ParsedEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  if (protocol === 'text') {
    // Not structured — surface each non-empty line as assistant text.
    return { kind: 'assistant', text: line }
  }

  let o: Record<string, unknown>
  try {
    o = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // A tool may interleave non-JSON log lines; show them rather than drop them.
    return { kind: 'assistant', text: line }
  }
  const type = String(o.type ?? '')

  if (protocol === 'claude-json') {
    switch (type) {
      case 'system':
        return { kind: 'system', sessionId: typeof o.session_id === 'string' ? o.session_id : undefined, model: typeof o.model === 'string' ? o.model : undefined }
      case 'user': {
        const text = contentText((o.message as { content?: unknown } | undefined)?.content)
        return { kind: 'user', text }
      }
      case 'assistant': {
        const text = contentText((o.message as { content?: unknown } | undefined)?.content)
        return text ? { kind: 'assistant', text } : { kind: 'ignore' }
      }
      case 'result': {
        // cursor uses camelCase (inputTokens/cacheReadTokens); the Claude SDK uses
        // snake_case (input_tokens/cache_read_input_tokens) — accept either.
        const u = (o.usage ?? {}) as Record<string, unknown>
        const cached = num(u.cacheReadTokens) + num(u.cache_read_input_tokens)
        const input = num(u.inputTokens) + num(u.input_tokens) + cached + num(u.cacheWriteTokens) + num(u.cache_creation_input_tokens)
        const output = num(u.outputTokens) + num(u.output_tokens)
        return {
          kind: 'result',
          isError: o.is_error === true,
          costUsd: num(o.total_cost_usd),
          inputTokens: input || undefined,
          outputTokens: output || undefined,
          cachedInputTokens: cached || undefined,
          text: typeof o.result === 'string' ? o.result : undefined
        }
      }
      default:
        return { kind: 'ignore' }
    }
  }

  // codex-jsonl: thread.started / turn.started / item.* / turn.completed / error / turn.failed
  switch (type) {
    case 'thread.started':
      return { kind: 'system', sessionId: typeof o.thread_id === 'string' ? o.thread_id : undefined }
    case 'item.completed':
    case 'item.updated': {
      const item = (o.item ?? {}) as Record<string, unknown>
      const text = typeof item.text === 'string' ? item.text : typeof o.text === 'string' ? o.text : ''
      return text ? { kind: 'assistant', text } : { kind: 'ignore' }
    }
    case 'turn.completed':
      return { kind: 'result', isError: false }
    case 'error':
    case 'turn.failed': {
      const msg = typeof o.message === 'string' ? o.message : JSON.stringify((o.error as Record<string, unknown>)?.message ?? o.error ?? 'turn failed')
      return { kind: 'error', isError: true, text: msg }
    }
    default:
      return { kind: 'ignore' }
  }
}
