import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TrackerProvider } from './types'
import { LinearTracker } from './linear'

/**
 * Built-in provider catalogue. Linear ships as the default; add another by:
 *
 *   1. Write a class that implements TrackerProvider (see ./linear.ts — it's
 *      tiny: id, label, listMyItems, isAvailable).
 *   2. Add a factory entry here keyed by your provider id.
 *   3. (Optional) Put `{ "active": "<your-id>" }` in ~/.multitasker/trackers.json
 *      to make it the default.
 */
const BUILTINS: Record<string, () => TrackerProvider> = {
  linear: () => new LinearTracker()
  // jira:   () => new JiraTracker(),           // ← template at ./_template.ts.txt
  // 'github-projects': () => new GithubProjectsTracker(),
}

const DEFAULT_PROVIDER_ID = 'linear'

interface TrackersConfig {
  /** Provider id to make active. Falls back to 'linear' if missing/unknown. */
  active?: string
}

function configPath(): string {
  return join(homedir(), '.multitasker', 'trackers.json')
}

function readConfig(): TrackersConfig {
  try {
    const path = configPath()
    if (!existsSync(path)) return {}
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return raw && typeof raw === 'object' ? (raw as TrackersConfig) : {}
  } catch {
    return {} // a malformed file never breaks the app
  }
}

/** The active tracker provider — Linear unless overridden in trackers.json. */
export function getActiveTracker(): TrackerProvider {
  const id = readConfig().active ?? DEFAULT_PROVIDER_ID
  return (BUILTINS[id] ?? BUILTINS[DEFAULT_PROVIDER_ID])()
}

/** Catalogue of registered provider ids — for diagnostics / future config UI. */
export function listProviderIds(): string[] {
  return Object.keys(BUILTINS)
}
