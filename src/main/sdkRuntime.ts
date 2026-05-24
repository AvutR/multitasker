import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// The Agent SDK, unset, locates its bundled CLI relative to its own module path
// — which is inside app.asar in a packaged build, so the spawn fails with
// ENOTDIR. Point it at the user's installed `claude` (a real on-disk binary)
// via options.pathToClaudeCodeExecutable. Resolved once, lazily (after the
// main process has fixed PATH).
let resolved = false
let cached: string | undefined

export function claudeExecutablePath(): string | undefined {
  if (!resolved) {
    cached = resolveClaude()
    resolved = true
  }
  return cached
}

function resolveClaude(): string | undefined {
  try {
    const p = execSync('command -v claude', { encoding: 'utf8' }).trim()
    if (p && existsSync(p)) return p
  } catch {
    // not on PATH — fall through to common install locations
  }
  const home = process.env.HOME ?? ''
  const candidates = [
    `${home}/.local/bin/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    `${home}/.npm-global/bin/claude`,
    `${home}/.bun/bin/claude`
  ]
  return candidates.find((p) => existsSync(p))
}
