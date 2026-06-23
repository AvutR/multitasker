import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ENGINES, type EngineId, type EngineInfo } from '@shared/engines'

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
