import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { createRepositories, type Repositories } from '../../src/main/db/repositories'
import { EventBus } from '../../src/main/events'
import { ActionService, seedDefaultPolicies } from '../../src/main/integrations/ActionService'
import type {
  ConnectorExecuteInput,
  ConnectorExecuteResult,
  ConnectorGateway
} from '../../src/main/integrations/ConnectorGateway'

class FakeGateway implements ConnectorGateway {
  calls: ConnectorExecuteInput[] = []
  result: ConnectorExecuteResult = { ok: true, result: { ok: true } }
  async execute(input: ConnectorExecuteInput): Promise<ConnectorExecuteResult> {
    this.calls.push(input)
    return this.result
  }
}

function setup(dryRun: boolean) {
  const db = openDatabase(':memory:')
  const repos: Repositories = createRepositories(db)
  seedDefaultPolicies(repos)
  repos.settings.set({ dryRun })
  const bus = new EventBus()
  const gateway = new FakeGateway()
  const svc = new ActionService(repos, bus, gateway)
  return { repos, bus, gateway, svc }
}

const base = { sessionId: 's1', summary: 'test', payload: { x: 1 } }

describe('ActionService.propose (path #1 — Multitasker owns execution)', () => {
  it('internal AUTO fires through the connector when dry-run is off', async () => {
    const { svc, gateway } = setup(false)
    const rec = await svc.propose({ ...base, actionType: 'linear.status_update' })
    expect(rec.status).toBe('fired')
    expect(rec.decidedBy).toBe('auto')
    expect(gateway.calls).toHaveLength(1)
  })

  it('dry-run records intent and NEVER calls the connector', async () => {
    const { svc, gateway } = setup(true)
    const rec = await svc.propose({ ...base, actionType: 'linear.status_update' })
    expect(rec.status).toBe('dry_run')
    expect(gateway.calls).toHaveLength(0)
  })

  it('outward APPROVE queues, then fires on one-click approval', async () => {
    const { svc, gateway } = setup(false)
    const queued = await svc.propose({ ...base, actionType: 'slack.message' })
    expect(queued.status).toBe('pending')
    expect(gateway.calls).toHaveLength(0)

    const fired = await svc.decide(queued.id, true)
    expect(fired.status).toBe('fired')
    expect(fired.decidedBy).toBe('user')
    expect(gateway.calls).toHaveLength(1)
  })

  it('rejecting a pending action never calls the connector', async () => {
    const { svc, gateway } = setup(false)
    const queued = await svc.propose({ ...base, actionType: 'slack.message' })
    const rejected = await svc.decide(queued.id, false)
    expect(rejected.status).toBe('rejected')
    expect(gateway.calls).toHaveLength(0)
  })

  it('OFF policy drops without calling the connector', async () => {
    const { svc, repos, gateway } = setup(false)
    repos.policies.setMode('linear.status_update', 'off')
    const rec = await svc.propose({ ...base, actionType: 'linear.status_update' })
    expect(rec.status).toBe('dropped')
    expect(gateway.calls).toHaveLength(0)
  })

  it('github.pr_create is enabled and gated — queues under APPROVE instead of dropping', async () => {
    const { svc, gateway } = setup(false)
    const rec = await svc.propose({ ...base, actionType: 'github.pr_create', payload: { title: 'PR' } })
    expect(rec.status).toBe('pending') // enabled + default APPROVE → queued (was 'dropped' when disabled)
    expect(gateway.calls).toHaveLength(0)
  })

  it('connector failure is recorded as failed', async () => {
    const { svc, gateway } = setup(false)
    gateway.result = { ok: false, error: 'boom' }
    const rec = await svc.propose({ ...base, actionType: 'linear.status_update' })
    expect(rec.status).toBe('failed')
    expect(rec.error).toBe('boom')
  })
})

