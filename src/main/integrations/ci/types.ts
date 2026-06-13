import type { CIRun } from '@shared/types'

/**
 * CI/CD providers — the pluggable "pipeline status" layer, mirroring the
 * tracker providers. GitHub Actions ships as the default; GitLab CI, CircleCI,
 * Jenkins, Buildkite, etc. plug in by implementing this interface and being
 * registered in `./registry.ts`. The orchestrator/UI talk only to CIProvider.
 */
export interface CIProvider {
  readonly id: string
  readonly label: string
  /** Recent runs for the repo at `cwd`. Fail-soft: return [] rather than throw. */
  listRecentRuns(cwd: string): Promise<CIRun[]>
  isAvailable(): Promise<boolean>
}

export type { CIRun }
