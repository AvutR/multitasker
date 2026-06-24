import http from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bridgeEnv, SpawnBridge } from '../../src/main/orchestrator/SpawnBridge'

let dir: string
let bridge: SpawnBridge
let calls: { parentId: string; input: { engine?: string; prompt: string; title?: string } }[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mt-bridge-'))
  calls = []
  bridge = new SpawnBridge(async (parentId, input) => {
    calls.push({ parentId, input })
    return { id: 'sub-1', title: input.title ?? '', status: 'queued' }
  }, dir)
  await bridge.start()
})
afterEach(() => {
  bridge.stop()
  rmSync(dir, { recursive: true, force: true })
})

function post(body: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const u = new URL(bridge.url())
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers } },
      (res) => {
        let t = ''
        res.on('data', (c) => (t += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: t }))
      }
    )
    req.write(body)
    req.end()
  })
}
const token = () => bridgeEnv('x').MULTITASKER_TOKEN

describe('SpawnBridge — cross-provider spin-off endpoint', () => {
  it('writes the mt shim and exposes the bridge env (with mt on PATH)', () => {
    expect(existsSync(join(dir, 'mt'))).toBe(true)
    const env = bridgeEnv('sess-1')
    expect(env.MULTITASKER_PARENT).toBe('sess-1')
    expect(env.MULTITASKER_SPAWN_URL).toContain('127.0.0.1')
    expect(env.PATH.startsWith(dir)).toBe(true)
  })

  it('spawns a sub-agent of any engine with the right token', async () => {
    const r = await post(JSON.stringify({ parentSessionId: 'p1', engine: 'cursor', prompt: 'audit auth' }), { 'x-mt-token': token() })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text).id).toBe('sub-1')
    expect(calls[0]).toEqual({ parentId: 'p1', input: { engine: 'cursor', prompt: 'audit auth', title: undefined } })
  })

  it('rejects a missing or wrong token (no spawn)', async () => {
    expect((await post(JSON.stringify({ parentSessionId: 'p', prompt: 'x' }))).status).toBe(401)
    expect((await post(JSON.stringify({ parentSessionId: 'p', prompt: 'x' }), { 'x-mt-token': 'nope' })).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('rejects browser requests carrying an Origin (DNS-rebind defense)', async () => {
    const r = await post(JSON.stringify({ parentSessionId: 'p', prompt: 'x' }), { 'x-mt-token': token(), origin: 'http://evil.example' })
    expect(r.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('rejects an empty prompt or missing parent', async () => {
    expect((await post(JSON.stringify({ parentSessionId: 'p', prompt: '   ' }), { 'x-mt-token': token() })).status).toBe(400)
    expect((await post(JSON.stringify({ prompt: 'hi' }), { 'x-mt-token': token() })).status).toBe(400)
  })
})
