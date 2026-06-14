import { describe, expect, it, vi } from 'vitest'
import { TtlCache } from '../../src/main/util/TtlCache'

describe('TtlCache', () => {
  it('serves a cached value within the TTL without re-running the loader', async () => {
    const cache = new TtlCache()
    let calls = 0
    const load = async () => ++calls
    expect(await cache.get('k', 1000, load)).toBe(1)
    expect(await cache.get('k', 1000, load)).toBe(1) // cached
    expect(calls).toBe(1)
  })

  it('dedupes concurrent loads for the same key (shares the in-flight promise)', async () => {
    const cache = new TtlCache()
    let calls = 0
    const load = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 10))
      return 'v'
    }
    const [a, b] = await Promise.all([cache.get('k', 1000, load), cache.get('k', 1000, load)])
    expect(a).toBe('v')
    expect(b).toBe('v')
    expect(calls).toBe(1) // one in-flight load shared
  })

  it('force bypasses the cache and refreshes it', async () => {
    const cache = new TtlCache()
    let calls = 0
    const load = async () => ++calls
    await cache.get('k', 1000, load)
    expect(await cache.get('k', 1000, load, true)).toBe(2) // forced
    expect(await cache.get('k', 1000, load)).toBe(2) // now serves the refreshed value
  })

  it('re-loads after the TTL expires', async () => {
    vi.useFakeTimers()
    try {
      const cache = new TtlCache()
      let calls = 0
      const load = async () => ++calls
      expect(await cache.get('k', 1000, load)).toBe(1)
      vi.advanceTimersByTime(1001)
      expect(await cache.get('k', 1000, load)).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not cache a rejected load', async () => {
    const cache = new TtlCache()
    let calls = 0
    const load = async () => {
      calls++
      throw new Error('boom')
    }
    await expect(cache.get('k', 1000, load)).rejects.toThrow('boom')
    await expect(cache.get('k', 1000, load)).rejects.toThrow('boom')
    expect(calls).toBe(2) // failure evicted → retried, not cached
  })

  it('invalidate drops a key', async () => {
    const cache = new TtlCache()
    let calls = 0
    const load = async () => ++calls
    await cache.get('k', 1000, load)
    cache.invalidate('k')
    expect(await cache.get('k', 1000, load)).toBe(2)
  })
})
