import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MemoryNote } from '@shared/types'

/**
 * Shared agent memory — a small, persistent, per-project note store the agents
 * write to (`remember`) and read from (`recall`). Because a conductor's
 * sub-agents inherit its working directory, they all key into the SAME memory,
 * so a sub-agent's finding is immediately recallable by the conductor and by
 * future sessions in the same repo. File-backed JSON under ~/.multitasker.
 */

const MAX_NOTES = 500

function fileFor(root: string): string {
  const dir = join(homedir(), '.multitasker', 'agent-memory')
  mkdirSync(dir, { recursive: true })
  const key = createHash('sha1').update(root).digest('hex').slice(0, 16)
  return join(dir, `${key}.json`)
}

function read(root: string): MemoryNote[] {
  try {
    const path = fileFor(root)
    if (!existsSync(path)) return []
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(raw) ? (raw as MemoryNote[]) : []
  } catch {
    return []
  }
}

function write(root: string, notes: MemoryNote[]): void {
  try {
    writeFileSync(fileFor(root), JSON.stringify(notes.slice(-MAX_NOTES)))
  } catch {
    // best-effort; memory is an optimization, never block the agent
  }
}

export function remember(root: string, text: string, tag?: string, sessionId?: string): MemoryNote {
  const note: MemoryNote = {
    id: randomUUID(),
    text: text.slice(0, 2000),
    tag: tag?.slice(0, 60),
    sessionId,
    createdAt: Date.now()
  }
  const notes = read(root)
  notes.push(note)
  write(root, notes)
  return note
}

/** Recent notes, most-recent-first; optionally filtered by a case-insensitive query. */
export function recall(root: string, query?: string, limit = 20): MemoryNote[] {
  let notes = read(root)
  if (query) {
    const q = query.toLowerCase()
    notes = notes.filter((n) => n.text.toLowerCase().includes(q) || (n.tag ?? '').toLowerCase().includes(q))
  }
  return notes.slice(-limit).reverse()
}

/** All notes for a project, most-recent-first (for the Memory tab). */
export function listMemory(root: string): MemoryNote[] {
  return read(root).reverse()
}
