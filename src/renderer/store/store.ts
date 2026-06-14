import { create } from 'zustand'
import type { IpcEvent } from '@shared/ipc'
import type {
  ActionRecord,
  ActionTypeDef,
  AppSettings,
  LaunchPreset,
  LinearIssue,
  ModelOption,
  PlanApprovalRequest,
  PolicyMode,
  PolicyState,
  RepoInfo,
  SessionInfo,
  SpawnRequest,
  TranscriptMessage
} from '@shared/types'

interface State {
  ready: boolean
  view: 'board' | 'session'
  sessions: Record<string, SessionInfo>
  order: string[]
  selectedId: string | null
  messages: Record<string, TranscriptMessage[]>
  deltas: Record<string, string>
  planRequests: Record<string, PlanApprovalRequest>
  actions: ActionRecord[]
  policyDefs: ActionTypeDef[]
  policy: PolicyState
  settings: AppSettings
  presets: LaunchPreset[]
  repos: RepoInfo[]
  myLinearIssues: LinearIssue[]
  linearLoading: boolean
  linearError: string | null
  models: ModelOption[]

  init: () => Promise<void>
  openBoard: () => void
  select: (id: string) => Promise<void>
  reclaimIdle: () => Promise<number>
  undoLastCommit: (sessionId: string) => Promise<{ undone: boolean; subject?: string; reason?: string }>
  spawn: (req: SpawnRequest) => Promise<SessionInfo>
  steer: (id: string, text: string) => Promise<void>
  stop: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  fork: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  setPinned: (id: string, pinned: boolean) => Promise<void>
  markDone: (id: string) => Promise<void>
  approvePlan: (id: string, approved: boolean, feedback?: string) => Promise<void>
  setPolicyMode: (actionType: string, mode: PolicyMode) => Promise<void>
  setDryRun: (dryRun: boolean) => Promise<void>
  decideAction: (id: string, approve: boolean) => Promise<void>
  addRepo: (path: string) => Promise<void>
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>
  fetchLinearIssues: (force?: boolean) => Promise<void>
  startFromIssue: (issue: LinearIssue, cwd: string) => Promise<void>
}

const MAX_MESSAGES = 1000 // per-session transcript retained in memory (full history in SQLite)
const MAX_ACTIONS = 300 // audit-feed entries retained in memory

const byNewest = (s: Record<string, SessionInfo>): string[] =>
  Object.values(s)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((x) => x.id)

export const useStore = create<State>((set, get) => ({
  ready: false,
  view: 'board',
  sessions: {},
  order: [],
  selectedId: null,
  messages: {},
  deltas: {},
  planRequests: {},
  actions: [],
  policyDefs: [],
  policy: { modes: {}, dryRun: true },
  settings: { dryRun: true, concurrencyCap: 4, defaultModel: 'claude-opus-4-7' },
  presets: [],
  repos: [],
  myLinearIssues: [],
  linearLoading: false,
  linearError: null,
  models: [],

  init: async () => {
    const [list, policy, settings, presets, repos, actions, models] = await Promise.all([
      window.api.invoke('session:list'),
      window.api.invoke('policy:get'),
      window.api.invoke('settings:get'),
      window.api.invoke('presets:list'),
      window.api.invoke('repos:list'),
      window.api.invoke('actions:list', { limit: 200 }),
      window.api.invoke('models:list')
    ])
    const sessions: Record<string, SessionInfo> = {}
    for (const s of list) sessions[s.id] = s
    set({
      ready: true,
      sessions,
      order: byNewest(sessions),
      policyDefs: policy.defs,
      policy: policy.state,
      settings,
      presets,
      repos,
      actions,
      models
    })
    window.api.on((evt) => applyEvent(set, get, evt))
    // Board-first: land on Mission Control, don't auto-drill into a session.
  },

  openBoard: () => set({ view: 'board' }),

  select: async (id) => {
    set({ selectedId: id, view: 'session' })
    const data = await window.api.invoke('session:get', id)
    if (data) {
      set((st) => ({
        sessions: { ...st.sessions, [id]: data.info },
        messages: { ...st.messages, [id]: data.messages }
      }))
    }
  },

  spawn: async (req) => {
    const info = await window.api.invoke('session:spawn', req)
    set((st) => {
      const sessions = { ...st.sessions, [info.id]: info }
      return { sessions, order: byNewest(sessions), selectedId: info.id, view: 'session' as const }
    })
    return info
  },

  steer: async (id, text) => {
    await window.api.invoke('session:steer', { id, text })
  },
  stop: async (id) => {
    await window.api.invoke('session:stop', id)
  },
  resume: async (id) => {
    await window.api.invoke('session:resume', id)
  },
  fork: async (id) => {
    const info = await window.api.invoke('session:fork', id)
    set((st) => {
      const sessions = { ...st.sessions, [info.id]: info }
      return { sessions, order: byNewest(sessions), selectedId: info.id, view: 'session' as const }
    })
  },
  deleteSession: async (id) => {
    // The session:deleted event does the store removal (single source of truth).
    await window.api.invoke('session:delete', id)
  },
  setPinned: async (id, pinned) => {
    const info = await window.api.invoke('session:setPinned', { id, pinned })
    set((st) => ({ sessions: { ...st.sessions, [id]: info } }))
  },
  markDone: async (id) => {
    // The session:updated event moves it to the Done lane.
    await window.api.invoke('session:markDone', id)
  },
  approvePlan: async (id, approved, feedback) => {
    await window.api.invoke('session:approvePlan', { id, approved, feedback })
    set((st) => {
      const planRequests = { ...st.planRequests }
      delete planRequests[id]
      return { planRequests }
    })
  },

  setPolicyMode: async (actionType, mode) => {
    const state = await window.api.invoke('policy:setMode', { actionType, mode })
    set({ policy: state })
  },
  setDryRun: async (dryRun) => {
    const state = await window.api.invoke('policy:setDryRun', dryRun)
    set((st) => ({ policy: state, settings: { ...st.settings, dryRun } }))
  },
  decideAction: async (id, approve) => {
    await window.api.invoke('actions:decide', { id, approve })
  },
  addRepo: async (path) => {
    const repo = await window.api.invoke('repos:add', path)
    set((st) => ({ repos: [repo, ...st.repos.filter((r) => r.id !== repo.id)] }))
  },
  patchSettings: async (patch) => {
    const settings = await window.api.invoke('settings:set', patch)
    set({ settings })
  },
  reclaimIdle: async () => window.api.invoke('session:reclaimIdle'),
  undoLastCommit: async (sessionId) => window.api.invoke('git:undoLastCommit', { sessionId }),
  fetchLinearIssues: async (force) => {
    set({ linearLoading: true, linearError: null })
    try {
      const issues = await window.api.invoke('linear:myIssues', { force: Boolean(force) })
      set({ myLinearIssues: issues, linearLoading: false })
    } catch (e) {
      set({ linearLoading: false, linearError: e instanceof Error ? e.message : String(e) })
    }
  },
  startFromIssue: async (issue, cwd) => {
    await get().spawn({
      prompt: `${issue.identifier} — ${issue.title}\n\n${issue.description ?? ''}`.trim(),
      cwd,
      presetId: 'build',
      title: `${issue.identifier} ${issue.title}`.slice(0, 80),
      linearIssueId: issue.id,
      notionPageId: extractNotionUrl(issue.description),
      branchName: issue.branchName,
      useWorktree: true
    })
  }
}))

