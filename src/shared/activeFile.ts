import type { TranscriptMessage } from './types'
import { buildTimeline } from './transcript'

/**
 * "You are here" for an agent — which file it's reading/editing right now, derived
 * from the transcript's file tool calls. Drives the agent-presence marker that
 * hovers on the active file/folder in the Finder view. Pure + tested.
 */

export type FileAction = 'read' | 'edit' | 'write'

export interface FileTouch {
  /** Absolute path the tool reported (file_path). Relativize against the session cwd in the UI. */
  path: string
  action: FileAction
  /** The tool call is still in flight — the agent is ACTIVELY on this file. */
  running: boolean
}

const FILE_TOOLS: Record<string, FileAction> = {
  Read: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'write',
  NotebookEdit: 'edit'
}

function toolPath(input: unknown): string | null {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    const fp = o.file_path ?? o.notebook_path ?? o.path
    return typeof fp === 'string' ? fp : null
  }
  return null
}

/** The file the agent is on right now (most recent file tool), or null. */
export function activeFile(messages: TranscriptMessage[]): FileTouch | null {
  const events = buildTimeline(messages)
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind !== 'tool') continue
    const action = FILE_TOOLS[e.name]
    if (!action) continue
    const path = toolPath(e.input)
    if (path) return { path, action, running: e.status === 'running' }
  }
  return null
}

/** Recently-touched files, most-recent first, distinct — a faint trail in the tree. */
export function recentFiles(messages: TranscriptMessage[], limit = 8): FileTouch[] {
  const events = buildTimeline(messages)
  const seen = new Set<string>()
  const out: FileTouch[] = []
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i]
    if (e.kind !== 'tool') continue
    if (!FILE_TOOLS[e.name]) continue
    const path = toolPath(e.input)
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push({ path, action: FILE_TOOLS[e.name], running: e.status === 'running' })
  }
  return out
}

/** The path relative to the session's working dir (for matching tree nodes). */
export function relativeTo(cwd: string, absPath: string): string {
  const c = cwd.replace(/\/$/, '')
  if (absPath === c) return ''
  if (absPath.startsWith(c + '/')) return absPath.slice(c.length + 1)
  return absPath.split('/').pop() ?? absPath // fall back to the basename
}
