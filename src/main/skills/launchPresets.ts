import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { LaunchPreset, PermissionMode, PolicyMode } from '@shared/types'
import { ACTION_TYPE_BY_ID } from '../integrations/actionTypes'

// Appended to every session's system prompt. Together with
// settingSources:['user','project','local'] (which loads whatever skills/agents
// the user has installed in Claude Code), this is what makes skills the default
// way work gets done — the app ships no skills of its own.
const SKILLS_DEFAULT = `
You are running inside Multitasker, an orchestrator for many parallel Claude Code agents.

Operating principles:
- USE YOUR INSTALLED CLAUDE CODE SKILLS BY DEFAULT, PROACTIVELY. Recognize what the task needs and invoke the matching skill yourself instead of waiting for a slash command. Prefer a skill over doing the work by hand.
- Build deep, not shallow — cover the long tail of a workflow, not just the happy path.
- Keep your trackers current as you work. When you start, finish, or block on work, update the relevant issue status, post a progress comment, and update the spec/doc — ALWAYS through the Multitasker integration tools (they route through the approval policy and are audited). Do NOT call raw connector tools directly when a Multitasker tool exists. Do NOT post to Slack unless explicitly asked.
- Production first: if prod is broken or data looks off, that beats any feature.
`.trim()

const BUILD_PIPELINE = `${SKILLS_DEFAULT}

You are executing a build workflow. Drive it yourself — only hand back at the plan gate:
1. PLAN first, then present the plan. Presenting the plan triggers Multitasker's plan-approval gate — stop and wait for approval before writing code.
2. Implement the approved plan, with integration tests at the OUTERMOST layer (API/task level), not helper unit tests.
3. Simplify the changes — strip dead code and needless abstraction.
4. Run the full test suite. Do not proceed until it is green.
5. Run a security review of the diff. Fix blocking findings before landing.
6. Land a verified LOCAL commit.

Throughout, keep your issue tracker and any linked spec/doc current via the Multitasker integration tools.`

/** Neutral, generic built-in workflows. Users add their own via ~/.multitasker/workflows.json. */
export const BUILTIN_PRESETS: LaunchPreset[] = [
  {
    id: 'build',
    name: 'Build pipeline',
    description: 'Plan → code → simplify → test → security review → land a local commit, using your installed skills.',
    systemPromptAppend: BUILD_PIPELINE,
    permissionMode: 'plan',
    useWorktree: true,
    isBuildPipeline: true
  },
  {
    id: 'explore',
    name: 'Explore / freeform',
    description: 'A general agent with your skills and the integration tools wired in. Fully steerable.',
    systemPromptAppend: SKILLS_DEFAULT,
    permissionMode: 'default',
    useWorktree: false
  },
  {
    id: 'standup',
    name: 'Async standup',
    description: 'Summarize progress and post an async standup (blockers / done / pending / testable) to Slack via the policy engine.',
    systemPromptAppend: `${SKILLS_DEFAULT}

Your job: produce a crisp async standup — blockers / done / pending / what is testable — and post it with the post_standup tool. Keep it short and skimmable.`,
    permissionMode: 'default',
    useWorktree: false
  },
  {
    id: 'conduct',
    name: 'Conductor (orchestrator)',
    description: 'A high-power orchestrator that decomposes the goal, fans work out to cheaper parallel sub-agents, then synthesizes. Run it on a strong model.',
    systemPromptAppend: `${SKILLS_DEFAULT}

You are the CONDUCTOR — a high-power orchestrator. Your value is decomposition, coordination, and synthesis, NOT doing every piece yourself.

How to work:
1. Think first. Break the goal into the smallest set of INDEPENDENT sub-tasks that can run in parallel without stepping on each other.
2. For each independent sub-task, call delegate_subtask with a self-contained prompt. Sub-agents run on a CHEAPER model, in parallel, in this same repo — so write prompts that don't assume shared memory. Prefer many small, well-scoped delegations over one big one.
3. Do the cheap/sequential coordination yourself; delegate the bulk work. Don't burn your expensive context re-doing what a sub-agent can.
4. Poll list_subtasks to see each sub-agent's status and latest output. Wait for the pieces you depend on before synthesizing.
5. Synthesize: integrate the sub-agents' work, resolve conflicts, run the final tests/review, and land the result. Keep the issue tracker current via the Multitasker tools.

Delegate genuinely independent work in parallel; keep tight dependencies for yourself.`,
    permissionMode: 'default',
    useWorktree: true
  },
  {
    id: 'tracker-sync',
    name: 'Issue tracker sync',
    description: 'Review recent work and bring your issue tracker up to date — statuses, progress comments, and a weekly project update.',
    systemPromptAppend: `${SKILLS_DEFAULT}

Your job: reconcile your issue tracker with reality. Update issue statuses, post progress comments, and write a weekly per-project update using the Multitasker tools, then summarize what you changed.`,
    permissionMode: 'default',
    useWorktree: false
  }
]

