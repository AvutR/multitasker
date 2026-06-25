import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decaySkills, dedupeSkills, keywordsOf, rankSkills, type BrainSkill, type BrainStats, type SkillKind } from '@shared/brain'

/**
 * The central brain's persistence — ONE file holding every learned skill, each
 * tagged with its scope (project root, or 'global'). Distilled, deduped, and
 * decayed on write so it stays small; recall bumps a skill's reuse so the useful
 * ones rise and the unused ones fade.
 *
 * Synchronous read-modify-write in the single Electron-main loop (same atomicity
 * note as agentMemory) — concurrent learns can't interleave.
 */

const MAX_SKILLS = 500
const STALE_DAYS = 45

function file(): string {
  const dir = join(homedir(), '.multitasker')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'brain.json')
}

const KINDS = new Set<SkillKind>(['skill', 'gotcha', 'map', 'pattern'])

function read(): BrainSkill[] {
  try {
    const path = file()
    if (!existsSync(path)) return []
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(raw)) return []
    // Coerce an unknown `kind` (e.g. a hand-tampered file) to a valid value so
    // downstream tag/colour lookups never index on attacker-chosen keys.
    return (raw as BrainSkill[]).map((s) => (KINDS.has(s.kind) ? s : { ...s, kind: 'skill' }))
  } catch {
    return []
  }
}

function write(skills: BrainSkill[]): void {
  try {
    writeFileSync(file(), JSON.stringify(skills))
  } catch {
    // best-effort; the brain is an optimization, never block the agent
  }
}

/** Record a learned skill. Deduped + decayed on write so the brain stays sharp. */
export function learn(
  scope: string,
  input: { title: string; body: string; kind?: SkillKind; keywords?: string[]; sessionId?: string },
  now = Date.now()
): BrainSkill {
  const skill: BrainSkill = {
    id: randomUUID(),
    scope: scope || 'global',
    kind: input.kind ?? 'skill',
    title: input.title.slice(0, 120).trim(),
    body: input.body.slice(0, 1200).trim(),
    keywords: (input.keywords?.length ? input.keywords : keywordsOf(`${input.title} ${input.body}`)).slice(0, 16),
    useCount: 0,
    createdAt: now,
    lastUsedAt: now,
    sourceSessionId: input.sessionId
  }
  if (!skill.title || !skill.body) return skill // nothing worth keeping
  const next = decaySkills(dedupeSkills([...read(), skill]), now, { maxCount: MAX_SKILLS, staleDays: STALE_DAYS })
  write(next)
  const key = skill.title.toLowerCase()
  return next.find((s) => s.scope === skill.scope && s.title.toLowerCase() === key) ?? skill
}

/** The most relevant skills for a task (this project's + global), bumping their
 *  reuse so used skills rank up. Token-budgeted by `limit`. */
export function recallSkills(scope: string, query: string, limit = 5, now = Date.now()): BrainSkill[] {
  const all = read()
  const inScope = all.filter((s) => s.scope === scope || s.scope === 'global')
  const top = rankSkills(inScope, query, limit, now)
  if (top.length) {
    const ids = new Set(top.map((s) => s.id))
    write(all.map((s) => (ids.has(s.id) ? { ...s, useCount: s.useCount + 1, lastUsedAt: now } : s)))
  }
  return top
}

/** All skills (optionally scoped to a project + global), most-recently-used first. */
export function listSkills(scope?: string): BrainSkill[] {
  const all = read()
  return (scope ? all.filter((s) => s.scope === scope || s.scope === 'global') : all).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
}

export function deleteSkill(id: string): void {
  write(read().filter((s) => s.id !== id))
}

export function setSkillPinned(id: string, pinned: boolean): void {
  write(read().map((s) => (s.id === id ? { ...s, pinned } : s)))
}

/** A small summary for the Brain panel — size + how much reuse it's earned. */
export function brainStats(scope?: string): BrainStats {
  const skills = listSkills(scope)
  return { total: skills.length, reuse: skills.reduce((n, s) => n + s.useCount, 0), pinned: skills.filter((s) => s.pinned).length }
}
