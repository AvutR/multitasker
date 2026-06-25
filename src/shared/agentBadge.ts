import type { SessionInfo } from './types'

/**
 * Compact, scannable agent identity: a SHORT but MEANINGFUL label (the tracker
 * number, else the first meaningful words of the task) and a deterministic COLOR
 * keyed to the task — so a board of a dozen agents reads at a glance, color-coded
 * by what each is working on. Pure + deterministic.
 */

// A spread of distinct, legible hues (avoids the status colors so the two
// signals don't collide). Indexed by a hash of the task key.
const PALETTE = [
  '#6ea8fe', '#5bd4a4', '#f5a623', '#b794f6', '#4fd1c5', '#f687b3',
  '#63b3ed', '#9ae6b4', '#f6ad55', '#d6bcfa', '#76e4f7', '#fc8181'
]

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'my', 'this', 'that', 'is', 'are', 'fix', 'add', 'update'])

/** A tracker identifier embedded in a title, e.g. "ENG-1234" / "PROJ-12". */
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

const LABEL_MAX = 16

/**
 * A short but MEANINGFUL tag for the agent: the tracker number if the title
 * carries one (ENG-1234), else the first meaningful words of the title (skipping
 * leading filler like "Fix"/"the"), trimmed to ~16 chars. Kept readable — NOT an
 * acronym — so the tag still says what the task is at a glance.
 */
export function shortLabel(s: Pick<SessionInfo, 'id' | 'title'>): string {
  const id = extractIssueId(s.title)
  if (id) return id
  const title = (s.title ?? '').replace(/\s+/g, ' ').trim()
  if (!title) return '·'
  const trim = (w: string) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
  const words = title.split(' ').map(trim).filter(Boolean)
  if (words.length === 0) return '·'
  // Skip leading filler so the label starts on a meaningful word — but never skip
  // past the last word (a title that's ALL stopwords still gets a label).
  let i = 0
  while (i < words.length - 1 && STOPWORDS.has(words[i].toLowerCase())) i++
  const rest = words.slice(i)
  // Accumulate whole words up to the budget; always keep at least the first.
  let label = rest[0]
  for (let k = 1; k < rest.length; k++) {
    const next = `${label} ${rest[k]}`
    if (next.length > LABEL_MAX) break
    label = next
  }
  if (label.length > LABEL_MAX) label = `${label.slice(0, LABEL_MAX - 1).trimEnd()}…`
  return label
}
