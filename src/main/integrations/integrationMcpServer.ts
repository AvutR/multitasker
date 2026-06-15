import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ActionRecord } from '@shared/types'
import type { ActionService } from './ActionService'
import { recall, remember } from './agentMemory'

export interface IntegrationServerOptions {
  orchestration?: Orchestration
  /** Project root used as the shared agent-memory key (the session's cwd). */
  memoryRoot?: string
}

/** Lets a conductor session fan work out to cheaper, parallel sub-agents.
 *  Injected by SessionManager so the MCP layer has no orchestrator dependency. */
export interface Orchestration {
  delegate: (parentId: string, input: { title?: string; prompt: string; model?: string; kind?: string }) => Promise<{ id: string; title: string; status: string }>
  listChildren: (parentId: string) => { id: string; title: string; status: string; summary: string }[]
}

/**
 * Path #1 — the high-level, semantic integration tools the spawned agents call
 * (e.g. "post_standup", "update_linear_status"). Each routes through the policy
 * engine; the agent never touches a raw connector directly on this path.
 *
 * Created per session so the tool handlers can attribute actions to the right
 * session. Runs in-process within the orchestrator (Electron main).
 */
export function createIntegrationMcpServer(actionService: ActionService, sessionId: string, opts: IntegrationServerOptions = {}) {
  const { orchestration, memoryRoot } = opts
  const propose = async (actionType: string, summary: string, payload: unknown) => {
    const rec = await actionService.propose({ sessionId, actionType, summary, payload })
    return toolResult(rec)
  }

  const memoryTools = memoryRoot
    ? [
        tool(
          'remember',
          "Save a short note to this project's shared agent memory so you, your sub-agents, and future sessions in this repo can recall it. Use for decisions made, gotchas found, where things live, and what a delegated sub-task concluded.",
          { text: z.string().describe('The note to remember'), tag: z.string().optional().describe('Optional short tag to group/filter by') },
          async (args) => {
            const n = remember(memoryRoot, args.text, args.tag, sessionId)
            return text(`Remembered (${n.id.slice(0, 8)}).`)
          }
        ),
        tool(
          'recall',
          "Recall notes from this project's shared agent memory (written by you, your sub-agents, or earlier sessions). Optionally filter by a query. Call this before starting work to reuse prior knowledge instead of rediscovering it.",
          { query: z.string().optional().describe('Optional case-insensitive filter') },
          async (args) => {
            const notes = recall(memoryRoot, args.query)
            return text(notes.length ? notes.map((n) => `• ${n.text}${n.tag ? ` [${n.tag}]` : ''}`).join('\n') : 'No memory yet for this project.')
          }
        )
      ]
    : []

  const orchestrationTools = orchestration
    ? [
        tool(
          'delegate_subtask',
          'Delegate ONE focused, independent piece of work to a parallel sub-agent in this same repo. Set `kind` to the type of work and the right cheap model is chosen for you (research/docs → Haiku, implement/test/review → Sonnet, orchestrate → Opus). Use this to fan out decomposed work — call it once per independent sub-task. Returns the sub-agent id.',
          {
            title: z.string().describe('Short title for the sub-task'),
            prompt: z.string().describe('The full, self-contained instruction for the sub-agent'),
            kind: z.enum(['research', 'docs', 'implement', 'test', 'review', 'orchestrate']).optional().describe('The kind of work — picks the cheapest capable model tier. Omit to auto-detect from the prompt.'),
            model: z.string().optional().describe('Model id to hard-override the tier (rarely needed)')
          },
          async (args) => {
            const r = await orchestration.delegate(sessionId, args)
            return text(`Delegated "${r.title}" → sub-agent ${r.id} (${r.status}). It runs in parallel on a cheaper model; call list_subtasks to check on it before you synthesize.`)
          }
        ),
        tool(
          'list_subtasks',
          'List the sub-agents you have delegated, with their current status and latest output, so you can coordinate, wait, or synthesize their results.',
          {},
          async () => text(JSON.stringify(orchestration.listChildren(sessionId), null, 2))
        )
      ]
    : []

  return createSdkMcpServer({
    name: 'multitasker-integrations',
    version: '0.1.0',
    tools: [
      ...memoryTools,
      ...orchestrationTools,
      tool(
        'post_standup',
        'Post an async project standup to Slack (blockers / done / pending / testable-in-staging). Routes through the Multitasker policy engine — may fire, queue for one-click approval, or dry-run.',
        {
          project: z.string().describe('Project or workstream name'),
          blockers: z.string().describe('Current blockers, or "none"'),
          done: z.string().describe('What is done'),
          pending: z.string().describe('What is pending / in progress'),
          testable: z.string().describe('What can be tested in staging'),
          channel: z.string().optional().describe('Slack channel/thread; omit for the default standup thread')
        },
        async (args) => propose('slack.standup_post', `Standup · ${args.project}`, args)
      ),
      tool(
        'send_slack_message',
        'Send a message to a Slack channel or thread. Routes through the policy engine.',
        {
          channel: z.string().describe('Channel name/id or thread'),
          text: z.string().describe('Message text (markdown)')
        },
        async (args) => propose('slack.message', `Slack → ${args.channel}`, args)
      ),
      tool(
        'update_linear_status',
        'Move a Linear issue to a new status (In Progress, In Review, Done). Routes through the policy engine.',
        {
          issueId: z.string().describe('Linear issue identifier, e.g. ENG-1234'),
          status: z.string().describe('Target status')
        },
        async (args) => propose('linear.status_update', `Linear ${args.issueId} → ${args.status}`, args)
      ),
      tool(
        'comment_on_linear_issue',
        'Post a progress comment on a Linear issue.',
        {
          issueId: z.string(),
          body: z.string().describe('Comment body (markdown)')
        },
        async (args) => propose('linear.comment', `Comment · ${args.issueId}`, args)
      ),
      tool(
        'update_linear_issue',
        'Update fields on a Linear issue (assignee, estimate, project, cycle, description).',
        {
          issueId: z.string(),
          fields: z.record(z.string(), z.any()).describe('Field name → new value')
        },
        async (args) => propose('linear.issue_update', `Update ${args.issueId}`, args)
      ),
      tool(
        'post_weekly_project_update',
        'Post the weekly per-project status update to Linear (where we are / what is at risk / what is next).',
        {
          projectId: z.string(),
          where: z.string().describe('Where the project is'),
          atRisk: z.string().describe('What is at risk'),
          next: z.string().describe('What is next')
        },
        async (args) => propose('linear.weekly_project_update', `Weekly update · ${args.projectId}`, args)
      ),
      tool(
        'update_notion_spec',
        'Update the approved project spec page in Notion.',
        {
          pageId: z.string().describe('Notion page id or URL'),
          content: z.string().describe('Markdown content to set or append')
        },
        async (args) => propose('notion.spec_update', `Notion spec · ${args.pageId}`, args)
      ),
      tool(
        'update_notion_page',
        'Edit, append to, or create a Notion page.',
        {
          pageId: z.string(),
          content: z.string()
        },
        async (args) => propose('notion.page_update', `Notion page · ${args.pageId}`, args)
      ),
      tool(
        'open_pr',
        'Open a GitHub pull request for the current session branch. Routes through the policy engine (defaults to one-click approval); runs in the session repo.',
        {
          title: z.string().describe('PR title'),
          body: z.string().optional().describe('PR body (markdown)'),
          base: z.string().optional().describe('Base branch to merge into; omit for the repo default')
        },
        async (args) => propose('github.pr_create', `Open PR · ${args.title}`, args)
      ),
      tool(
        'comment_on_pr',
        'Comment on a GitHub pull request. Routes through the policy engine.',
        {
          body: z.string().describe('Comment body (markdown)'),
          pr: z.string().optional().describe('PR number/URL/branch; omit to target the current branch’s PR')
        },
        async (args) => propose('github.pr_comment', 'PR comment', args)
      )
    ]
  })
}

function toolResult(rec: ActionRecord) {
  return { content: [{ type: 'text' as const, text: renderOutcome(rec) }] }
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] }
}

function renderOutcome(rec: ActionRecord): string {
  switch (rec.status) {
    case 'fired':
      return `✅ ${rec.summary} — executed.`
    case 'pending':
      return `⏳ ${rec.summary} — queued for one-click approval in Multitasker. Continue with other work; it fires once a human approves.`
    case 'dry_run':
      return `🧪 [dry-run] ${rec.summary} — intent recorded, connector NOT called (global dry-run is ON).`
    case 'dropped':
      return `🚫 ${rec.summary} — not sent (policy OFF or action disabled in this build).`
    case 'failed':
      return `❌ ${rec.summary} — execution failed: ${rec.error ?? 'unknown error'}.`
    default:
      return `${rec.summary} — status ${rec.status}.`
  }
}
