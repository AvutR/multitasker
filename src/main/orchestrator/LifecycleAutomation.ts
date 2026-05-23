import type { SessionInfo, SessionStatus } from '@shared/types'
import type { EventBus } from '../events'
import type { ActionService, ProposeInput } from '../integrations/ActionService'

/** Per-session links to the work items the pipeline should keep updated. */
export interface SessionAutomationLinks {
  linearIssueId: string | null
  notionPageId: string | null
  slackChannel: string | null
  autoUpdates: boolean
}

/**
 * Turns session lifecycle transitions into automatic, policy-gated updates on
 * other applications (Raising the Bar: "no excuse for stale Linear"). Decoupled
 * from the orchestrator — it subscribes to session:updated, fires once per
 * status per session, and routes every action through ActionService so the
 * AUTO/APPROVE/OFF policy and dry-run still apply.
 */
export class LifecycleAutomation {
  private readonly links = new Map<string, SessionAutomationLinks>()
  private readonly fired = new Map<string, Set<SessionStatus>>()

  constructor(bus: EventBus, private readonly actions: ActionService) {
    bus.onEvent((event) => {
      if (event.channel === 'session:updated') void this.onSession(event.payload)
    })
  }

  register(sessionId: string, links: SessionAutomationLinks): void {
    this.links.set(sessionId, links)
  }

  private async onSession(info: SessionInfo): Promise<void> {
    const links = this.links.get(info.id)
    if (!links || !links.autoUpdates) return

    const seen = this.fired.get(info.id) ?? new Set<SessionStatus>()
    if (seen.has(info.status)) return // each transition fires at most once
    seen.add(info.status)
    this.fired.set(info.id, seen)

    for (const action of actionsForTransition(info, links)) {
      await this.actions.propose(action)
    }
  }
}

function actionsForTransition(info: SessionInfo, links: SessionAutomationLinks): ProposeInput[] {
  const out: ProposeInput[] = []
  const sid = info.id
  switch (info.status) {
    case 'running':
      if (links.linearIssueId) {
        out.push({
          sessionId: sid,
          actionType: 'linear.status_update',
          summary: `${info.title} → In Progress`,
          payload: { issueId: links.linearIssueId, status: 'In Progress' }
        })
      }
      break
    case 'awaiting_plan_approval':
      if (links.linearIssueId) {
        out.push({
          sessionId: sid,
          actionType: 'linear.comment',
          summary: `Plan ready · ${info.title}`,
          payload: { issueId: links.linearIssueId, body: `Plan ready for review in Multitasker for "${info.title}".` }
        })
      }
      break
    case 'landed':
      if (links.linearIssueId) {
        out.push({
          sessionId: sid,
          actionType: 'linear.status_update',
          summary: `${info.title} → In Review`,
          payload: { issueId: links.linearIssueId, status: 'In Review' }
        })
      }
      if (links.notionPageId) {
        out.push({
          sessionId: sid,
          actionType: 'notion.spec_update',
          summary: `Spec update · ${info.title}`,
          payload: { pageId: links.notionPageId, content: `"${info.title}" landed a verified local commit via Multitasker.` }
        })
      }
      if (links.slackChannel) {
        out.push({
          sessionId: sid,
          actionType: 'slack.message',
          summary: `Landed · ${info.title}`,
          payload: { channel: links.slackChannel, text: `✅ *${info.title}* landed (local commit) — testable in staging.` }
        })
      }
      break
    case 'error':
      if (links.linearIssueId) {
        out.push({
          sessionId: sid,
          actionType: 'linear.comment',
          summary: `Blocked · ${info.title}`,
          payload: { issueId: links.linearIssueId, body: `Blocked in Multitasker: ${info.error ?? 'unknown error'}` }
        })
      }
      break
    default:
      break
  }
  return out
}
