import type { ActionStatus, SessionStatus } from '@shared/types'

export const STATUS_META: Record<SessionStatus, { label: string; color: string }> = {
  queued: { label: 'Queued', color: '#8a93a6' },
  running: { label: 'Running', color: '#6ea8fe' },
  awaiting_plan_approval: { label: 'Plan review', color: '#f5c451' },
  awaiting_input: { label: 'Idle', color: '#5bd4a4' },
  landed: { label: 'Landed', color: '#5bd4a4' },
  completed: { label: 'Done', color: '#7e8796' },
  error: { label: 'Error', color: '#f06d6d' },
  stopped: { label: 'Stopped', color: '#7e8796' }
}

export const ACTION_STATUS_META: Record<ActionStatus, { label: string; color: string }> = {
  fired: { label: 'Fired', color: '#5bd4a4' },
  pending: { label: 'Awaiting approval', color: '#f5c451' },
  dry_run: { label: 'Dry-run', color: '#6ea8fe' },
  rejected: { label: 'Rejected', color: '#f06d6d' },
  dropped: { label: 'Dropped', color: '#7e8796' },
  failed: { label: 'Failed', color: '#f06d6d' }
}

export function StatusDot({ status }: { status: SessionStatus }) {
  const meta = STATUS_META[status]
  const pulse = status === 'running' || status === 'awaiting_plan_approval'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-2 w-2 rounded-full ${pulse ? 'animate-pulse' : ''}`}
        style={{ background: meta.color }}
      />
      <span className="text-xs font-medium" style={{ color: meta.color }}>
        {meta.label}
      </span>
    </span>
  )
}

export function formatCost(usd: number): string {
  if (!usd) return '$0.00'
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

export function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ background: '#181c26', color: color ?? '#8a93a6', border: '1px solid #222734' }}
    >
      {children}
    </span>
  )
}

export function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
