import type { ActionTypeDef } from '@shared/types'

/**
 * The taxonomy of every external action Multitasker can take on the user's
 * behalf. Each type has a default policy that encodes the user's rule:
 * internal bookkeeping (Linear/Notion) defaults AUTO; outward posts
 * (Slack/GitHub) default APPROVE. GitHub PR actions ship disabled in v1
 * (local-commit-only constraint).
 */
export const ACTION_TYPES: ActionTypeDef[] = [
  // --- Linear (internal bookkeeping) ---------------------------------------
  {
    id: 'linear.status_update',
    connector: 'linear',
    direction: 'internal_bookkeeping',
    label: 'Linear · update issue status',
    description: 'Move an issue between states (In Progress, In Review, Done).',
    defaultPolicy: 'auto',
    enabled: true
  },
  {
    id: 'linear.issue_update',
    connector: 'linear',
    direction: 'internal_bookkeeping',
    label: 'Linear · update issue',
    description: 'Edit issue fields — assignee, estimate, project, cycle, description.',
    defaultPolicy: 'auto',
    enabled: true
  },
  {
    id: 'linear.comment',
    connector: 'linear',
    direction: 'internal_bookkeeping',
    label: 'Linear · comment on issue',
    description: 'Post a progress comment on an issue.',
    defaultPolicy: 'auto',
    enabled: true
  },
  {
    id: 'linear.weekly_project_update',
    connector: 'linear',
    direction: 'internal_bookkeeping',
    label: 'Linear · weekly project update',
    description: 'Post the weekly per-project status paragraph (where we are / at risk / next).',
    defaultPolicy: 'auto',
    enabled: true
  },
  // --- Notion (internal bookkeeping) ---------------------------------------
  {
    id: 'notion.spec_update',
    connector: 'notion',
    direction: 'internal_bookkeeping',
    label: 'Notion · update project spec',
    description: 'Update the approved project spec page in Notion.',
    defaultPolicy: 'auto',
    enabled: true
  },
  {
    id: 'notion.page_update',
    connector: 'notion',
    direction: 'internal_bookkeeping',
    label: 'Notion · update page',
    description: 'Edit, append to, or create a Notion page.',
    defaultPolicy: 'auto',
    enabled: true
  },
  // --- Slack (outward post) ------------------------------------------------
  {
    id: 'slack.standup_post',
    connector: 'slack',
    direction: 'outward_post',
    label: 'Slack · post standup',
    description: 'Post the async standup (blockers / done / pending / testable-in-staging) to the thread.',
    defaultPolicy: 'approve',
    enabled: true
  },
  {
    id: 'slack.message',
    connector: 'slack',
    direction: 'outward_post',
    label: 'Slack · send message',
    description: 'Send a message to a channel or thread.',
    defaultPolicy: 'approve',
    enabled: true
  },
  // --- GitHub (outward post) — disabled in v1 (no-remote constraint) --------
  {
    id: 'github.pr_create',
    connector: 'github',
    direction: 'outward_post',
    label: 'GitHub · create PR',
    description: 'Open a pull request. Disabled in v1 — Multitasker lands verified local commits only.',
    defaultPolicy: 'approve',
    enabled: false
  },
  {
    id: 'github.pr_comment',
    connector: 'github',
    direction: 'outward_post',
    label: 'GitHub · comment on PR',
    description: 'Comment on a pull request. Disabled in v1 — local commits only.',
    defaultPolicy: 'approve',
    enabled: false
  }
]

export const ACTION_TYPE_BY_ID: Record<string, ActionTypeDef> = Object.fromEntries(
  ACTION_TYPES.map((a) => [a.id, a])
)

export function getActionType(id: string): ActionTypeDef | undefined {
  return ACTION_TYPE_BY_ID[id]
}

export interface RawToolClassification {
  actionType: string
  def: ActionTypeDef
}

// Read-ish verbs: a connector tool whose name contains one of these tokens is
// treated as non-mutating and passes through ungated. Everything else in a
// connector namespace is gated (default-deny) so new/renamed writes fail safe.
// Tokenized on non-letters because tool names are snake/kebab (\b breaks on '_').
const READ_VERBS = new Set([
  'search', 'read', 'list', 'get', 'fetch', 'view', 'history', 'profile', 'info',
  'reactions', 'members', 'comments', 'documents', 'cycles', 'labels', 'statuses',
  'users', 'teams', 'projects', 'milestones', 'initiatives', 'diff', 'diffs'
])

function isReadTool(name: string): boolean {
  return name.split(/[^a-z]+/).some((tok) => READ_VERBS.has(tok))
}

/**
 * Safety-net classifier for path #2 (the connector gate in canUseTool). Maps a
 * raw tool call an agent tries directly onto an action type so the policy still
 * applies. DEFAULT-DENY for connector writes: any mutating/unrecognized tool in
 * a connector namespace is gated; only recognized reads pass through. Also
 * inspects Bash commands for out-of-band connector calls (gh / curl).
 */
export function classifyRawTool(
  toolName: string,
  toolInput?: Record<string, unknown>
): RawToolClassification | null {
  const n = toolName.toLowerCase()

  // Our own in-process semantic tools are governed by path #1 (propose) — never double-gate them.
  if (n.includes('multitasker')) return null

  // Bash/shell can reach connectors out-of-band; inspect the command string.
  if (n === 'bash' || n === 'shell' || n.endsWith('__bash')) {
    const cmd = String(toolInput?.command ?? '').toLowerCase()
    if (/\bgh\b/.test(cmd)) return pick('github.pr_create')
    if (/\b(curl|wget|https?)\b/.test(cmd)) {
      if (cmd.includes('slack')) return pick('slack.message')
      if (cmd.includes('linear')) return pick('linear.issue_update')
      if (cmd.includes('notion')) return pick('notion.page_update')
      if (cmd.includes('github')) return pick('github.pr_create')
    }
    return null
  }

  // Connector MCP namespaces: reads pass through, writes/unknown are gated.
  if (n.includes('slack')) return isReadTool(n) ? null : pick('slack.message')
  if (n.includes('linear')) return isReadTool(n) ? null : routeLinear(n)
  if (n.includes('notion')) return isReadTool(n) ? null : pick('notion.page_update')
  if (n.includes('github')) return isReadTool(n) ? null : pick('github.pr_create')
  return null
}

function routeLinear(n: string): RawToolClassification | null {
  if (n.includes('status_update')) return pick('linear.status_update')
  if (n.includes('comment')) return pick('linear.comment')
  return pick('linear.issue_update')
}

function pick(id: string): RawToolClassification | null {
  const def = ACTION_TYPE_BY_ID[id]
  return def ? { actionType: id, def } : null
}
