import { create } from 'zustand'
import type { IpcEvent } from '@shared/ipc'
import type {
  ActionRecord,
  ActionTypeDef,
  AppSettings,
  LaunchPreset,
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

  init: () => Promise<void>
  select: (id: string) => Promise<void>
  spawn: (req: SpawnRequest) => Promise<SessionInfo>
  steer: (id: string, text: string) => Promise<void>
  stop: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  fork: (id: string) => Promise<void>
  approvePlan: (id: string, approved: boolean, feedback?: string) => Promise<void>
  setPolicyMode: (actionType: string, mode: PolicyMode) => Promise<void>
  setDryRun: (dryRun: boolean) => Promise<void>
  decideAction: (id: string, approve: boolean) => Promise<void>
  addRepo: (path: string) => Promise<void>
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>
}

const MAX_MESSAGES = 1000 // per-session transcript retained in memory (full history in SQLite)
const MAX_ACTIONS = 300 // audit-feed entries retained in memory

const byNewest = (s: Record<string, SessionInfo>): string[] =>
  Object.values(s)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((x) => x.id)

export const useStore = create<State>((set, get) => ({
  ready: false,
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

  init: async () => {
    const [list, policy, settings, presets, repos, actions] = await Promise.all([
      window.api.invoke('session:list'),
      window.api.invoke('policy:get'),
      window.api.invoke('settings:get'),
      window.api.invoke('presets:list'),
      window.api.invoke('repos:list'),
      window.api.invoke('actions:list', { limit: 200 })
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
      actions
    })
    window.api.on((evt) => applyEvent(set, get, evt))
    if (!get().selectedId && list[0]) void get().select(list[0].id)
  },

  select: async (id) => {
    set({ selectedId: id })
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
      return { sessions, order: byNewest(sessions), selectedId: info.id }
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
      return { sessions, order: byNewest(sessions), selectedId: info.id }
    })
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
  }
}))

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
