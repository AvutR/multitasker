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
  // --- GitHub ---------------------------------------------------------------
  {
    id: 'github.push_branch',
    connector: 'github',
    direction: 'outward_post',
    label: 'GitHub · push branch',
    description: 'Push the session worktree branch (named from the Linear issue) to origin. No-op if the repo has no remote.',
    defaultPolicy: 'auto',
    enabled: true
  },
  {
    id: 'github.pr_create',
    connector: 'github',
    direction: 'outward_post',
    label: 'GitHub · create PR',
    description: 'Open a pull request on the session repo via gh. Gated — defaults to one-click approval.',
    defaultPolicy: 'approve',
    enabled: true
  },
  {
    id: 'github.pr_comment',
    connector: 'github',
    direction: 'outward_post',
    label: 'GitHub · comment on PR',
    description: 'Comment on a pull request via gh. Gated — defaults to one-click approval.',
    defaultPolicy: 'approve',
    enabled: true
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

// Read vs write is decided by the ACTION VERB in the tool name, not by nouns.
// A tool is a read iff it carries a read verb AND no write verb; everything else
// in a connector namespace is gated (default-deny) so new/renamed writes fail
// safe. Verb-based (not noun-based) so a write like `update_documents` or
// `create_comment` can't smuggle through on a read-ish noun (`documents`,
// `comments`). Tokenized on non-letters because tool names are snake/kebab.
const READ_VERBS = new Set(['search', 'read', 'list', 'get', 'fetch', 'view', 'query', 'retrieve', 'history'])
const WRITE_VERBS = new Set([
  'create', 'update', 'save', 'send', 'post', 'delete', 'remove', 'add', 'set',
  'archive', 'unarchive', 'move', 'duplicate', 'merge', 'close', 'reopen',
  'rename', 'edit', 'upload', 'assign', 'write', 'push', 'modify', 'mutate', 'schedule'
])

function isReadTool(name: string): boolean {
  const toks = name.split(/[^a-z]+/)
  if (toks.some((tok) => WRITE_VERBS.has(tok))) return false // any write verb → gated
  return toks.some((tok) => READ_VERBS.has(tok))
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
  // (Best-effort — an arbitrary shell can't be fully enumerated; the real
  // boundary is permissionMode. We gate the high-value, concrete cases.)
  if (n === 'bash' || n === 'shell' || n.endsWith('__bash')) {
    const cmd = String(toolInput?.command ?? '').toLowerCase()
    // `git push` is a real outward action with its own policy type, but the gh
    // check below misses it (no `gh` token) — gate it explicitly.
    if (/\bgit\s+push\b/.test(cmd)) return pick('github.push_branch')
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

  // Linear is the odd connector out: it namespaces its MCP tools by an opaque
  // server id and names them by noun (save_issue, save_status_update,
  // list_issues), so the tool name carries NO "linear" token and the substring
  // checks above miss it — a real policy bypass for raw Linear writes. Recognize
  // it by its issue-tracker noun signature instead (reads still pass). Scoped to
  // mcp__ tools so ordinary local tools are unaffected; Slack/Notion/GitHub are
  // already matched by name above, so only an unrecognized connector reaches here.
  if (looksLikeLinear(n)) return isReadTool(n) ? null : routeLinear(n)
  return null
}

const LINEAR_NOUNS = ['issue', 'cycle', 'initiative', 'milestone', 'status_update', 'project', 'comment', 'label']

function looksLikeLinear(n: string): boolean {
  return n.startsWith('mcp__') && LINEAR_NOUNS.some((noun) => n.includes(noun))
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