/** Pull a Notion page URL out of an issue description so lifecycle updates can
 *  keep the linked spec current too. */
function extractNotionUrl(text?: string): string | undefined {
  if (!text) return undefined
  const m = text.match(/https?:\/\/(?:www\.)?notion\.so\/[^\s)]+/i)
  return m?.[0]
}

function applyEvent(
  set: (fn: (st: State) => Partial<State>) => void,
  _get: () => State,
  evt: IpcEvent
): void {
  switch (evt.channel) {
    case 'session:updated': {
      const s = evt.payload
      set((st) => {
        const sessions = { ...st.sessions, [s.id]: s }
        return { sessions, order: byNewest(sessions) }
      })
      break
    }
    case 'session:deleted': {
      const { id } = evt.payload
      set((st) => {
        const sessions = { ...st.sessions }
        delete sessions[id]
        const messages = { ...st.messages }
        delete messages[id]
        const deltas = { ...st.deltas }
        delete deltas[id]
        const planRequests = { ...st.planRequests }
        delete planRequests[id]
        const next: Partial<State> = {
          sessions,
          order: st.order.filter((x) => x !== id),
          messages,
          deltas,
          planRequests
        }
        if (st.selectedId === id) {
          next.selectedId = null
          next.view = 'board'
        }
        return next
      })
      break
    }
    case 'session:message': {
      const m = evt.payload
      set((st) => {
        const arr = st.messages[m.sessionId] ?? []
        const next = [...arr, m]
        // Cap retained transcript in memory; full history stays in SQLite.
        return {
          messages: { ...st.messages, [m.sessionId]: next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next },
          deltas: { ...st.deltas, [m.sessionId]: '' }
        }
      })
      break
    }
    case 'session:delta': {
      const { sessionId, text } = evt.payload
      set((st) => ({ deltas: { ...st.deltas, [sessionId]: (st.deltas[sessionId] ?? '') + text } }))
      break
    }
    case 'session:planRequest': {
      const p = evt.payload
      set((st) => ({ planRequests: { ...st.planRequests, [p.sessionId]: p } }))
      break
    }
    case 'action:created':
    case 'action:updated': {
      const a = evt.payload
      set((st) => {
        const exists = st.actions.some((x) => x.id === a.id)
        const merged = exists ? st.actions.map((x) => (x.id === a.id ? a : x)) : [a, ...st.actions]
        return { actions: merged.length > MAX_ACTIONS ? merged.slice(0, MAX_ACTIONS) : merged }
      })
      break
    }
    case 'policy:updated': {
      set(() => ({ policy: evt.payload }))
      break
    }
    default:
      break
  }
}
