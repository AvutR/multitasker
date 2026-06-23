import { describe, expect, it } from 'vitest'
import { parseEngineLine } from '../../src/shared/engineParse'

// Real lines captured from `cursor-agent -p ... --output-format stream-json`.
const CURSOR = {
  system: '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/tmp/x","session_id":"17b68f08-1826-4cc1-b6f7-337573344bb8","model":"Codex 5.3","permissionMode":"default"}',
  user: '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"do the thing"}]},"session_id":"17b68f08"}',
  assistant: '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"PONG"}]},"session_id":"17b68f08"}',
  result: '{"type":"result","subtype":"success","duration_ms":5048,"is_error":false,"result":"PONG","session_id":"17b68f08","usage":{"inputTokens":13916,"outputTokens":6,"cacheReadTokens":8576,"cacheWriteTokens":0}}'
}

describe('parseEngineLine — claude-json (cursor-agent / Claude SDK)', () => {
  it('captures the session id + model from the system init', () => {
    const e = parseEngineLine('claude-json', CURSOR.system)!
    expect(e.kind).toBe('system')
    expect(e.sessionId).toBe('17b68f08-1826-4cc1-b6f7-337573344bb8')
    expect(e.model).toBe('Codex 5.3') // cursor can pick a non-Anthropic model
  })

  it('extracts assistant + user text from the content array', () => {
    expect(parseEngineLine('claude-json', CURSOR.assistant)).toMatchObject({ kind: 'assistant', text: 'PONG' })
    expect(parseEngineLine('claude-json', CURSOR.user)).toMatchObject({ kind: 'user', text: 'do the thing' })
  })

  it('reads cost + usage from result, accepting camelCase (cursor) and snake_case (SDK)', () => {
    const cursor = parseEngineLine('claude-json', CURSOR.result)!
    expect(cursor.kind).toBe('result')
    expect(cursor.isError).toBe(false)
    expect(cursor.outputTokens).toBe(6)
    expect(cursor.cachedInputTokens).toBe(8576) // cacheReadTokens
    // input folds in cache read + write: 13916 + 8576 + 0
    expect(cursor.inputTokens).toBe(13916 + 8576)

    const sdkStyle = parseEngineLine(
      'claude-json',
      '{"type":"result","subtype":"success","total_cost_usd":0.02,"usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":50}}'
    )!
    expect(sdkStyle.costUsd).toBe(0.02)
    expect(sdkStyle.cachedInputTokens).toBe(50)
    expect(sdkStyle.inputTokens).toBe(150)
  })

  it('ignores blank lines and unknown event types', () => {
    expect(parseEngineLine('claude-json', '   ')).toBeNull()
    expect(parseEngineLine('claude-json', '{"type":"stream_event","x":1}')).toMatchObject({ kind: 'ignore' })
  })
})

describe('parseEngineLine — codex-jsonl', () => {
  it('maps thread/turn/item/error events', () => {
    expect(parseEngineLine('codex-jsonl', '{"type":"thread.started","thread_id":"019ef264"}')).toMatchObject({ kind: 'system', sessionId: '019ef264' })
    expect(parseEngineLine('codex-jsonl', '{"type":"item.completed","item":{"text":"done editing foo.ts"}}')).toMatchObject({ kind: 'assistant', text: 'done editing foo.ts' })
    expect(parseEngineLine('codex-jsonl', '{"type":"turn.completed"}')).toMatchObject({ kind: 'result', isError: false })
    const err = parseEngineLine('codex-jsonl', '{"type":"error","message":"boom"}')!
    expect(err.kind).toBe('error')
    expect(err.isError).toBe(true)
    expect(err.text).toContain('boom')
  })
})

describe('parseEngineLine — text (gemini/aider/unknown)', () => {
  it('surfaces each line as assistant text', () => {
    expect(parseEngineLine('text', 'Edited 3 files.')).toMatchObject({ kind: 'assistant', text: 'Edited 3 files.' })
    expect(parseEngineLine('text', '')).toBeNull()
  })

  it('falls back to text for non-JSON on a JSON protocol (interleaved logs)', () => {
    expect(parseEngineLine('claude-json', 'WARN: rate limited, retrying')).toMatchObject({ kind: 'assistant', text: 'WARN: rate limited, retrying' })
  })
})
