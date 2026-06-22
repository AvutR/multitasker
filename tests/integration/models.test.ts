import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/main/db/repositories'
import { listModels, resolveModel } from '../../src/main/models'

const base = DEFAULT_SETTINGS

describe('model registry', () => {
  it('lists Anthropic models by default; no gateway unless configured', () => {
    const models = listModels(base)
    expect(models.some((m) => m.id === 'opus')).toBe(true)
    expect(models.some((m) => m.id === 'gateway')).toBe(false)
  })

  it('adds a gateway model when configured', () => {
    const models = listModels({ ...base, gatewayBaseUrl: 'http://gw', gatewayModel: 'gpt-4o' })
    const gw = models.find((m) => m.id === 'gateway')
    expect(gw?.sdkModel).toBe('gpt-4o')
    expect(gw?.provider).toBe('gateway')
  })

  it('resolves an Anthropic model with no env override', () => {
    const r = resolveModel('opus', base)
    expect(r.sdkModel).toBe('claude-opus-4-8')
    expect(r.env).toBeUndefined()
  })

  it('ships the latest tier models: Opus 4.8, Sonnet 4.6, Haiku 4.5, Fable 5', () => {
    expect(resolveModel('sonnet', base).sdkModel).toBe('claude-sonnet-4-6')
    // Haiku must be a REAL id (the prior 'claude-haiku-4-6' did not exist).
    expect(resolveModel('haiku', base).sdkModel).toBe('claude-haiku-4-5-20251001')
    const fable = listModels(base).find((m) => m.id === 'fable')
    expect(fable?.sdkModel).toBe('claude-fable-5')
    expect(fable?.provider).toBe('anthropic')
  })

  it('resolves Bedrock/Vertex to the right env flags', () => {
    expect(resolveModel('bedrock-sonnet', base).env?.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(resolveModel('vertex-sonnet', base).env?.CLAUDE_CODE_USE_VERTEX).toBe('1')
  })

  it('resolves a gateway model to ANTHROPIC_BASE_URL/token', () => {
    const s = { ...base, gatewayBaseUrl: 'http://gw', gatewayModel: 'gpt-4o', gatewayApiKey: 'k' }
    const r = resolveModel('gateway', s)
    expect(r.sdkModel).toBe('gpt-4o')
    expect(r.env?.ANTHROPIC_BASE_URL).toBe('http://gw')
    expect(r.env?.ANTHROPIC_AUTH_TOKEN).toBe('k')
  })

  it('falls back to the default model for an unknown id', () => {
    expect(resolveModel('nope', base).sdkModel).toBe('claude-opus-4-8')
  })
})
