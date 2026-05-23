// Domain types shared across the Electron main (orchestrator) and renderer (UI).
// Everything here must be structured-clone-serializable — it crosses the IPC seam.

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionStatus =
  | 'queued' // spawned but waiting on the concurrency cap
  | 'running' // actively streaming from the SDK
  | 'awaiting_plan_approval' // emitted a plan, blocked on human approve/reject
  | 'awaiting_input' // finished a turn, idle, ready to be steered
  | 'landed' // /build preset reached a verified local commit
  | 'completed' // run finished successfully (non-build)
  | 'error'
  | 'stopped'

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface SessionInfo {
  id: string // stable local UUID — primary key in DB and UI
  sdkSessionId: string | null // the SDK's own session_id (from the init message), used for resume/fork
  title: string
  model: string | null
  cwd: string
  repoId: string | null
  branch: string | null
  worktreePath: string | null
  status: SessionStatus
  permissionMode: PermissionMode
  presetId: string | null
  totalCostUsd: number
  numTurns: number
  createdAt: number
  updatedAt: number
  error: string | null
}

// ---------------------------------------------------------------------------
// Transcript (streamed agent output, persisted in UI-friendly shape)
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text'
  text: string
}
export interface ThinkingBlock {
  type: 'thinking'
  text: string
}
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}
export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  text: string
  isError: boolean
}
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock

export type TranscriptKind = 'assistant' | 'user' | 'system' | 'result'

export interface TranscriptMessage {
  id: string
  sessionId: string
  kind: TranscriptKind
  blocks: ContentBlock[]
  // For 'result' messages:
  resultSubtype?: string
  costUsd?: number
  createdAt: number
}

export interface PlanApprovalRequest {
  sessionId: string
  plan: string
  requestedAt: number
}

// ---------------------------------------------------------------------------
// Integrations & the policy engine
// ---------------------------------------------------------------------------

export type Connector = 'slack' | 'notion' | 'linear' | 'github'
export type ActionDirection = 'internal_bookkeeping' | 'outward_post'

/** AUTO = fire immediately · APPROVE = one-click human gate · OFF = never fire. */
export type PolicyMode = 'auto' | 'approve' | 'off'

export interface ActionTypeDef {
  id: string // e.g. 'linear.status_update'
  connector: Connector
  direction: ActionDirection
  label: string
  description: string
  defaultPolicy: PolicyMode
  /** false => hard-disabled regardless of policy (e.g. github.pr_create under the no-remote constraint). */
  enabled: boolean
}

export type ActionStatus =
  | 'fired' // executed against the real connector
  | 'pending' // queued for one-click approval
  | 'dry_run' // recorded intent only, connector never called
  | 'rejected' // human rejected a pending action
  | 'dropped' // policy OFF / disabled — never executed
  | 'failed' // connector call threw

export type ActionDecidedBy = 'auto' | 'user' | 'dry_run' | 'policy_off' | 'policy_disabled'

export interface ActionRecord {
  id: string
  sessionId: string | null
  actionType: string
  connector: Connector
  direction: ActionDirection
  summary: string // human-readable one-liner for the activity feed
  payload: unknown // the rendered payload that would hit the connector
  status: ActionStatus
  decidedBy: ActionDecidedBy | null
  result: unknown
  error: string | null
  createdAt: number
  decidedAt: number | null
}

export interface PolicyState {
  modes: Record<string, PolicyMode> // action_type -> mode (overrides over defaults)
  dryRun: boolean
}

// ---------------------------------------------------------------------------
// Presets, settings, repos, files, diffs
// ---------------------------------------------------------------------------

export interface LaunchPreset {
  id: string
  name: string
  description: string
  systemPromptAppend: string
  permissionMode: PermissionMode
  /** Optional per-preset policy overrides applied when a session launches with this preset. */
  policyProfile?: Record<string, PolicyMode>
  /** When true, the session is spawned in an isolated git worktree on a fresh branch. */
  useWorktree: boolean
  /** Marks the preset as the team /build pipeline so the UI surfaces its gates. */
  isBuildPipeline?: boolean
}

export interface SpawnRequest {
  prompt: string
  cwd: string
  presetId?: string
  model?: string
  permissionMode?: PermissionMode
  useWorktree?: boolean
  title?: string
}

export interface AppSettings {
  dryRun: boolean
  concurrencyCap: number
  defaultModel: string
}

export interface RepoInfo {
  id: string
  path: string
  name: string
  defaultBranch: string
  addedAt: number
}

export interface FileEntry {
  name: string
  relPath: string
  isDir: boolean
}

export interface FileContent {
  relPath: string
  content: string
  language: string
  truncated: boolean
}

export type DiffStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface DiffFile {
  relPath: string
  status: DiffStatus
  additions: number
  deletions: number
  oldContent: string
  newContent: string
}

export interface CommitResult {
  committed: boolean
  hash?: string
  /** Why a commit was refused (e.g. failing gate, nothing staged). */
  reason?: string
}