describe('ActionService.guard (path #2 — raw connector call, agent executes on allow)', () => {
  it('AUTO allows the agent to proceed and audits a fired record', async () => {
    const { svc, gateway } = setup(false)
    const out = await svc.guard({ ...base, actionType: 'linear.status_update' })
    expect(out.allow).toBe(true)
    expect(out.record?.status).toBe('fired')
    // path #2 does NOT call the gateway — the agent's own subprocess executes
    expect(gateway.calls).toHaveLength(0)
  })

  it('APPROVE denies the raw call and queues it for approval', async () => {
    const { svc } = setup(false)
    const out = await svc.guard({ ...base, actionType: 'slack.message' })
    expect(out.allow).toBe(false)
    expect(out.record?.status).toBe('pending')
    expect(out.message).toMatch(/approval/i)
  })

  it('dry-run denies the raw call and records intent', async () => {
    const { svc } = setup(true)
    const out = await svc.guard({ ...base, actionType: 'slack.message' })
    expect(out.allow).toBe(false)
    expect(out.record?.status).toBe('dry_run')
  })

  it('OFF denies the raw call and drops it', async () => {
    const { svc, repos } = setup(false)
    repos.policies.setMode('slack.message', 'off')
    const out = await svc.guard({ ...base, actionType: 'slack.message' })
    expect(out.allow).toBe(false)
    expect(out.record?.status).toBe('dropped')
  })

  it('unknown / non-connector tools pass straight through', async () => {
    const { svc } = setup(false)
    const out = await svc.guard({ ...base, actionType: 'not.a.real.action' })
    expect(out.allow).toBe(true)
    expect(out.record).toBeNull()
  })
})

describe('audit log', () => {
  it('every decision writes an append-only action row', async () => {
    const { svc } = setup(false)
    await svc.propose({ ...base, actionType: 'linear.status_update' }) // fired
    await svc.propose({ ...base, actionType: 'slack.message' }) // pending
    await svc.guard({ ...base, actionType: 'slack.message' }) // pending (raw)
    expect(svc.list()).toHaveLength(3)
  })
})

describe('github actions route to the git gateway', () => {
  it('github.push_branch fires via the git gateway, not the connector gateway', async () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    seedDefaultPolicies(repos)
    repos.settings.set({ dryRun: false })
    const bus = new EventBus()
    const connector = new FakeGateway()
    const git = new FakeGateway()
    const svc = new ActionService(repos, bus, connector, git)
    const rec = await svc.propose({
      sessionId: 's',
      actionType: 'github.push_branch',
      summary: 'push',
      payload: { cwd: '/x', branch: 'b' }
    })
    expect(rec.status).toBe('fired')
    expect(git.calls).toHaveLength(1)
    expect(connector.calls).toHaveLength(0)
  })

  it('github.pr_create queues, then fires via the git gateway with the session cwd injected', async () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    seedDefaultPolicies(repos)
    repos.settings.set({ dryRun: false })
    repos.sessions.insert({
      id: 'sx', sdkSessionId: null, title: 't', model: null, cwd: '/repo', repoId: null, branch: 'b',
      worktreePath: null, status: 'running', permissionMode: 'default', presetId: null,
      totalCostUsd: 0, numTurns: 0, createdAt: 0, updatedAt: 0, error: null
    })
    const bus = new EventBus()
    const connector = new FakeGateway()
    const git = new FakeGateway()
    const svc = new ActionService(repos, bus, connector, git)

    const queued = await svc.propose({ sessionId: 'sx', actionType: 'github.pr_create', summary: 'PR', payload: { title: 'My PR', body: 'b' } })
    expect(queued.status).toBe('pending') // default APPROVE
    expect(git.calls).toHaveLength(0)

    const fired = await svc.decide(queued.id, true)
    expect(fired.status).toBe('fired')
    expect(git.calls).toHaveLength(1)
    expect(git.calls[0].actionType).toBe('github.pr_create')
    expect((git.calls[0].payload as { cwd?: string }).cwd).toBe('/repo') // session cwd injected
    expect((git.calls[0].payload as { title?: string }).title).toBe('My PR')
    expect(connector.calls).toHaveLength(0)
  })
})

