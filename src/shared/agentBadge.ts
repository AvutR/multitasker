import type { SessionInfo } from './types'

/**
 * Compact, scannable agent identity: a SHORT label (the Linear number, else an
 * acronym of the task) and a deterministic COLOR keyed to the task — so a board
 * of a dozen agents reads at a glance, color-coded by what each is working on.
 * Pure + deterministic.
 */

// A spread of distinct, legible hues (avoids the status colors so the two
// signals don't collide). Indexed by a hash of the task key.
const PALETTE = [
  '#6ea8fe', '#5bd4a4', '#f5a623', '#b794f6', '#4fd1c5', '#f687b3',
  '#63b3ed', '#9ae6b4', '#f6ad55', '#d6bcfa', '#76e4f7', '#fc8181'
]

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'my', 'this', 'that', 'is', 'are', 'fix', 'add', 'update'])

/** A tracker identifier embedded in a title, e.g. "WEB-4849" / "ENG-12". */
export function extractIssueId(title: string | null | undefined): string | null {
  return title?.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1] ?? null
}

/** The stable key a session's color + label derive from (so siblings on one
 *  issue share a color): the tracker id if present, else the title, else the id. */
export function taskKey(s: Pick<SessionInfo, 'id' | 'title' | 'linearIssueId'>): string {
  return extractIssueId(s.title) ?? s.linearIssueId ?? s.title ?? s.id
}

function hash(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** A deterministic color for the task (same key → same color, always). */
export function taskColor(s: Pick<SessionInfo, 'id' | 'title' | 'linearIssueId'>): string {
  return PALETTE[hash(taskKey(s)) % PALETTE.length]
}

/**
 * A short, tag-sized label for the agent: the tracker number if the title carries
 * one (WEB-4849), else an acronym of the meaningful words (skipping stopwords),
 * else the first chunk of a single word. Always ≤8 chars, uppercased.
 */
export function shortLabel(s: Pick<SessionInfo, 'id' | 'title'>): string {
  const id = extractIssueId(s.title)
  if (id) return id
  const title = (s.title ?? '').trim()
  if (!title) return '·'
  const words = title.split(/[^A-Za-z0-9]+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
  if (words.length === 0) return title.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '·'
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase()
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase()
}
