import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcEvent } from '@shared/ipc'
import type { SessionInfo } from '@shared/types'

// The SDK is mocked so the orchestrator is fully deterministic. `queryImpl` is
// swapped per test to script the message stream and exercise canUseTool.
const h = vi.hoisted(() => ({
  queryImpl: null as null | ((args: { prompt: unknown; options: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>)
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: unknown; options: Record<string, unknown> }) => h.queryImpl!(args),
  createSdkMcpServer: (cfg: Record<string, unknown>) => ({ type: 'sdk', ...cfg }),
  tool: (name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name,
    description,
    inputSchema,
    handler
  })
}))

import { openDatabase } from '../../src/main/db/database'
import { createRepositories, type Repositories } from '../../src/main/db/repositories'
import { EventBus } from '../../src/main/events'
import { ActionService, seedDefaultPolicies } from '../../src/main/integrations/ActionService'
import { AgentSession } from '../../src/main/orchestrator/AgentSession'
import { SessionManager } from '../../src/main/orchestrator/SessionManager'
import { WorktreeManager } from '../../src/main/git/Worktrees'

function deps() {
  const db = openDatabase(':memory:')
  const repos: Repositories = createRepositories(db)
  seedDefaultPolicies(repos)
  const bus = new EventBus()
  const events: IpcEvent[] = []
  bus.onEvent((e) => events.push(e))
  const actions = new ActionService(repos, bus, { execute: async () => ({ ok: true }) })
  return { repos, bus, actions, events }
}

function makeInfo(repos: Repositories, over: Partial<SessionInfo> = {}): SessionInfo {
  const info: SessionInfo = {
    id: randomUUID(),
    sdkSessionId: null,
    title: 't',
    model: null,
    cwd: '/tmp/x',
    repoId: null,
    branch: null,
    worktreePath: null,
    status: 'queued',
    permissionMode: 'default',
    presetId: 'explore',
    totalCostUsd: 0,
    numTurns: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
    ...over
  }
  repos.sessions.insert(info)
  return info
}

beforeEach(() => {
  h.queryImpl = null
})

describe('AgentSession lifecycle + streaming', () => {
  it('captures session id/model/cost, persists messages, and completes', async () => {
    const { repos, bus, actions } = deps()
    h.queryImpl = () =>
      (async function* () {
        yield { type: 'system', session_id: 'sdk-1', model: 'claude-x' }
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.012, num_turns: 2, result: 'done' }
      })()

    const info = makeInfo(repos)
    const session = new AgentSession({ repos, bus, actions }, info, { systemPromptAppend: '', isBuildPipeline: false })
    session.start('do the thing')
    await session.whenDone()

    const snap = session.snapshot()
    expect(snap.status).toBe('completed')
    expect(snap.sdkSessionId).toBe('sdk-1')
    expect(snap.model).toBe('claude-x')
    expect(snap.totalCostUsd).toBe(0.012)
    expect(snap.numTurns).toBe(2)
    const msgs = repos.messages.listBySession(info.id)
    expect(msgs.map((m) => m.kind)).toEqual(['assistant', 'result'])
  })
})

