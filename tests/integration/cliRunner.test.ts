import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '@shared/types'
import { openDatabase } from '../../src/main/db/database'
import { createRepositories, type Repositories } from '../../src/main/db/repositories'
import { EventBus } from '../../src/main/events'
import { CliSessionRunner } from '../../src/main/orchestrator/CliSessionRunner'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mt-cli-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function fakeCli(name: string, body: string): string {
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

function deps() {
  const repos: Repositories = createRepositories(openDatabase(':memory:'))
  const bus = new EventBus()
  return { repos, bus }
}

function info(repos: Repositories, over: Partial<SessionInfo> = {}): SessionInfo {
  const s: SessionInfo = {
    id: 'cli-1', sdkSessionId: null, title: 'cli task', engine: 'cursor', model: 'composer-2.5',
    cwd: dir, repoId: null, branch: null, worktreePath: null, status: 'queued', permissionMode: 'default',
    presetId: 'explore', totalCostUsd: 0, numTurns: 0, createdAt: Date.now(), updatedAt: Date.now(), error: null, ...over
  }
  repos.sessions.insert(s)
  return s
}

describe('CliSessionRunner — drives a CLI engine (cursor-style stream-json)', () => {
  it('runs a turn: parses the stream, persists the transcript, captures id + tokens, completes', async () => {
    const { repos, bus } = deps()
    const events: string[] = []
    bus.onEvent((e) => events.push(e.channel))
    const bin = fakeCli(
      'cursor-agent',
      [
        `echo '{"type":"system","subtype":"init","session_id":"fake-123","model":"Composer 2.5"}'`,
        `echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Edited foo.ts"}]}}'`,
        `echo '{"type":"result","subtype":"success","is_error":false,"result":"Edited foo.ts","usage":{"inputTokens":100,"outputTokens":20,"cacheReadTokens":40}}'`
      ].join('\n')
    )
    const runner = new CliSessionRunner({ repos, bus }, info(repos), 'cursor', bin)
    runner.start('do the thing')
    await runner.whenDone()

    const snap = runner.snapshot()
    expect(snap.status).toBe('completed')
    expect(snap.sdkSessionId).toBe('fake-123') // captured for --resume
    expect(snap.inputTokens).toBe(140) // 100 + cacheRead 40
    expect(snap.outputTokens).toBe(20)
    expect(snap.cachedInputTokens).toBe(40)

    const kinds = repos.messages.listBySession('cli-1').map((m) => m.kind)
    expect(kinds).toEqual(['user', 'assistant', 'result'])
    expect(events).toContain('session:message')
    expect(events).toContain('session:updated')
  })

  it('a non-zero exit surfaces as an error with the stderr tail', async () => {
    const { repos, bus } = deps()
    const bin = fakeCli('cursor-agent', 'echo "auth failed: 401" 1>&2\nexit 1')
    const runner = new CliSessionRunner({ repos, bus }, info(repos), 'cursor', bin)
    runner.start('do it')
    await runner.whenDone()
    const snap = runner.snapshot()
    expect(snap.status).toBe('error')
    expect(snap.error).toContain('auth failed')
  })

  it('a tool error event (in-stream) fails the turn', async () => {
    const { repos, bus } = deps()
    const bin = fakeCli('cursor-agent', `echo '{"type":"system","session_id":"x"}'\necho '{"type":"result","subtype":"error","is_error":true,"result":"rate limited"}'`)
    const runner = new CliSessionRunner({ repos, bus }, info(repos), 'cursor', bin)
    runner.start('do it')
    await runner.whenDone()
    expect(runner.snapshot().status).toBe('error')
  })

  it('stop() kills the turn and marks the session stopped', async () => {
    const { repos, bus } = deps()
    // A script that would run for a while if not killed.
    const bin = fakeCli('cursor-agent', `echo '{"type":"system","session_id":"x"}'\nsleep 30`)
    const runner = new CliSessionRunner({ repos, bus }, info(repos), 'cursor', bin)
    runner.start('do it')
    await vi.waitFor(() => expect(runner.snapshot().status).toBe('running'))
    runner.stop()
    await runner.whenDone()
    expect(runner.snapshot().status).toBe('stopped')
  })
})
