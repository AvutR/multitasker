import { describe, expect, it } from 'vitest'
import type { ActionTypeDef } from '@shared/types'
import { decidePolicy, effectiveMode } from '../../src/main/integrations/PolicyEngine'
import { ACTION_TYPE_BY_ID } from '../../src/main/integrations/actionTypes'

const enabledInternal: ActionTypeDef = {
  id: 't.internal',
  connector: 'linear',
  direction: 'internal_bookkeeping',
  label: 'x',
  description: 'x',
  defaultPolicy: 'auto',
  enabled: true
}
const disabled: ActionTypeDef = { ...enabledInternal, id: 't.disabled', enabled: false }

describe('decidePolicy truth table', () => {
  it('disabled action types always drop, regardless of mode or dry-run', () => {
    for (const mode of ['auto', 'approve', 'off'] as const) {
      for (const dry of [true, false]) {
        const d = decidePolicy(disabled, mode, dry)
        expect(d.effect).toBe('drop')
        expect(d.decidedBy).toBe('policy_disabled')
      }
    }
  })

  it('OFF mode drops even under dry-run', () => {
    expect(decidePolicy(enabledInternal, 'off', false).effect).toBe('drop')
    expect(decidePolicy(enabledInternal, 'off', true).effect).toBe('drop')
    expect(decidePolicy(enabledInternal, 'off', false).decidedBy).toBe('policy_off')
  })

  it('dry-run overrides AUTO and APPROVE into dry_run', () => {
    expect(decidePolicy(enabledInternal, 'auto', true).effect).toBe('dry_run')
    expect(decidePolicy(enabledInternal, 'approve', true).effect).toBe('dry_run')
    expect(decidePolicy(enabledInternal, 'auto', true).decidedBy).toBe('dry_run')
  })

  it('AUTO fires when dry-run is off', () => {
    const d = decidePolicy(enabledInternal, 'auto', false)
    expect(d.effect).toBe('fire')
    expect(d.decidedBy).toBe('auto')
  })

  it('APPROVE queues when dry-run is off', () => {
    const d = decidePolicy(enabledInternal, 'approve', false)
    expect(d.effect).toBe('queue')
    expect(d.decidedBy).toBe('user')
  })
})

describe('effectiveMode', () => {
  it('uses the override when present, else the type default', () => {
    expect(effectiveMode(enabledInternal, {})).toBe('auto')
    expect(effectiveMode(enabledInternal, { 't.internal': 'off' })).toBe('off')
  })
})

describe('action taxonomy defaults encode the Raising the Bar rule', () => {
  it('internal bookkeeping (Linear/Notion) defaults AUTO', () => {
    expect(ACTION_TYPE_BY_ID['linear.status_update'].defaultPolicy).toBe('auto')
    expect(ACTION_TYPE_BY_ID['notion.spec_update'].defaultPolicy).toBe('auto')
  })
  it('outward posts (Slack) default APPROVE', () => {
    expect(ACTION_TYPE_BY_ID['slack.standup_post'].defaultPolicy).toBe('approve')
    expect(ACTION_TYPE_BY_ID['slack.message'].defaultPolicy).toBe('approve')
  })
  it('GitHub PR actions are disabled in v1 (no-remote constraint)', () => {
    expect(ACTION_TYPE_BY_ID['github.pr_create'].enabled).toBe(false)
    expect(ACTION_TYPE_BY_ID['github.pr_comment'].enabled).toBe(false)
  })
})
