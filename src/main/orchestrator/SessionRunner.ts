import type { SessionInfo } from '@shared/types'

export interface PlanDecision {
  approved: boolean
  feedback?: string
}

/**
 * The contract SessionManager drives, independent of which AI engine backs the
 * session — the Claude Agent SDK (AgentSession) or a spawned CLI coding tool
 * (CliSessionRunner). SessionManager only ever calls these.
 */
export interface SessionRunner {
  readonly id: string
  start(prompt: string): void
  resume(prompt: string, fork: boolean): void
  steer(text: string): void
  stop(): void
  markDone(): void
  markLanded(): void
  approvePlan(approved: boolean, feedback?: string): void
  proposePlan(plan: string): Promise<PlanDecision>
  dispose(): void
  applyPinned(pinned: boolean): void
  snapshot(): SessionInfo
  whenDone(): Promise<void>
}
