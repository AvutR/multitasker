import { describe, expect, it } from 'vitest'
import { DEFAULT_ENGINE, ENGINES, engineSpec } from '../../src/shared/engines'
import { detectEngines, resolveEngineBin } from '../../src/main/engines'

describe('engine registry', () => {
  it('every engine is well-formed; CLI engines carry a binary + protocol', () => {
    for (const e of ENGINES) {
      expect(e.label).toBeTruthy()
      expect(e.vendor).toBeTruthy()
      expect(['claude-json', 'codex-jsonl', 'text']).toContain(e.protocol)
      if (e.kind === 'cli') expect(e.bin).toBeTruthy()
    }
    expect(ENGINES.some((e) => e.id === DEFAULT_ENGINE && e.kind === 'sdk')).toBe(true)
  })

  it('engineSpec falls back to Claude for unknown/empty ids', () => {
    expect(engineSpec('cursor').id).toBe('cursor')
    expect(engineSpec('nope').id).toBe('claude')
    expect(engineSpec(null).id).toBe('claude')
    expect(engineSpec(undefined).id).toBe('claude')
  })

  it('cursor spans providers (OpenAI + Anthropic) in its model suggestions', () => {
    const hints = engineSpec('cursor').models.map((m) => m.label).join(' ')
    expect(hints).toMatch(/OpenAI/)
    expect(hints).toMatch(/Anthropic/)
  })

  it('detectEngines marks Claude available (SDK) and resolves CLI binaries when present', () => {
    const detected = detectEngines()
    expect(detected).toHaveLength(ENGINES.length)
    expect(detected.find((e) => e.id === 'claude')?.available).toBe(true)
    expect(resolveEngineBin('definitely-not-a-real-binary-xyz-123')).toBeNull()
  })
})
