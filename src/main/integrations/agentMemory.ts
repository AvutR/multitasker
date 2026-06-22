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

// Note: writes are atomic without a lock — `remember` is fully synchronous
// (read→push→writeFileSync, no await) and the MCP server runs in the single
// Electron-main event loop, so two concurrent `remember` calls can't interleave
// their read-modify-write. (Sub-agents are separate subprocesses, but their tool
// calls all funnel through this one in-process server.)

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on',
  'at', 'for', 'with', 'by', 'from', 'as', 'it', 'this', 'that', 'these', 'those', 'we', 'you',
  'they', 'can', 'will', 'should', 'into', 'its', 'has', 'have'
])

/** Lowercase content tokens (≥2 chars, no stopwords) for overlap scoring. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

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
    writeFileSync(fileFor(root), JSON.stringify(capNotes(notes)))
  } catch {
    // best-effort; memory is an optimization, never block the agent
  }
}

/** Cap the store WITHOUT blindly FIFO-evicting durable findings: keep every
 *  tagged note (decisions/gotchas/arch) and fill the rest of the budget with the
 *  newest untagged chatter. So a repo that accumulates >500 notes doesn't lose
 *  "auth lives in X" to recent noise and force agents to re-discover it. */
function capNotes(notes: MemoryNote[]): MemoryNote[] {
  if (notes.length <= MAX_NOTES) return notes
  const tagged = notes.filter((n) => n.tag)
  if (tagged.length >= MAX_NOTES) return tagged.slice(-MAX_NOTES)
  const keepUntagged = new Set(notes.filter((n) => !n.tag).slice(-(MAX_NOTES - tagged.length)))
  return notes.filter((n) => n.tag || keepUntagged.has(n)) // preserves chronological order
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
  // Dedup: collapse an exact-duplicate finding so a conductor and its sub-agents
  // all writing the same note don't crowd the cap (returns the note either way).
  const isDup = notes.some((n) => n.text === note.text && (n.tag ?? '') === (note.tag ?? ''))
  if (!isDup) {
    notes.push(note)
    write(root, notes)
  }
  return note
}

/**
 * Recall notes for a project. With a query, rank by TOKEN OVERLAP (how many
 * distinct query words appear in the note's text/tag), most-relevant first,
 * recency breaking ties — far less brittle than the old whole-query substring
 * match (which missed "auth lives in X" for a query of "authorization middleware").
 * A query that overlaps nothing returns []. With no query, returns most-recent-first.
 */
export function recall(root: string, query?: string, limit = 20): MemoryNote[] {
  const notes = read(root)
  const q = query?.trim()
  if (!q) return notes.slice(-limit).reverse()
  const qTokens = new Set(tokenize(q))
  if (qTokens.size === 0) return notes.slice(-limit).reverse()
  return notes
    .map((n) => {
      const hay = new Set(tokenize(`${n.text} ${n.tag ?? ''}`))
      let score = 0
      for (const t of qTokens) if (hay.has(t)) score++
      return { n, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.n.createdAt - a.n.createdAt)
    .slice(0, limit)
    .map((x) => x.n)
}

/** All notes for a project, most-recent-first (for the Memory tab). */
export function listMemory(root: string): MemoryNote[] {
  return read(root).reverse()
}