export const DEFAULT_PRESET_ID = 'explore'

const MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']

/** Path to the user's importable workflow definitions. */
export function userWorkflowsPath(): string {
  return join(homedir(), '.multitasker', 'workflows.json')
}

/** Built-in workflows merged with the user's imported ones (user overrides by id). */
export function loadWorkflows(): LaunchPreset[] {
  const byId = new Map(BUILTIN_PRESETS.map((p) => [p.id, p]))
  for (const w of readUserWorkflows()) byId.set(w.id, w)
  return [...byId.values()]
}

function readUserWorkflows(): LaunchPreset[] {
  const path = userWorkflowsPath()
  try {
    ensureExample(path)
    if (!existsSync(path)) return []
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(raw)) return []
    return raw.filter(isValidWorkflow).map(normalizeWorkflow)
  } catch {
    return [] // a malformed user file never breaks the app
  }
}

function isValidWorkflow(w: unknown): w is Record<string, unknown> {
  if (!w || typeof w !== 'object') return false
  const r = w as Record<string, unknown>
  return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.systemPromptAppend === 'string'
}

function normalizeWorkflow(w: Record<string, unknown>): LaunchPreset {
  const mode = w.permissionMode as PermissionMode
  return {
    id: String(w.id),
    name: String(w.name),
    description: typeof w.description === 'string' ? w.description : '',
    systemPromptAppend: String(w.systemPromptAppend),
    permissionMode: MODES.includes(mode) ? mode : 'default',
    useWorktree: Boolean(w.useWorktree),
    isBuildPipeline: Boolean(w.isBuildPipeline),
    policyProfile: sanitizePolicyProfile(w.policyProfile)
  }
}

const POLICY_MODES: PolicyMode[] = ['auto', 'approve', 'off']

// A policy profile persists to the policies table at launch and weakens the
// safe-by-default posture, so an imported file must not be able to register a
// junk action type or an unknown mode. Keep only known action types mapped to a
// valid PolicyMode; drop everything else (default-deny, fail-safe).
function sanitizePolicyProfile(raw: unknown): Record<string, PolicyMode> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, PolicyMode> = {}
  for (const [id, mode] of Object.entries(raw as Record<string, unknown>)) {
    if (ACTION_TYPE_BY_ID[id] && typeof mode === 'string' && (POLICY_MODES as string[]).includes(mode)) {
      out[id] = mode as PolicyMode
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// Drop a documented example next to the user's workflows file so the format is discoverable.
function ensureExample(path: string): void {
  const dir = dirname(path)
  const example = join(dir, 'workflows.example.json')
  if (existsSync(dir) || existsSync(example)) return
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      example,
      JSON.stringify(
        [
          {
            id: 'my-workflow',
            name: 'My workflow',
            description: 'Rename this file to workflows.json and edit. Each entry adds a workflow to the New Session picker.',
            systemPromptAppend: 'Extra instructions appended to the system prompt for this workflow.',
            permissionMode: 'default',
            useWorktree: false
          }
        ],
        null,
        2
      )
    )
  } catch {
    // best-effort; never block startup
  }
}

export function getPreset(id: string | undefined): LaunchPreset | undefined {
  return id ? loadWorkflows().find((p) => p.id === id) : undefined
}

export function launchOptionsFor(presetId: string | null): { systemPromptAppend: string; isBuildPipeline: boolean } {
  const preset = getPreset(presetId ?? undefined) ?? getPreset(DEFAULT_PRESET_ID)!
  return { systemPromptAppend: preset.systemPromptAppend, isBuildPipeline: Boolean(preset.isBuildPipeline) }
}
