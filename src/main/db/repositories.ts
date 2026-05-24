import type {
  ActionRecord,
  AppSettings,
  PolicyMode,
  RepoInfo,
  SessionInfo,
  TranscriptMessage
} from '@shared/types'
import type { Db } from './database'

export const DEFAULT_SETTINGS: AppSettings = {
  dryRun: true, // safe by default during bring-up — never hits a live connector
  concurrencyCap: 6,
  defaultModel: 'opus' // a ModelOption id (see main/models.ts)
}

// --- row shapes ------------------------------------------------------------

interface SessionRow {
  id: string
  sdk_session_id: string | null
  title: string
  model: string | null
  cwd: string
  repo_id: string | null
  branch: string | null
  worktree_path: string | null
  status: string
  permission_mode: string
  preset_id: string | null
  total_cost_usd: number
  num_turns: number
  created_at: number
  updated_at: number
  error: string | null
}

interface MessageRow {
  id: string
  session_id: string
  kind: string
  blocks_json: string
  result_subtype: string | null
  cost_usd: number | null
  created_at: number
}

interface ActionRow {
  id: string
  session_id: string | null
  action_type: string
  connector: string
  direction: string
  summary: string
  payload_json: string
  status: string
  decided_by: string | null
  result_json: string | null
  error: string | null
  created_at: number
  decided_at: number | null
}

// --- mappers ---------------------------------------------------------------

function toSession(r: SessionRow): SessionInfo {
  return {
    id: r.id,
    sdkSessionId: r.sdk_session_id,
    title: r.title,
    model: r.model,
    cwd: r.cwd,
    repoId: r.repo_id,
    branch: r.branch,
    worktreePath: r.worktree_path,
    status: r.status as SessionInfo['status'],
    permissionMode: r.permission_mode as SessionInfo['permissionMode'],
    presetId: r.preset_id,
    totalCostUsd: r.total_cost_usd,
    numTurns: r.num_turns,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    error: r.error
  }
}

function toMessage(r: MessageRow): TranscriptMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    kind: r.kind as TranscriptMessage['kind'],
    blocks: JSON.parse(r.blocks_json),
    resultSubtype: r.result_subtype ?? undefined,
    costUsd: r.cost_usd ?? undefined,
    createdAt: r.created_at
  }
}

function toAction(r: ActionRow): ActionRecord {
  return {
    id: r.id,
    sessionId: r.session_id,
    actionType: r.action_type,
    connector: r.connector as ActionRecord['connector'],
    direction: r.direction as ActionRecord['direction'],
    summary: r.summary,
    payload: JSON.parse(r.payload_json),
    status: r.status as ActionRecord['status'],
    decidedBy: (r.decided_by as ActionRecord['decidedBy']) ?? null,
    result: r.result_json ? JSON.parse(r.result_json) : null,
    error: r.error,
    createdAt: r.created_at,
    decidedAt: r.decided_at
  }
}

// --- repositories ----------------------------------------------------------

export class SessionRepo {
  constructor(private db: Db) {}

