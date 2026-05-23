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

  it('disabled action types drop even when forced AUTO with dry-run off', async () => {
    const { svc, repos, gateway } = setup(false)
    repos.policies.setMode('github.pr_create', 'auto')
    const rec = await svc.propose({ ...base, actionType: 'github.pr_create' })
    expect(rec.status).toBe('dropped')
    expect(rec.decidedBy).toBe('policy_disabled')
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
