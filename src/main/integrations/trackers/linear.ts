import type { TrackerItem, TrackerProvider } from './types'
import { LinearService, SdkLinearReader } from '../LinearService'

/**
 * Default tracker provider — drives Linear through the Linear MCP connector via
 * a tightly-scoped headless Agent SDK run (no separate Linear token).
 *
 * The interesting work is in LinearService; this class is purely an adapter
 * onto the TrackerProvider shape so the orchestrator can talk to *any* tracker
 * uniformly.
 */
export class LinearTracker implements TrackerProvider {
  readonly id = 'linear'
  readonly label = 'Linear'
  private readonly svc = new LinearService(new SdkLinearReader())

  async listMyItems(): Promise<TrackerItem[]> {
    const items = await this.svc.listMyIssues()
    // Stamp the provenance so the UI / lifecycle automation can attribute the
    // item to the right tracker if there's ever more than one wired up.
    return items.map((i) => ({ ...i, providerId: 'linear' }))
  }

  async isAvailable(): Promise<boolean> {
    // The user's Linear MCP connector is what makes this work; we don't probe
    // here (a probe costs a subprocess). The first listMyItems() call will
    // surface a real error if the connector isn't configured.
    return true
  }
}
