// The single typed seam between the renderer (UI) and the main-process orchestrator.
// Request/response channels go through ipcRenderer.invoke -> ipcMain.handle.
// Streaming server->client events are multiplexed over one 'app:event' channel.

import type {
  ActionRecord,
  AppSettings,
  CommitResult,
  DiffFile,
  FileContent,
  FileEntry,
  LaunchPreset,
  LinearIssue,
  ModelOption,
  PlanApprovalRequest,
  PolicyMode,
  PolicyState,
  ActionTypeDef,
  RepoInfo,
  SessionInfo,
  SpawnRequest,
  TranscriptMessage
} from './types'

/** Renderer -> Main request/response API. Each entry: (payload) => result. */
export interface IpcApi {
  // Sessions / orchestration
  'session:spawn': (req: SpawnRequest) => SessionInfo
  'session:list': () => SessionInfo[]
  'session:get': (id: string) => { info: SessionInfo; messages: TranscriptMessage[] } | null
  'session:steer': (args: { id: string; text: string }) => void
  'session:stop': (id: string) => void
  'session:resume': (id: string) => SessionInfo
  'session:fork': (id: string) => SessionInfo
  'session:approvePlan': (args: { id: string; approved: boolean; feedback?: string }) => void

  // Code traversal / review (scoped to a session's cwd/worktree)
  'fs:readDir': (args: { sessionId: string; relPath: string }) => FileEntry[]
  'fs:readFile': (args: { sessionId: string; relPath: string }) => FileContent
  'git:diff': (args: { sessionId: string }) => DiffFile[]
  'git:commit': (args: { sessionId: string; message: string }) => CommitResult

  // Policy engine
  'policy:get': () => { defs: ActionTypeDef[]; state: PolicyState }
  'policy:setMode': (args: { actionType: string; mode: PolicyMode }) => PolicyState
  'policy:setDryRun': (dryRun: boolean) => PolicyState

  // Actions / audit log / approval queue
  'actions:list': (args: { limit?: number }) => ActionRecord[]
  'actions:decide': (args: { id: string; approve: boolean }) => ActionRecord

  // Presets / settings / repos
  // Linear inbox
  'linear:myIssues': () => LinearIssue[]

  // Models
  'models:list': () => ModelOption[]

  'presets:list': () => LaunchPreset[]
  'settings:get': () => AppSettings
  'settings:set': (patch: Partial<AppSettings>) => AppSettings
  'repos:add': (path: string) => RepoInfo
  'repos:list': () => RepoInfo[]
}

export type IpcChannel = keyof IpcApi
export type IpcPayload<C extends IpcChannel> = Parameters<IpcApi[C]>[0]
export type IpcResult<C extends IpcChannel> = ReturnType<IpcApi[C]>

/** Main -> Renderer streaming events (multiplexed over 'app:event'). */
export type IpcEvent =
  | { channel: 'session:updated'; payload: SessionInfo }
  | { channel: 'session:message'; payload: TranscriptMessage }
  | { channel: 'session:delta'; payload: { sessionId: string; text: string } }
  | { channel: 'session:planRequest'; payload: PlanApprovalRequest }
  | { channel: 'action:created'; payload: ActionRecord }
  | { channel: 'action:updated'; payload: ActionRecord }
  | { channel: 'policy:updated'; payload: PolicyState }

export type IpcEventChannel = IpcEvent['channel']
export type IpcEventPayload<C extends IpcEventChannel> = Extract<IpcEvent, { channel: C }>['payload']

export const EVENT_CHANNEL = 'app:event' as const
