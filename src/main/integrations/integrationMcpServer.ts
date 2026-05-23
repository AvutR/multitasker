import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ActionRecord } from '@shared/types'
import type { ActionService } from './ActionService'

/**
 * Path #1 — the high-level, semantic integration tools the spawned agents call
 * (e.g. "post_standup", "update_linear_status"). Each routes through the policy
 * engine; the agent never touches a raw connector directly on this path.
 *
 * Created per session so the tool handlers can attribute actions to the right
 * session. Runs in-process within the orchestrator (Electron main).
 */
export function createIntegrationMcpServer(actionService: ActionService, sessionId: string) {
  const propose = async (actionType: string, summary: string, payload: unknown) => {
    const rec = await actionService.propose({ sessionId, actionType, summary, payload })
    return toolResult(rec)
  }

  return createSdkMcpServer({
    name: 'multitasker-integrations',
    version: '0.1.0',
    tools: [
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
      )
    ]
  })
}

function toolResult(rec: ActionRecord) {
  return { content: [{ type: 'text' as const, text: renderOutcome(rec) }] }
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
