import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

/**
 * The cross-provider spin-off bridge: a loopback HTTP endpoint + an `mt` shim on
 * every session's PATH, so ANY agent (Claude, Cursor, Codex, …) can recruit a
 * sub-agent of ANY provider straight from its shell —
 *   mt spawn --engine cursor "audit the auth module"
 * The spawn routes back through SessionManager.delegate, so it's bounded by the
 * same depth / per-tree budget / installed-engine guards.
 *
 * Security: bound to 127.0.0.1 only; every request needs the per-run token; any
 * request carrying an Origin header (i.e. a browser, incl. DNS-rebind attempts) is
 * rejected; the body is size-capped.
 */

export type BridgeSpawn = (parentId: string, input: { engine?: string; prompt: string; title?: string }) => Promise<{ id: string; title: string; status: string }>

// Module singleton so AgentSession / CliSessionRunner can inject the env without
// threading the bridge through every constructor.
let active: { url: string; token: string; binDir: string } | null = null

/** Env vars (+ PATH) to hand a spawned agent so it can call `mt spawn`. */
export function bridgeEnv(parentSessionId: string): Record<string, string> {
  if (!active) return {}
  return {
    MULTITASKER_SPAWN_URL: active.url,
    MULTITASKER_TOKEN: active.token,
    MULTITASKER_PARENT: parentSessionId,
    PATH: `${active.binDir}:${process.env.PATH ?? ''}`
  }
}

export class SpawnBridge {
  private server: Server | null = null
  private readonly token = randomUUID()
  private port = 0

  constructor(
    private readonly spawn: BridgeSpawn,
    private readonly binDir: string
  ) {}

  async start(): Promise<void> {
    this.writeShim()
    this.server = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/spawn') {
        res.writeHead(404)
        return res.end()
      }
      if (req.headers.origin) {
        // A browser (incl. DNS-rebind) sets Origin; our agents' shell calls don't.
        res.writeHead(403)
        return res.end('forbidden')
      }
      if (req.headers['x-mt-token'] !== this.token) {
        res.writeHead(401)
        return res.end('unauthorized')
      }
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
        if (body.length > 100_000) req.destroy()
      })
      req.on('end', () => {
        void (async () => {
          try {
            const { parentSessionId, engine, prompt, title } = JSON.parse(body) as {
              parentSessionId?: string
              engine?: string
              prompt?: string
              title?: string
            }
            if (typeof parentSessionId !== 'string' || typeof prompt !== 'string' || !prompt.trim()) {
              res.writeHead(400)
              return res.end('parentSessionId and prompt are required')
            }
            const r = await this.spawn(parentSessionId, { engine, prompt, title })
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(r))
          } catch (err) {
            res.writeHead(500)
            res.end(err instanceof Error ? err.message : String(err))
          }
        })()
      })
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    const addr = this.server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : 0
    active = { url: this.url(), token: this.token, binDir: this.binDir }
  }

  url(): string {
    return `http://127.0.0.1:${this.port}/spawn`
  }

  stop(): void {
    this.server?.close()
    this.server = null
    active = null
  }

  /** Write the `mt` shim agents invoke from their shell (Node — present wherever
   *  these CLI agents run). Rewritten each start (the token rotates per run). */
  private writeShim(): void {
    mkdirSync(this.binDir, { recursive: true })
    const shim = `#!/usr/bin/env node
// Multitasker spin-off shim. Recruit a sub-agent of any provider:
//   mt spawn --engine <claude|cursor|codex> [--title T] "<prompt>"
const http = require('http')
const [, , cmd, ...rest] = process.argv
if (cmd !== 'spawn') {
  console.error('usage: mt spawn --engine <claude|cursor|codex> [--title T] "<prompt>"')
  process.exit(1)
}
let engine = 'claude', title = '', prompt = ''
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--engine') engine = rest[++i]
  else if (rest[i] === '--title') title = rest[++i]
  else prompt = rest[i]
}
if (!process.env.MULTITASKER_SPAWN_URL || !prompt) { console.error('mt: not in a Multitasker session, or no prompt'); process.exit(1) }
const u = new URL(process.env.MULTITASKER_SPAWN_URL)
const data = JSON.stringify({ parentSessionId: process.env.MULTITASKER_PARENT, engine, prompt, title })
const req = http.request(
  { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'x-mt-token': process.env.MULTITASKER_TOKEN, 'content-length': Buffer.byteLength(data) } },
  (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => console.log(b)) }
)
req.on('error', (e) => { console.error('mt:', e.message); process.exit(1) })
req.write(data)
req.end()
`
    const path = join(this.binDir, 'mt')
    writeFileSync(path, shim)
    chmodSync(path, 0o755)
  }
}
