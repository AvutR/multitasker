import type { ActionTypeDef, PolicyMode } from '@shared/types'

export type PolicyEffect = 'fire' | 'queue' | 'dry_run' | 'drop'

export interface PolicyDecision {
  effect: PolicyEffect
  decidedBy: 'auto' | 'user' | 'dry_run' | 'policy_off' | 'policy_disabled'
  reason: string
}

/**
 * The single source of truth for whether an action fires, queues for
 * approval, dry-runs, or drops. Pure and total — both enforcement paths
 * (the semantic MCP tools and the raw-tool guard) call this.
 *
 * Precedence (most decisive first):
 *   1. disabled type      -> drop (never possible in this build)
 *   2. mode OFF           -> drop (would not fire either way)
 *   3. global dry-run ON  -> dry_run (record intent, never call the connector)
 *   4. mode AUTO          -> fire
 *   5. mode APPROVE       -> queue (one-click human gate)
 */
export function decidePolicy(def: ActionTypeDef, mode: PolicyMode, dryRun: boolean): PolicyDecision {
  if (!def.enabled) {
    return { effect: 'drop', decidedBy: 'policy_disabled', reason: `${def.id} is disabled in this build` }
  }
  if (mode === 'off') {
    return { effect: 'drop', decidedBy: 'policy_off', reason: 'policy is OFF for this action type' }
  }
  if (dryRun) {
    return {
      effect: 'dry_run',
      decidedBy: 'dry_run',
      reason: 'global dry-run is ON — intent recorded, connector not called'
    }
  }
  if (mode === 'auto') {
    return { effect: 'fire', decidedBy: 'auto', reason: 'policy is AUTO' }
  }
  return { effect: 'queue', decidedBy: 'user', reason: 'policy is APPROVE — awaiting one-click approval' }
}

/** Effective mode for an action type: per-action override, else the type's default. */
export function effectiveMode(def: ActionTypeDef, overrides: Record<string, PolicyMode>): PolicyMode {
  return overrides[def.id] ?? def.defaultPolicy
}
