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
import { LifecycleAutomation } from '../../src/main/orchestrator/LifecycleAutomation'
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

    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
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
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
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

describe('persistent workState + tracker link', () => {
  it('workState follows status, but a stop preserves the prior state; link round-trips', () => {
    const { repos } = deps()
    const info = makeInfo(repos, { status: 'queued', workState: 'active', linearIssueId: 'ENG-9', notionPageId: 'pg-1' })
    repos.sessions.update(info.id, { status: 'running' })
    expect(repos.sessions.get(info.id)?.workState).toBe('active')
    repos.sessions.update(info.id, { status: 'landed' })
    expect(repos.sessions.get(info.id)?.workState).toBe('review')
    // A stop (incl. reconcileOnStartup) must NOT reset workState — keeps it resumable/in-lane.
    repos.sessions.update(info.id, { status: 'stopped' })
    const s = repos.sessions.get(info.id)!
    expect(s.status).toBe('stopped')
    expect(s.workState).toBe('review')
    expect(s.linearIssueId).toBe('ENG-9')
    expect(s.notionPageId).toBe('pg-1')
  })

  it('an active session stopped on restart stays workState=active (resumable)', () => {
    const { repos } = deps()
    const info = makeInfo(repos, { status: 'running', workState: 'active' })
    repos.sessions.update(info.id, { status: 'stopped' }) // simulate reconcileOnStartup
    expect(repos.sessions.get(info.id)?.workState).toBe('active')
  })
})

