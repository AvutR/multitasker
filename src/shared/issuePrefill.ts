import type { SpawnRequest, TrackerItem } from './types'

/**
 * Turn a tracker issue into a New-Session PRE-FILL — not a spawn. Starting work
 * from an issue should open the composer primed with the issue's context (so you
 * don't retype it) and its branch/links, then wait for you to review, add
 * steering, and hit Spawn. Nothing runs until the user does. Pure + tested.
 */
export function issueToPrefill(issue: TrackerItem): Partial<SpawnRequest> {
  return {
    prompt: `${issue.identifier} — ${issue.title}\n\n${issue.description ?? ''}`.trim(),
    presetId: 'build',
    title: `${issue.identifier} ${issue.title}`.trim().slice(0, 80),
    linearIssueId: issue.id,
    notionPageId: extractNotionUrl(issue.description),
    branchName: issue.branchName,
    useWorktree: true
  }
}

/** Pull a Notion page URL out of an issue description so the linked spec can be
 *  kept current too. */
export function extractNotionUrl(text?: string): string | undefined {
  if (!text) return undefined
  const m = text.match(/https?:\/\/(?:www\.)?notion\.so\/[^\s)]+/i)
  return m?.[0]
}
