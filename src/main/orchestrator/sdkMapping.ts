import type { ContentBlock } from '@shared/types'

// The SDK's SDKMessage union is large and varies across versions, so it is the
// one untyped edge of the app. These pure helpers narrow raw message content
// into our strict ContentBlock model. Everything inward of here is typed.

type Raw = Record<string, unknown>

function asArray(v: unknown): Raw[] {
  return Array.isArray(v) ? (v as Raw[]) : []
}

/** Blocks from an assistant message's content array (text / thinking / tool_use). */
export function assistantBlocks(content: unknown): ContentBlock[] {
  const out: ContentBlock[] = []
  for (const b of asArray(content)) {
    switch (b.type) {
      case 'text':
        out.push({ type: 'text', text: String(b.text ?? '') })
        break
      case 'thinking':
        out.push({ type: 'thinking', text: String(b.thinking ?? b.text ?? '') })
        break
      case 'tool_use':
        out.push({ type: 'tool_use', id: String(b.id ?? ''), name: String(b.name ?? ''), input: b.input })
        break
      default:
        break
    }
  }
  return out
}

/** Blocks from a user message (string prompt or tool_result blocks). */
export function userBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  const out: ContentBlock[] = []
  for (const b of asArray(content)) {
    if (b.type === 'tool_result') {
      out.push({
        type: 'tool_result',
        toolUseId: String(b.tool_use_id ?? ''),
        text: stringifyToolResult(b.content),
        isError: Boolean(b.is_error)
      })
    } else if (b.type === 'text') {
      out.push({ type: 'text', text: String(b.text ?? '') })
    }
  }
  return out
}

export function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const block = c as Raw
        return block?.type === 'text' ? String(block.text ?? '') : JSON.stringify(block)
      })
      .join('\n')
  }
  return content == null ? '' : JSON.stringify(content)
}

/** Pull an incremental text delta out of a raw streaming event, if present. */
export function extractDelta(msg: unknown): string | null {
  const m = msg as Raw
  const event = (m.event ?? m) as Raw
  if (event?.type === 'content_block_delta') {
    const delta = event.delta as Raw | undefined
    if (delta && (delta.type === 'text_delta' || typeof delta.text === 'string')) {
      return String(delta.text ?? '')
    }
  }
  return null
}

export function isExitPlanTool(toolName: string): boolean {
  return /exit[_]?plan[_]?mode/i.test(toolName)
}