describe('SessionManager delete + pin', () => {
  const parkedRun = (args: { prompt: unknown; options: Record<string, unknown> }) =>
    (async function* () {
      yield { type: 'system', session_id: randomUUID() }
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }
      await new Promise<void>((resolve) => {
        const signal = (args.options.abortController as AbortController | undefined)?.signal
        if (!signal || signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
    })()

  it('deletes a running session: frees the slot, removes rows, emits session:deleted, no late events', async () => {
    const { repos, bus, actions, events } = deps()
    repos.settings.set({ concurrencyCap: 1 })
    h.queryImpl = parkedRun
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const a = await manager.spawn({ prompt: 'A', cwd: '/tmp/x', presetId: 'explore' })
    const b = await manager.spawn({ prompt: 'B', cwd: '/tmp/x', presetId: 'explore' })
    await vi.waitFor(() => expect(manager.list().find((s) => s.id === a.id)?.status).toBe('running'))
    await vi.waitFor(() => expect(repos.messages.listBySession(a.id).length).toBeGreaterThan(0))

    manager.delete(a.id)

    expect(repos.sessions.get(a.id)).toBeNull()
    expect(repos.messages.listBySession(a.id)).toEqual([])
    expect(manager.list().some((s) => s.id === a.id)).toBe(false)
    const deletedIdx = events.findIndex((e) => e.channel === 'session:deleted' && (e.payload as { id: string }).id === a.id)
    expect(deletedIdx).toBeGreaterThanOrEqual(0)
    // a's slot is freed, so the queued b starts running.
    await vi.waitFor(() => expect(manager.list().find((s) => s.id === b.id)?.status).toBe('running'))
    // The aborted run loop must NOT resurrect `a` via a trailing session:updated.
    await new Promise((r) => setTimeout(r, 30))
    const lateUpdate = events
      .slice(deletedIdx + 1)
      .some((e) => e.channel === 'session:updated' && (e.payload as SessionInfo).id === a.id)
    expect(lateUpdate).toBe(false)
  })

  it('pins a session: persists, reflects in list(), and emits session:updated', async () => {
    const { repos, bus, actions, events } = deps()
    h.queryImpl = () =>
      (async function* () {
        yield { type: 'system', session_id: 'sdk-pin' }
        yield { type: 'result', subtype: 'success', total_cost_usd: 0 }
      })()
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const a = await manager.spawn({ prompt: 'A', cwd: '/tmp/x', presetId: 'explore' })
    await vi.waitFor(() => expect(manager.list().find((s) => s.id === a.id)?.status).toBe('completed'))

    const before = events.length
    const updated = manager.setPinned(a.id, true)
    expect(updated.pinned).toBe(true)
    expect(repos.sessions.get(a.id)?.pinned).toBe(true)
    expect(manager.list().find((s) => s.id === a.id)?.pinned).toBe(true) // live snapshot synced
    expect(events.slice(before).some((e) => e.channel === 'session:updated' && (e.payload as SessionInfo).pinned === true)).toBe(true)

    manager.setPinned(a.id, false)
    expect(repos.sessions.get(a.id)?.pinned).toBe(false)
  })

  it('markDone stops a live session, frees its slot, and moves it to Done (workState)', async () => {
    const { repos, bus, actions } = deps()
    repos.settings.set({ concurrencyCap: 1 })
    h.queryImpl = parkedRun
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const a = await manager.spawn({ prompt: 'A', cwd: '/tmp/x', presetId: 'explore' })
    const b = await manager.spawn({ prompt: 'B', cwd: '/tmp/x', presetId: 'explore' })
    await vi.waitFor(() => expect(manager.list().find((s) => s.id === a.id)?.status).toBe('running'))

    manager.markDone(a.id)

    await vi.waitFor(() => {
      const s = manager.list().find((x) => x.id === a.id)!
      expect(s.status).toBe('stopped')
      expect(s.workState).toBe('done')
    })
    // a's slot is freed, so the queued b starts running.
    await vi.waitFor(() => expect(manager.list().find((s) => s.id === b.id)?.status).toBe('running'))
  })
})

describe('agentic orchestration: conductor → cheaper sub-agents', () => {
  // A query impl that yields nothing and ends immediately — the child's run
  // loop completes without needing the real binary, keeping the test hermetic.
  const noop = () => (async function* () {})()

  it('delegate spawns a child with parentId, the cheaper delegate model, and the parent cwd; listChildren includes it', async () => {
    const { repos, bus, actions } = deps()
    repos.settings.set({ concurrencyCap: 8, delegateModel: 'haiku' })
    h.queryImpl = noop
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const conductor = await manager.spawn({ prompt: 'orchestrate it', cwd: '/tmp/proj', presetId: 'conduct', useWorktree: false })

    const orch = (manager as unknown as { deps: { orchestration: { delegate: Function; listChildren: Function } } }).deps.orchestration
    const child = (await orch.delegate(conductor.id, { title: 'piece A', prompt: 'do A' })) as { id: string }

    const childInfo = manager.list().find((s) => s.id === child.id)!
    expect(childInfo.parentId).toBe(conductor.id)
    expect(childInfo.model).toBe('haiku') // cheaper delegate tier, not the conductor's model
    expect(childInfo.cwd).toBe('/tmp/proj') // shares the conductor's working dir
    expect(childInfo.presetId).toBe('explore') // sub-agents are plain workers

    const kids = orch.listChildren(conductor.id) as { id: string }[]
    expect(kids.map((k) => k.id)).toContain(child.id)
  })

  it('auto-tiers the sub-agent model from the sub-task prompt (research → haiku, implement → sonnet)', async () => {
    const { repos, bus, actions } = deps()
    repos.settings.set({ concurrencyCap: 8, delegateModel: 'sonnet' })
    h.queryImpl = noop
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const conductor = await manager.spawn({ prompt: 'orchestrate', cwd: '/tmp/proj', presetId: 'conduct', useWorktree: false })
    const orch = (manager as unknown as { deps: { orchestration: { delegate: Function } } }).deps.orchestration

    const research = (await orch.delegate(conductor.id, { title: 'r', prompt: 'find where the cache lives' })) as { id: string }
    const impl = (await orch.delegate(conductor.id, { title: 'i', prompt: 'implement the export endpoint' })) as { id: string }
    const explicit = (await orch.delegate(conductor.id, { title: 'x', prompt: 'find things', model: 'opus' })) as { id: string }

    const list = manager.list()
    expect(list.find((s) => s.id === research.id)?.model).toBe('haiku') // auto-tiered down
    expect(list.find((s) => s.id === impl.id)?.model).toBe('sonnet') // auto-tiered to mid
    expect(list.find((s) => s.id === explicit.id)?.model).toBe('opus') // explicit override wins
  })

  it('honors the conductor-judged kind over the prompt wording (LLM-as-judge)', async () => {
    const { repos, bus, actions } = deps()
    repos.settings.set({ concurrencyCap: 8, delegateModel: 'sonnet' })
    h.queryImpl = noop
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const conductor = await manager.spawn({ prompt: 'orchestrate', cwd: '/tmp/proj', presetId: 'conduct', useWorktree: false })
    const orch = (manager as unknown as { deps: { orchestration: { delegate: Function } } }).deps.orchestration

    // Prompt wording says "implement" (→ sonnet) but the conductor judges it research (→ haiku).
    const child = (await orch.delegate(conductor.id, { title: 'k', prompt: 'implement the thing', kind: 'research' })) as { id: string }
    expect(manager.list().find((s) => s.id === child.id)?.model).toBe('haiku')
  })

  it('listChildren surfaces a child’s latest assistant output for synthesis', () => {
    const { repos, bus, actions } = deps()
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const parent = makeInfo(repos, { id: randomUUID() })
    const child = makeInfo(repos, { parentId: parent.id, title: 'child' })
    repos.messages.insert({
      id: randomUUID(), sessionId: child.id, kind: 'assistant',
      blocks: [{ type: 'text', text: 'finished piece A, all tests pass' }], createdAt: Date.now()
    })
    const orch = (manager as unknown as { deps: { orchestration: { listChildren: Function } } }).deps.orchestration
    const kids = orch.listChildren(parent.id) as { id: string; summary: string }[]
    expect(kids).toHaveLength(1)
    expect(kids[0].summary).toContain('finished piece A')
  })

  it('refuses to delegate past the per-conductor limit (runaway-loop guard)', async () => {
    const { repos, bus, actions } = deps()
    repos.settings.set({ concurrencyCap: 64 })
    h.queryImpl = noop
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const conductor = await manager.spawn({ prompt: 'go', cwd: '/tmp/p', presetId: 'conduct', useWorktree: false })
    const orch = (manager as unknown as { deps: { orchestration: { delegate: Function } } }).deps.orchestration

    let refused: string | null = null
    for (let i = 0; i < 30; i++) {
      const r = (await orch.delegate(conductor.id, { title: `t${i}`, prompt: 'x' })) as { id: string; status: string }
      if (r.id === '') { refused = r.status; break }
    }
    expect(refused).toMatch(/delegation limit/)
  })

  it('waitForChildren blocks while a sub-agent runs, then resolves on its terminal event', async () => {
    const { repos, bus, actions } = deps()
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const conductor = makeInfo(repos, { id: randomUUID() })
    const child = makeInfo(repos, { parentId: conductor.id, status: 'running' })
    const orch = (manager as unknown as { deps: { orchestration: { waitForChildren: Function } } }).deps.orchestration

    let resolved = false
    const waitP = (orch.waitForChildren(conductor.id, [child.id]) as Promise<{ id: string; status: string }[]>).then((r) => {
      resolved = true
      return r
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(resolved).toBe(false) // still blocking — child is running

    const done = repos.sessions.update(child.id, { status: 'completed' })!
    bus.emit({ channel: 'session:updated', payload: done }) // the event waitForChildren listens for
    const results = await waitP
    expect(resolved).toBe(true)
    expect(results.find((c) => c.id === child.id)?.status).toBe('completed')
  })

  it('waitForChildren returns immediately when all children are already terminal', async () => {
    const { repos, bus, actions } = deps()
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const conductor = makeInfo(repos, { id: randomUUID() })
    makeInfo(repos, { parentId: conductor.id, status: 'completed' })
    makeInfo(repos, { parentId: conductor.id, status: 'error' })
    const orch = (manager as unknown as { deps: { orchestration: { waitForChildren: Function } } }).deps.orchestration

    const results = (await orch.waitForChildren(conductor.id)) as unknown[] // no ids → all children
    expect(results).toHaveLength(2)
  })

  it('parentId round-trips through the session repo (migration 0004)', () => {
    const { repos } = deps()
    const info = makeInfo(repos, { parentId: 'conductor-123' })
    expect(repos.sessions.get(info.id)?.parentId).toBe('conductor-123')
  })

  it('persists the per-task brief and reflects it on spawned sessions', async () => {
    const { repos, bus, actions } = deps()
    // Direct repo round-trip.
    const info = makeInfo(repos, { taskBrief: '# Task context\n\n**Task:** ship it' })
    expect(repos.sessions.get(info.id)?.taskBrief).toContain('ship it')

    // And a real spawn stores a generated brief containing the title.
    h.queryImpl = () => (async function* () {})()
    const manager = new SessionManager(repos, bus, actions, new WorktreeManager('/tmp/wt-test'), new LifecycleAutomation(bus, actions))
    const s = await manager.spawn({ prompt: 'Add CSV export', cwd: '/tmp/proj', presetId: 'explore', title: 'CSV export', useWorktree: false })
    const stored = manager.list().find((x) => x.id === s.id)
    expect(stored?.taskBrief).toContain('# Task context')
    expect(stored?.taskBrief).toContain('CSV export')
  })
})

describe('integration MCP server wiring', () => {
  it('passes the SDK MCP server config through without double-wrapping', async () => {
    const { repos, bus, actions } = deps()
    let captured: Record<string, unknown> | undefined
    h.queryImpl = (args) => {
      captured = args.options
      return (async function* () {
        yield { type: 'system', session_id: 'sdk-mcp' }
        yield { type: 'result', subtype: 'success' }
      })()
    }
    const info = makeInfo(repos)
    const session = new AgentSession({ repos, bus, actions }, info, { systemPromptAppend: '', isBuildPipeline: false })
    session.start('go')
    await session.whenDone()

    const servers = captured?.mcpServers as Record<string, { type?: string; tools?: unknown; instance?: unknown }>
    const entry = servers['multitasker-integrations']
    expect(entry.type).toBe('sdk')
    // createSdkMcpServer's result is passed straight through (it carries `tools`),
    // NOT re-wrapped in another { instance } layer.
    expect(Array.isArray(entry.tools)).toBe(true)
    expect('instance' in entry).toBe(false)
  })
})
