import { describe, expect, it } from 'vitest'
import type { TranscriptMessage } from '@shared/types'
import { buildTimeline, summarizeTool } from '../../src/shared/transcript'

let seq = 0
function msg(kind: TranscriptMessage['kind'], blocks: TranscriptMessage['blocks'], extra: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return { id: `m${seq++}`, sessionId: 's', kind, blocks, createdAt: seq, ...extra }
}

describe('buildTimeline — pairs tool calls with their results', () => {
  it('pairs a tool_use with its later tool_result by id and marks status', () => {
    const tl = buildTimeline([
      msg('assistant', [
        { type: 'text', text: 'Let me check the file.' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/src/a.ts' } }
      ]),
      msg('user', [{ type: 'tool_result', toolUseId: 't1', text: 'file contents', isError: false }])
    ])
    expect(tl.map((e) => e.kind)).toEqual(['assistant', 'tool'])
    const tool = tl[1]
    expect(tool).toMatchObject({ kind: 'tool', id: 't1', name: 'Read', status: 'ok', result: 'file contents' })
  })

  it('leaves an unresolved tool_use as running', () => {
    const tl = buildTimeline([msg('assistant', [{ type: 'tool_use', id: 't9', name: 'Bash', input: { command: 'npm test' } }])])
    expect(tl).toHaveLength(1)
    expect(tl[0]).toMatchObject({ kind: 'tool', status: 'running' })
  })

  it('marks an error result as error', () => {
    const tl = buildTimeline([
      msg('assistant', [{ type: 'tool_use', id: 't2', name: 'Bash', input: {} }]),
      msg('user', [{ type: 'tool_result', toolUseId: 't2', text: 'boom', isError: true }])
    ])
    expect(tl[0]).toMatchObject({ status: 'error', result: 'boom' })
  })

  it('keeps real user text but drops empty blocks', () => {
    const tl = buildTimeline([
      msg('user', [{ type: 'text', text: 'do the thing' }]),
      msg('assistant', [{ type: 'text', text: '' }, { type: 'text', text: 'on it' }])
    ])
    expect(tl.map((e) => e.kind)).toEqual(['user', 'assistant'])
    expect(tl[0]).toMatchObject({ kind: 'user', text: 'do the thing' })
  })

  it('collapses a result message into one result event with cost', () => {
    const tl = buildTimeline([msg('result', [{ type: 'text', text: '(turn complete)' }], { costUsd: 0.012 })])
    expect(tl).toHaveLength(1)
    expect(tl[0]).toMatchObject({ kind: 'result', costUsd: 0.012 })
  })
})

describe('summarizeTool — concise human label for an action', () => {
  it('summarizes common tools by their key argument', () => {
    expect(summarizeTool('Bash', { command: 'npm run build' })).toEqual({ label: 'Run', detail: 'npm run build' })
    expect(summarizeTool('Read', { file_path: '/repo/src/main/index.ts' })).toEqual({ label: 'Read', detail: 'main/index.ts' })
    expect(summarizeTool('Grep', { pattern: 'TODO' })).toEqual({ label: 'Search', detail: 'TODO' })
  })

  it('strips the MCP server namespace from connector tools', () => {
    const s = summarizeTool('mcp__abc123__save_issue', { issueId: 'ENG-1' })
    expect(s.label).toBe('save_issue')
    expect(s.detail).toBe('ENG-1')
  })
})
