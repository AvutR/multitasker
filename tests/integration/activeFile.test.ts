import { describe, expect, it } from 'vitest'
import type { ContentBlock, TranscriptMessage } from '@shared/types'
import { activeFile, recentFiles, relativeTo } from '../../src/shared/activeFile'

let seq = 0
function msg(kind: TranscriptMessage['kind'], blocks: ContentBlock[]): TranscriptMessage {
  return { id: `m${seq++}`, sessionId: 's', kind, blocks, createdAt: seq }
}
const use = (id: string, name: string, file: string): ContentBlock => ({ type: 'tool_use', id, name, input: { file_path: file } })
const result = (toolUseId: string): ContentBlock => ({ type: 'tool_result', toolUseId, text: 'ok', isError: false })

describe('activeFile — where the agent is in the tree', () => {
  it('returns the most recent file tool, with running = in-flight', () => {
    const messages = [
      msg('assistant', [use('t1', 'Read', '/repo/src/foo.ts')]),
      msg('user', [result('t1')]),
      msg('assistant', [use('t2', 'Edit', '/repo/src/bar.ts')]) // no result yet → running
    ]
    expect(activeFile(messages)).toEqual({ path: '/repo/src/bar.ts', action: 'edit', running: true })
  })

  it('a completed read is not "running"', () => {
    const messages = [msg('assistant', [use('t1', 'Read', '/repo/a.ts')]), msg('user', [result('t1')])]
    expect(activeFile(messages)).toEqual({ path: '/repo/a.ts', action: 'read', running: false })
  })

  it('ignores non-file tools (Bash/Grep)', () => {
    const messages = [
      msg('assistant', [use('t1', 'Write', '/repo/x.ts')]),
      msg('user', [result('t1')]),
      msg('assistant', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }])
    ]
    expect(activeFile(messages)?.path).toBe('/repo/x.ts') // the Bash call doesn't move the marker
  })

  it('recentFiles is distinct, most-recent-first', () => {
    const messages = [
      msg('assistant', [use('t1', 'Read', '/repo/a.ts')]),
      msg('assistant', [use('t2', 'Read', '/repo/b.ts')]),
      msg('assistant', [use('t3', 'Edit', '/repo/a.ts')]) // a.ts again — collapses to one, newest position
    ]
    expect(recentFiles(messages).map((f) => f.path)).toEqual(['/repo/a.ts', '/repo/b.ts'])
  })

  it('relativeTo strips the cwd, else falls back to the basename', () => {
    expect(relativeTo('/repo', '/repo/src/foo.ts')).toBe('src/foo.ts')
    expect(relativeTo('/repo/', '/repo/x.ts')).toBe('x.ts')
    expect(relativeTo('/repo', '/elsewhere/y.ts')).toBe('y.ts')
  })
})