  insert(s: SessionInfo): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, sdk_session_id, title, model, cwd, repo_id, branch, worktree_path,
           status, permission_mode, preset_id, total_cost_usd, num_turns, created_at, updated_at, error)
         VALUES (@id, @sdkSessionId, @title, @model, @cwd, @repoId, @branch, @worktreePath,
           @status, @permissionMode, @presetId, @totalCostUsd, @numTurns, @createdAt, @updatedAt, @error)`
      )
      .run(s)
  }

  update(id: string, patch: Partial<SessionInfo>): SessionInfo | null {
    const current = this.get(id)
    if (!current) return null
    const next: SessionInfo = { ...current, ...patch, id, updatedAt: Date.now() }
    this.db
      .prepare(
        `UPDATE sessions SET sdk_session_id=@sdkSessionId, title=@title, model=@model, cwd=@cwd,
           repo_id=@repoId, branch=@branch, worktree_path=@worktreePath, status=@status,
           permission_mode=@permissionMode, preset_id=@presetId, total_cost_usd=@totalCostUsd,
           num_turns=@numTurns, updated_at=@updatedAt, error=@error
         WHERE id=@id`
      )
      .run(next)
    return next
  }

  get(id: string): SessionInfo | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
    return row ? toSession(row) : null
  }

  list(): SessionInfo[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as SessionRow[]
    return rows.map(toSession)
  }
}

export class MessageRepo {
  constructor(private db: Db) {}

  insert(m: TranscriptMessage): void {
    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, kind, blocks_json, result_subtype, cost_usd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        m.id,
        m.sessionId,
        m.kind,
        JSON.stringify(m.blocks),
        m.resultSubtype ?? null,
        m.costUsd ?? null,
        m.createdAt
      )
  }

  listBySession(sessionId: string): TranscriptMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as MessageRow[]
    return rows.map(toMessage)
  }
}

export class ActionRepo {
  constructor(private db: Db) {}

  insert(a: ActionRecord): void {
    this.db
      .prepare(
        `INSERT INTO actions (id, session_id, action_type, connector, direction, summary, payload_json,
           status, decided_by, result_json, error, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        a.id,
        a.sessionId,
        a.actionType,
        a.connector,
        a.direction,
        a.summary,
        JSON.stringify(a.payload),
        a.status,
        a.decidedBy,
        a.result ? JSON.stringify(a.result) : null,
        a.error,
        a.createdAt,
        a.decidedAt
      )
  }

  update(id: string, patch: Partial<ActionRecord>): ActionRecord | null {
    const current = this.get(id)
    if (!current) return null
    const next: ActionRecord = { ...current, ...patch, id }
    this.db
      .prepare(
        `UPDATE actions SET status=?, decided_by=?, result_json=?, error=?, decided_at=? WHERE id=?`
      )
      .run(
        next.status,
        next.decidedBy,
        next.result ? JSON.stringify(next.result) : null,
        next.error,
        next.decidedAt,
        id
      )
    return next
  }

  get(id: string): ActionRecord | null {
    const row = this.db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as ActionRow | undefined
    return row ? toAction(row) : null
  }

  list(limit = 200): ActionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM actions ORDER BY created_at DESC LIMIT ?')
      .all(limit) as ActionRow[]
    return rows.map(toAction)
  }
}

export class PolicyRepo {
  constructor(private db: Db) {}

  getModes(): Record<string, PolicyMode> {
    const rows = this.db.prepare('SELECT action_type, mode FROM policies').all() as {
      action_type: string
      mode: string
    }[]
    const out: Record<string, PolicyMode> = {}
    for (const r of rows) out[r.action_type] = r.mode as PolicyMode
    return out
  }

  setMode(actionType: string, mode: PolicyMode): void {
    this.db
      .prepare(
        `INSERT INTO policies (action_type, mode, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(action_type) DO UPDATE SET mode=excluded.mode, updated_at=excluded.updated_at`
      )
      .run(actionType, mode, Date.now())
  }
}

export class SettingsRepo {
  constructor(private db: Db) {}

  get(): AppSettings {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'app'").get() as
      | { value_json: string }
      | undefined
    if (!row) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value_json) as Partial<AppSettings>) }
  }

  set(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.get(), ...patch }
    // Clamp the cap regardless of caller — a runaway value would spawn that many subprocesses.
    next.concurrencyCap = Math.min(32, Math.max(1, Math.floor(next.concurrencyCap)))
    this.db
      .prepare(
        `INSERT INTO settings (key, value_json) VALUES ('app', ?)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`
      )
      .run(JSON.stringify(next))
    return next
  }
}

export class RepoRepo {
  constructor(private db: Db) {}

  add(info: RepoInfo): void {
    this.db
      .prepare(
        `INSERT INTO repos (id, path, name, default_branch, added_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO NOTHING`
      )
      .run(info.id, info.path, info.name, info.defaultBranch, info.addedAt)
  }

  list(): RepoInfo[] {
    const rows = this.db.prepare('SELECT * FROM repos ORDER BY added_at DESC').all() as {
      id: string
      path: string
      name: string
      default_branch: string
      added_at: number
    }[]
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      name: r.name,
      defaultBranch: r.default_branch,
      addedAt: r.added_at
    }))
  }

  getByPath(path: string): RepoInfo | null {
    const r = this.db.prepare('SELECT * FROM repos WHERE path = ?').get(path) as
      | { id: string; path: string; name: string; default_branch: string; added_at: number }
      | undefined
    return r
      ? { id: r.id, path: r.path, name: r.name, defaultBranch: r.default_branch, addedAt: r.added_at }
      : null
  }
}

export interface Repositories {
  sessions: SessionRepo
  messages: MessageRepo
  actions: ActionRepo
  policies: PolicyRepo
  settings: SettingsRepo
  repos: RepoRepo
}

export function createRepositories(db: Db): Repositories {
  return {
    sessions: new SessionRepo(db),
    messages: new MessageRepo(db),
    actions: new ActionRepo(db),
    policies: new PolicyRepo(db),
    settings: new SettingsRepo(db),
    repos: new RepoRepo(db)
  }
}
