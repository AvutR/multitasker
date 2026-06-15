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
2. SPLIT a piece off to a sub-agent when it (a) would flood your context with search results / file dumps you won't reuse, (b) is independent of the others, or (c) is repetitive. Keep tightly-coupled, decision-heavy steps for yourself — sub-agents have ISOLATED context and don't see your conversation, so write each delegate_subtask prompt to be fully self-contained.
3. Let the model tier match the work — set delegate_subtask's \`kind\` (research/docs → Haiku, implement/test/review → Sonnet, orchestrate → Opus) so each sub-agent runs on the cheapest capable model. You judge the kind; if you omit it, it's inferred from the prompt. Pass an explicit model only to hard-override. This keeps cheap work cheap.
4. Use the shared project memory: 'recall' before delegating to reuse prior findings; tell sub-agents to 'remember' what they conclude so you (and future runs) can pick it up.
5. Express dependencies by waiting: after delegating the independent pieces, call wait_for_subtasks (with their ids, or no args to wait for all) to BLOCK until they finish and get their results — then delegate the next layer that depended on them. Use list_subtasks for a non-blocking status peek. This makes the dependency graph explicit: fan out, wait on what the next step needs, fan out again.
6. Synthesize: integrate the sub-agents' work, resolve conflicts, run the final tests/review, and land the result. Keep the issue tracker current via the Multitasker tools.

Delegate genuinely independent work in parallel; keep tight dependencies for yourself.`,
    permissionMode: 'default',
    useWorktree: true
  },
  {
    id: 'tune-context',
    name: 'Tune project context (CLAUDE.md)',
    description: 'Audit and optimize the repo’s CLAUDE.md memory — keep the root lean, localize context to the subsystems that need it, and prune bloat.',
    systemPromptAppend: `${SKILLS_DEFAULT}

Your job: make this repo's Claude Code memory (CLAUDE.md) optimal and LOCALIZED, following Anthropic's guidance. Claude Code loads the root CLAUDE.md at launch but loads a subdirectory's CLAUDE.md only when an agent works in that subtree — so localized context costs nothing until it's needed.

Do this:
1. AUDIT. Read the root CLAUDE.md and any nested ones. Flag what bloats them: keep each file focused and SHORT (aim under ~200 lines). Specific instructions beat vague ones ("use 2-space indent" > "format nicely").
2. LOCALIZE. For each major subsystem/package with its own conventions, propose a subdirectory CLAUDE.md (e.g. src/api/CLAUDE.md) holding ONLY that area's guidance — it loads on demand when an agent works there, so the root stays lean. For path-specific rules, use .claude/rules/<topic>.md with a \`paths:\` frontmatter glob so the rule loads only for matching files.
3. PRUNE & MOVE. Multi-step procedures belong in skills, not CLAUDE.md. Single-subdirectory guidance belongs in that subdirectory's CLAUDE.md or a path-scoped rule, not the root. Remove stale or unreferenced instructions.
4. Present the plan (what moves where, what gets trimmed) for approval before writing files. Then make the edits and summarize the before/after token footprint.

The goal: an agent working on any localized task gets exactly the context it needs, and no more.`,
    permissionMode: 'plan',
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
