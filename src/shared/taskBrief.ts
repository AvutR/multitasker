import type { MemoryNote } from './types'

/**
 * Per-task context brief — the "min-max the context" artifact. Each session gets
 * a small, focused markdown brief that primes the agent with exactly what it
 * needs: the task, any linked tracker item, and the most relevant slice of the
 * project's accumulated memory — so it starts informed instead of rediscovering.
 * Kept deliberately short (signal over volume); the agent can `recall` for more.
 * Pure + tested.
 */
export interface TaskBriefInput {
  title: string
  issueIdentifier?: string | null
  issueUrl?: string | null
  notes: MemoryNote[]
}

const MAX_NOTES = 5
const NOTE_CLAMP = 160

export function buildTaskBrief(input: TaskBriefInput): string {
  const lines: string[] = ['# Task context', '', `**Task:** ${input.title.trim()}`]

  if (input.issueIdentifier) {
    lines.push(`**Tracker:** ${input.issueIdentifier}${input.issueUrl ? ` — ${input.issueUrl}` : ''}`)
  }

  const notes = input.notes.slice(0, MAX_NOTES)
  if (notes.length) {
    lines.push('', '## Relevant project memory')
    for (const n of notes) {
      const text = n.text.length > NOTE_CLAMP ? `${n.text.slice(0, NOTE_CLAMP)}…` : n.text
      lines.push(`- ${text}${n.tag ? ` _[${n.tag}]_` : ''}`)
    }
  }

  lines.push(
    '',
    '_Stay scoped to this task. Use the `recall` tool for more project memory, and `remember` to save anything worth keeping for later runs._'
  )
  return lines.join('\n')
}
