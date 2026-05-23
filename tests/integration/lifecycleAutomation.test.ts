import { describe, expect, it } from 'vitest'
import type { SessionInfo } from '@shared/types'
import { openDatabase } from '../../src/main/db/database'
import { createRepositories } from '../../src/main/db/repositories'
import { EventBus } from '../../src/main/events'
import { ActionService, seedDefaultPolicies } from '../../src/main/integrations/ActionService'
import { LifecycleAutomation } from '../../src/main/orchestrator/LifecycleAutomation'

function setup() {
  const db = openDatabase(':memory:')
  const repos = createRepositories(db)
  seedDefaultPolicies(repos)
  repos.settings.set({ dryRun: false }) // so internal AUTO actions actually fire
  const bus = new EventBus()
  const actions = new ActionService(repos, bus, { execute: async () => ({ ok: true }) })
  const auto = new LifecycleAutomation(bus, actions)
  return { bus, actions, auto }
}

function info(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: 's1',
    sdkSessionId: null,
    title: 'CSV export',
    model: null,
    cwd: '/x',
    repoId: null,
    branch: null,
    worktreePath: null,
    status: 'queued',
    permissionMode: 'default',
    presetId: 'build',
    totalCostUsd: 0,
    numTurns: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
    ...over
  }
}

const flush = () => new Promise((r) => setTimeout(r, 10))

describe('LifecycleAutomation — automatic pipeline updates on other apps', () => {
  it('sets Linear In Progress when a linked session starts running', async () => {
    const { bus, actions, auto } = setup()
    auto.register('s1', { linearIssueId: 'ENG-1', notionPageId: null, slackChannel: null, autoUpdates: true })
    bus.emit({ channel: 'session:updated', payload: info({ status: 'running' }) })
    await flush()
    expect(actions.list().some((a) => a.actionType === 'linear.status_update' && a.status === 'fired')).toBe(true)
  })

  it('on landed: Linear + Notion auto-fire, the Slack post queues for approval', async () => {
    const { bus, actions, auto } = setup()
    auto.register('s1', { linearIssueId: 'ENG-1', notionPageId: 'pg', slackChannel: '#eng', autoUpdates: true })
    bus.emit({ channel: 'session:updated', payload: info({ status: 'landed' }) })
    await flush()
    const a = actions.list()
    expect(a.find((x) => x.actionType === 'linear.status_update')?.status).toBe('fired')
    expect(a.find((x) => x.actionType === 'notion.spec_update')?.status).toBe('fired')
    // outward posts default to APPROVE → queued, not auto-sent
    expect(a.find((x) => x.actionType === 'slack.message')?.status).toBe('pending')
  })

  it('fires each status at most once (dedupe)', async () => {
    const { bus, actions, auto } = setup()
    auto.register('s1', { linearIssueId: 'ENG-1', notionPageId: null, slackChannel: null, autoUpdates: true })
    bus.emit({ channel: 'session:updated', payload: info({ status: 'running' }) })
    bus.emit({ channel: 'session:updated', payload: info({ status: 'running' }) })
    await flush()
    expect(actions.list().filter((x) => x.actionType === 'linear.status_update')).toHaveLength(1)
  })

  it('does nothing when autoUpdates is off', async () => {
    const { bus, actions, auto } = setup()
    auto.register('s1', { linearIssueId: 'ENG-1', notionPageId: null, slackChannel: null, autoUpdates: false })
    bus.emit({ channel: 'session:updated', payload: info({ status: 'running' }) })
    await flush()
    expect(actions.list()).toHaveLength(0)
  })

  it('does nothing for an unregistered session', async () => {
    const { bus, actions } = setup()
    bus.emit({ channel: 'session:updated', payload: info({ id: 'other', status: 'landed' }) })
    await flush()
    expect(actions.list()).toHaveLength(0)
  })
})
