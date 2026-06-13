import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CIProvider } from './types'
import { GithubActionsProvider } from './github'

/**
 * Built-in CI provider catalogue. GitHub Actions ships as the default; add
 * another (GitLab CI, CircleCI, Jenkins, Buildkite, …) by implementing
 * CIProvider and adding a factory here. Select via ~/.multitasker/ci.json:
 *   { "active": "<your-id>" }
 */
const BUILTINS: Record<string, () => CIProvider> = {
  'github-actions': () => new GithubActionsProvider()
  // 'gitlab-ci': () => new GitlabCIProvider(),
  // circleci:    () => new CircleCIProvider(),
}

const DEFAULT_PROVIDER_ID = 'github-actions'

function readActive(): string {
  try {
    const path = join(homedir(), '.multitasker', 'ci.json')
    if (!existsSync(path)) return DEFAULT_PROVIDER_ID
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const active = raw && typeof raw === 'object' ? (raw as { active?: string }).active : undefined
    return active && BUILTINS[active] ? active : DEFAULT_PROVIDER_ID
  } catch {
    return DEFAULT_PROVIDER_ID
  }
}

export function getActiveCIProvider(): CIProvider {
  return (BUILTINS[readActive()] ?? BUILTINS[DEFAULT_PROVIDER_ID])()
}

export function listCIProviderIds(): string[] {
  return Object.keys(BUILTINS)
}
