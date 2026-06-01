/**
 * Tracker providers — the pluggable "project management" layer.
 *
 * Multitasker ships with Linear as the default tracker. Anything that walks like
 * a tracker (Jira, GitHub Projects, ClickUp, Shortcut, Asana, a Notion database)
 * can plug in by implementing this interface and being registered in
 * `./registry.ts`. The orchestrator and the UI talk only to TrackerProvider —
 * they never reach into Linear-specific code directly.
 *
 * The data shape (`TrackerItem`) is intentionally minimal + generic. Provider
 * implementations adapt their domain object (Linear issue, Jira issue, GH
 * project card) onto it.
 */

import type { TrackerItem } from '@shared/types'

export interface TrackerProvider {
  /** Stable id used in config / IPC. Lower-kebab. */
  readonly id: string
  /** Human label for the UI ("Linear", "Jira", "GitHub Projects"). */
  readonly label: string
  /** Items relevant to the current user (typically "assigned to me, not done"). */
  listMyItems(): Promise<TrackerItem[]>
  /** True if this provider can run in the user's environment (e.g. connector
   *  configured). Implementations should fail-soft and return false on errors. */
  isAvailable(): Promise<boolean>
}

export type { TrackerItem }