describe('ActionService.propose idempotency (dedup duplicate updates)', () => {
  it('collapses an identical action that already fired — connector hit once (key order-insensitive)', async () => {
    const { svc, gateway } = setup(false) // dry-run off → AUTO fires
    const first = await svc.propose({ sessionId: 's', actionType: 'linear.status_update', summary: 'In Progress', payload: { issueId: 'ENG-1', status: 'In Progress' } })
    expect(first.status).toBe('fired')
    // Same logical payload, different key order (lifecycle vs agent build it differently).
    const second = await svc.propose({ sessionId: 's', actionType: 'linear.status_update', summary: 'again', payload: { status: 'In Progress', issueId: 'ENG-1' } })
    expect(second.id).toBe(first.id) // deduped → same record
    expect(gateway.calls).toHaveLength(1) // connector hit once, not twice
    expect(svc.list()).toHaveLength(1)
  })

  it('does not dedup a different payload', async () => {
    const { svc, gateway } = setup(false)
    await svc.propose({ sessionId: 's', actionType: 'linear.status_update', summary: 'a', payload: { issueId: 'ENG-1', status: 'In Progress' } })
    await svc.propose({ sessionId: 's', actionType: 'linear.status_update', summary: 'b', payload: { issueId: 'ENG-1', status: 'In Review' } })
    expect(gateway.calls).toHaveLength(2)
    expect(svc.list()).toHaveLength(2)
  })

  it('a failed action is not deduped — a retry goes through', async () => {
    const { svc, gateway } = setup(false)
    gateway.result = { ok: false, error: 'boom' }
    const first = await svc.propose({ sessionId: 's', actionType: 'linear.status_update', summary: 'x', payload: { issueId: 'ENG-2', status: 'Done' } })
    expect(first.status).toBe('failed')
    gateway.result = { ok: true, result: {} }
    const retry = await svc.propose({ sessionId: 's', actionType: 'linear.status_update', summary: 'x', payload: { issueId: 'ENG-2', status: 'Done' } })
    expect(retry.id).not.toBe(first.id) // failed → not a dedup target → retried
    expect(retry.status).toBe('fired')
  })
})

describe('decide() claims synchronously — no double-fire on double-click', () => {
  it('two concurrent decides call the connector exactly once', async () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    seedDefaultPolicies(repos)
    repos.settings.set({ dryRun: false })
    const bus = new EventBus()
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow: ConnectorGateway = {
      async execute() {
        calls += 1
        await gate // hold the "connector call" open to simulate the real latency
        return { ok: true }
      }
    }
    const svc = new ActionService(repos, bus, slow)
    const queued = await svc.propose({ sessionId: 's', actionType: 'slack.message', summary: 'x', payload: { channel: '#c', text: 'hi' } })
    expect(queued.status).toBe('pending')
    const p1 = svc.decide(queued.id, true)
    const p2 = svc.decide(queued.id, true) // the double-click, during the slow call
    release()
    await Promise.all([p1, p2])
    expect(calls).toBe(1) // claim moved it out of 'pending' before the await, so p2 no-ops
  })
})

describe('setMode AUTO is authoritative + retroactive', () => {
  it('flipping a type to AUTO fires its already-pending actions', async () => {
    const { svc, gateway } = setup(false) // dry-run off
    const q = await svc.propose({ sessionId: 's', actionType: 'slack.message', summary: 'x', payload: { channel: '#c', text: 'hi' } })
    expect(q.status).toBe('pending') // slack defaults APPROVE
    expect(gateway.calls).toHaveLength(0)
    svc.setMode('slack.message', 'auto')
    await new Promise((r) => setTimeout(r, 0)) // let the retroactive decide() settle
    expect(svc.list().find((a) => a.id === q.id)?.status).toBe('fired')
    expect(gateway.calls).toHaveLength(1)
  })

  it('does NOT fire pending actions under dry-run (records intent only)', async () => {
    const { svc, gateway } = setup(true) // dry-run ON
    const q = await svc.propose({ sessionId: 's', actionType: 'slack.message', summary: 'x', payload: { channel: '#c', text: 'hi' } })
    expect(q.status).toBe('dry_run') // dry-run → recorded, not pending
    svc.setMode('slack.message', 'auto')
    await new Promise((r) => setTimeout(r, 0))
    expect(gateway.calls).toHaveLength(0) // nothing fired under dry-run
  })
})
