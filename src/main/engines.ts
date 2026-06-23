import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ENGINES, engineSpec, type EngineId, type EngineInfo, type EngineProtocol } from '@shared/engines'

// A packaged GUI app inherits a minimal PATH (no ~/.local/bin, no Homebrew), so
// resolve CLI engines against the usual install dirs explicitly — both to DETECT
// them and to spawn them by absolute path later.
const EXTRA_DIRS = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

/** Absolute path to a CLI binary, scanning PATH + the usual install dirs, or null. */
export function resolveEngineBin(bin: string): string | null {
  const dirs = [...(process.env.PATH?.split(':').filter(Boolean) ?? []), ...EXTRA_DIRS]
  for (const dir of dirs) {
    const candidate = join(dir, bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Engine specs annotated with availability on this machine (claude is always on,
 *  via the SDK; CLI engines are available iff their binary resolves). */
export function detectEngines(): EngineInfo[] {
  return ENGINES.map((spec) => ({
    ...spec,
    available: spec.kind === 'sdk' ? true : Boolean(spec.bin && resolveEngineBin(spec.bin))
  }))
}

/** The resolved binary path for a CLI engine, or null (sdk engine / not installed). */
export function engineBinPath(id: EngineId): string | null {
  const spec = ENGINES.find((e) => e.id === id)
  return spec?.kind === 'cli' && spec.bin ? resolveEngineBin(spec.bin) : null
}

export function engineProtocol(id: EngineId): EngineProtocol {
  return engineSpec(id).protocol
}

export interface EngineCommandOpts {
  prompt: string
  cwd: string
  model?: string | null
  /** The tool's prior session id, to continue context on a steer/resume. */
  resumeId?: string | null
}

/**
 * Build the argv to run one headless turn of a CLI engine. Flags chosen for
 * non-interactive use: stream parseable output, auto-approve within the session's
 * (worktree) cwd, and continue the prior session when resuming.
 */
export function engineCommand(id: EngineId, o: EngineCommandOpts): { args: string[]; env?: Record<string, string> } {
  const model = o.model && o.model !== 'auto' ? o.model : null
  switch (id) {
    case 'cursor': {
      const args = ['--print', '--output-format', 'stream-json', '--force', '--trust']
      if (model) args.push('--model', model)
      if (o.resumeId) args.push('--resume', o.resumeId)
      args.push(o.prompt) // prompt is the trailing positional
      return { args }
    }
    case 'codex': {
      const args = ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-C', o.cwd]
      if (model) args.push('-m', model)
      args.push(o.prompt)
      return { args }
    }
    case 'gemini':
      return { args: model ? ['-m', model, '-p', o.prompt] : ['-p', o.prompt] }
    case 'aider': {
      const args = ['--message', o.prompt, '--yes-always', '--no-auto-commits']
      if (model) args.push('--model', model)
      return { args }
    }
    default:
      return { args: [o.prompt] }
  }
}