describe('plan-approval gate (via canUseTool on ExitPlanMode)', () => {
  it('blocks on the plan, emits a planRequest, and allows on approval', async () => {
    const { repos, bus, actions, events } = deps()
    let decision: { behavior: string; message?: string } | undefined
    h.queryImpl = (args) =>
      (async function* () {
        yield { type: 'system', session_id: 'sdk-2' }
        decision = (await (args.options.canUseTool as (n: string, i: Record<string, unknown>) => Promise<{ behavior: string }>)(
          'ExitPlanMode',
          { plan: 'my plan' }
        )) as { behavior: string }
        yield { type: 'result', subtype: 'success' }
      })()

    const info = makeInfo(repos, { permissionMode: 'plan' })
    const session = new AgentSession({ repos, bus, actions }, info, { systemPromptAppend: '', isBuildPipeline: true })
    session.start('build it')

    await vi.waitFor(() => expect(session.snapshot().status).toBe('awaiting_plan_approval'))
    expect(events.some((e) => e.channel === 'session:planRequest')).toBe(true)

    session.approvePlan(true)
    await session.whenDone()
    expect(decision?.behavior).toBe('allow')
  })

  it('denies with feedback on rejection', async () => {
    const { repos, bus, actions } = deps()
    let decision: { behavior: string; message?: string } | undefined
    h.queryImpl = (args) =>
      (async function* () {
        yield { type: 'system', session_id: 'sdk-3' }
        decision = (await (args.options.canUseTool as (n: string, i: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>)(
          'ExitPlanMode',
          { plan: 'p' }
        )) as { behavior: string; message?: string }
        yield { type: 'result', subtype: 'success' }
      })()

    const info = makeInfo(repos, { permissionMode: 'plan' })
    const session = new AgentSession({ repos, bus, actions }, info, { systemPromptAppend: '', isBuildPipeline: true })
    session.start('build it')
    await vi.waitFor(() => expect(session.snapshot().status).toBe('awaiting_plan_approval'))
    session.approvePlan(false, 'not deep enough')
    await session.whenDone()
    expect(decision?.behavior).toBe('deny')
    expect(decision?.message).toBe('not deep enough')
  })
})

describe('connector gate (via canUseTool on a raw connector tool)', () => {
  it('denies a raw Slack post under dry-run and records intent', async () => {
    const { repos, bus, actions } = deps()
    repos.settings.set({ dryRun: true })
    let decision: { behavior: string } | undefined
    h.queryImpl = (args) =>
      (async function* () {
        yield { type: 'system', session_id: 'sdk-4' }
        decision = (await (args.options.canUseTool as (n: string, i: Record<string, unknown>) => Promise<{ behavior: string }>)(
          'mcp__slack__slack_send_message',
          { channel: '#eng', text: 'hi' }
        )) as { behavior: string }
        yield { type: 'result', subtype: 'success' }
      })()

    const info = makeInfo(repos)
    const session = new AgentSession({ repos, bus, actions }, info, { systemPromptAppend: '', isBuildPipeline: false })
    session.start('post to slack')
    await session.whenDone()
    expect(decision?.behavior).toBe('deny')
    expect(actions.list().some((a) => a.actionType === 'slack.message' && a.status === 'dry_run')).toBe(true)
  })
})

describe('SessionManager concurrency cap', () => {
  it('queues spawns beyond the cap and starts them as slots free', async () => {
    const { repos, bus, actions } = deps()
    repos.settings.set({ concurrencyCap: 1 })
    // A live run that parks until its abort signal fires (mirrors the real SDK on stop()).
    h.queryImpl = (args) =>
      (async function* () {
        yield { type: 'system', session_id: randomUUID() }
        await new Promise<void>((resolve) => {
          const signal = (args.options.abortController as AbortController | undefined)?.signal
          signal?.addEventListener('abort', () => resolve())
        })
      })()

    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'))
    const a = await manager.spawn({ prompt: 'A', cwd: '/tmp/x', presetId: 'explore' })
    const b = await manager.spawn({ prompt: 'B', cwd: '/tmp/x', presetId: 'explore' })

    await vi.waitFor(() => {
      const live = manager.list().find((s) => s.id === a.id)
      expect(live?.status).toBe('running')
    })
    expect(manager.list().find((s) => s.id === b.id)?.status).toBe('queued')

    manager.stop(a.id)
    await vi.waitFor(() => {
      expect(manager.list().find((s) => s.id === b.id)?.status).toBe('running')
    })
  })

  it('stopping a session parked on plan approval frees its slot (no slot leak)', async () => {
    const { repos, bus, actions } = deps()
    repos.settings.set({ concurrencyCap: 1 })
    h.queryImpl = (args) =>
      (async function* () {
        yield { type: 'system', session_id: randomUUID() }
        await (args.options.canUseTool as (n: string, i: Record<string, unknown>) => Promise<unknown>)(
          'ExitPlanMode',
          { plan: 'p' }
        )
        await new Promise<void>((resolve) => {
          const signal = (args.options.abortController as AbortController | undefined)?.signal
          if (!signal || signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
      })()
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'))
    const a = await manager.spawn({ prompt: 'A', cwd: '/tmp', presetId: 'build', useWorktree: false })
    const b = await manager.spawn({ prompt: 'B', cwd: '/tmp', presetId: 'explore' })

    await vi.waitFor(() => expect(manager.list().find((s) => s.id === a.id)?.status).toBe('awaiting_plan_approval'))
    expect(manager.list().find((s) => s.id === b.id)?.status).toBe('queued')

    manager.stop(a.id)
    // b leaving 'queued' proves a's slot was freed (it then hits its own plan gate).
    await vi.waitFor(() => expect(manager.list().find((s) => s.id === b.id)?.status).not.toBe('queued'))
  })
})

describe('resume after stop uses a fresh queue', () => {
  it('a stopped session runs again on resume (closed-queue regression)', async () => {
    const { repos, bus, actions } = deps()
    let runs = 0
    h.queryImpl = (args) =>
      (async function* () {
        // Only proceed if we actually receive an input message — a closed/empty
        // prompt queue (the bug) would yield nothing and never increment `runs`.
        const iterator = (args.prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]()
        const first = await iterator.next()
        if (!first.done) {
          runs += 1
          yield { type: 'system', session_id: 'sdk-r' }
          yield { type: 'result', subtype: 'success', total_cost_usd: 0 }
        }
      })()

    const info = makeInfo(repos)
    const session = new AgentSession({ repos, bus, actions }, info, { systemPromptAppend: '', isBuildPipeline: false })
    session.start('first')
    await session.whenDone()
    session.stop()
    session.resume('second', false)
    await session.whenDone()
    expect(runs).toBe(2)
  })
})
