import type { TranscriptMessage } from './types'

/**
 * Flattens the raw message stream into a clean, render-ready timeline.
 *
 * The SDK emits tool calls (`tool_use`) and their outputs (`tool_result`) in
 * SEPARATE messages — the call inside an assistant turn, the result inside a
 * later user turn. The UI wants them as ONE thing: an "action" with a status.
 * This pairs them by tool-use id and drops the empty/duplicate noise, so the
 * transcript reads as a calm sequence of {said · did · result} instead of a
 * wall of nested boxes. Pure + tested.
 */

export type ToolStatus = 'running' | 'ok' | 'error'

export type TimelineEvent =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result?: string; status: ToolStatus }
  | { kind: 'result'; id: string; text: string; costUsd?: number }

interface ToolEvent {
  kind: 'tool'
  id: string
  name: string
  input: unknown
  result?: string
  status: ToolStatus
}

export function buildTimeline(messages: TranscriptMessage[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  const toolById = new Map<string, ToolEvent>()

  for (const m of messages) {
    // A 'result' message is the turn summary — collapse it to one quiet divider.
    if (m.kind === 'result') {
      const text = m.blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join(' ')
        .trim()
      events.push({ kind: 'result', id: m.id, text, costUsd: m.costUsd })
      continue
    }

    let i = 0
    for (const b of m.blocks) {
      const id = `${m.id}-${i++}`
      switch (b.type) {
        case 'text':
          if (b.text.trim()) events.push({ kind: m.kind === 'user' ? 'user' : 'assistant', id, text: b.text })
          break
        case 'thinking':
          if (b.text.trim()) events.push({ kind: 'thinking', id, text: b.text })
          break
        case 'tool_use': {
          const ev: ToolEvent = { kind: 'tool', id: b.id, name: b.name, input: b.input, status: 'running' }
          toolById.set(b.id, ev)
          events.push(ev)
          break
        }
        case 'tool_result': {
          const ev = toolById.get(b.toolUseId)
          if (ev) {
            ev.result = b.text
            ev.status = b.isError ? 'error' : 'ok'
          } else {
            // Orphan result (its call scrolled out of the in-memory window).
            events.push({ kind: 'tool', id: b.toolUseId, name: 'result', input: null, result: b.text, status: b.isError ? 'error' : 'ok' })
          }
          break
        }
      }
    }
  }
  return events
}

/** A concise one-line label for a tool action — the *what*, not the JSON. */
export function summarizeTool(name: string, input: unknown): { label: string; detail: string } {
  const bare = name.replace(/^mcp__[^_]*__/, '').replace(/^mcp__/, '') // strip MCP server namespace
  const arg = (key: string): string | undefined => {
    if (input && typeof input === 'object' && key in input) {
      const v = (input as Record<string, unknown>)[key]
      return typeof v === 'string' ? v : undefined
    }
    return undefined
  }
  const base = (p?: string) => (p ? p.split('/').slice(-2).join('/') : '')

  switch (name) {
    case 'Bash':
      return { label: 'Run', detail: arg('command') ?? '' }
    case 'Read':
      return { label: 'Read', detail: base(arg('file_path')) }
    case 'Edit':
      return { label: 'Edit', detail: base(arg('file_path')) }
    case 'Write':
      return { label: 'Write', detail: base(arg('file_path')) }
    case 'Grep':
      return { label: 'Search', detail: arg('pattern') ?? '' }
    case 'Glob':
      return { label: 'Find', detail: arg('pattern') ?? '' }
    case 'TodoWrite':
      return { label: 'Plan', detail: 'update todos' }
    default:
      return { label: bare, detail: arg('channel') ?? arg('issueId') ?? arg('pageId') ?? arg('title') ?? arg('query') ?? '' }
  }
}
