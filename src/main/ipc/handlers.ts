import { ipcMain } from 'electron'
import type { IpcApi, IpcChannel, IpcPayload, IpcResult } from '@shared/ipc'
import { ACTION_TYPES } from '../integrations/actionTypes'
import type { ActionService } from '../integrations/ActionService'
import type { LinearService } from '../integrations/LinearService'
import type { EventBus } from '../events'
import type { Repositories } from '../db/repositories'
import type { SessionManager } from '../orchestrator/SessionManager'
import type { WorktreeManager } from '../git/Worktrees'
import { commitAll, computeDiff, readRepoMeta, undoLastCommit } from '../git/Worktrees'
import { listDir, readFileScoped } from '../fs/fsAccess'
import { getPreset, loadWorkflows } from '../skills/launchPresets'
import { listModels } from '../models'

export interface AppContext {
  repos: Repositories
  bus: EventBus
  sessions: SessionManager
  actions: ActionService
  worktrees: WorktreeManager
  linear: LinearService
}

export function registerIpcHandlers(ctx: AppContext): void {
  const handle = <C extends IpcChannel>(
    channel: C,
    fn: (payload: IpcPayload<C>) => IpcResult<C> | Promise<IpcResult<C>>
  ): void => {
    ipcMain.handle(channel, (_event, payload) => fn(payload as IpcPayload<C>))
  }

  const cwdFor = (sessionId: string): string => {
    const info = ctx.repos.sessions.get(sessionId)
    if (!info) throw new Error(`session not found: ${sessionId}`)
    return info.cwd
  }

  // Sessions / orchestration
  handle('session:spawn', (req) => ctx.sessions.spawn(req))
  handle('session:list', () => ctx.sessions.list())
  handle('session:get', (id) => ctx.sessions.get(id))
  handle('session:steer', ({ id, text }) => ctx.sessions.steer(id, text))
  handle('session:stop', (id) => ctx.sessions.stop(id))
  handle('session:resume', (id) => ctx.sessions.resume(id))
  handle('session:fork', (id) => ctx.sessions.fork(id))
  handle('session:approvePlan', ({ id, approved, feedback }) => ctx.sessions.approvePlan(id, approved, feedback))
  handle('session:reclaimIdle', () => ctx.sessions.reclaimIdle())

  // Code traversal / review
  handle('fs:readDir', ({ sessionId, relPath }) => listDir(cwdFor(sessionId), relPath))
  handle('fs:readFile', ({ sessionId, relPath }) => readFileScoped(cwdFor(sessionId), relPath))
  handle('git:diff', ({ sessionId }) => computeDiff(cwdFor(sessionId)))
  handle('git:commit', async ({ sessionId, message }) => {
    const info = ctx.repos.sessions.get(sessionId)
    if (!info) throw new Error(`session not found: ${sessionId}`)
    const result = await commitAll(info.cwd, message)
    if (result.committed && getPreset(info.presetId ?? undefined)?.isBuildPipeline) {
      ctx.sessions.markLanded(sessionId)
    }
    return result
  })
  handle('git:undoLastCommit', ({ sessionId }) => {
    const info = ctx.repos.sessions.get(sessionId)
    if (!info) throw new Error(`session not found: ${sessionId}`)
    return undoLastCommit(info.cwd)
  })

  // Policy engine
  handle('policy:get', () => ({ defs: ACTION_TYPES, state: ctx.actions.policyState() }))
  handle('policy:setMode', ({ actionType, mode }) => ctx.actions.setMode(actionType, mode))
  handle('policy:setDryRun', (dryRun) => ctx.actions.setDryRun(dryRun))

  // Actions / audit log / approval queue
  handle('actions:list', ({ limit }) => ctx.actions.list(limit))
  handle('actions:decide', ({ id, approve }) => ctx.actions.decide(id, approve))

  // Linear inbox
  handle('linear:myIssues', () => ctx.linear.listMyIssues())

  // Models
  handle('models:list', () => listModels(ctx.repos.settings.get()))

  // Presets / settings / repos
  handle('presets:list', () => loadWorkflows())
  handle('settings:get', () => ctx.repos.settings.get())
  handle('settings:set', (patch) => ctx.repos.settings.set(patch))
  handle('repos:add', async (path) => {
    const existing = ctx.repos.repos.getByPath(path)
    if (existing) return existing
    const info = await readRepoMeta(path)
    ctx.repos.repos.add(info)
    return ctx.repos.repos.getByPath(path) ?? info
  })
  handle('repos:list', () => ctx.repos.repos.list())
}

// Re-exported so callers don't import the type indirectly.
export type { IpcApi }
