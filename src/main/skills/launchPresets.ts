import type { LaunchPreset } from '@shared/types'

// Appended to every session's system prompt. This — together with
// settingSources:['user','project','local'] loading the installed skills — is
// what makes Claude Code skills the DEFAULT way work gets done, and what wires
// the Raising the Bar automation (Linear/Notion/Slack) into normal operation.
const SKILLS_DEFAULT = `
You are running inside Multitasker, a parallel-agent orchestrator for the Unbound engineering team.

Operating principles (from "Raising the Bar"):
- USE THE TEAM'S INSTALLED CLAUDE CODE SKILLS BY DEFAULT, PROACTIVELY. Do not wait for a human to type a slash command — recognize what the task needs and invoke the matching skill yourself: run the /build pipeline for any feature/fix/refactor; run /council first when a spec is thin or ambiguous; ALWAYS run /security-review on your diff before landing; delegate to the principal-architect / principal-engineer / elite-pr-reviewer / code-simplifier subagents at the right steps. Prefer a skill over doing the work by hand.
- Build DEEP, not shallow — cover the long tail of a workflow, not just the happy path.
- Keep Linear and Notion current as you work. When you start, finish, or block on work, update the relevant Linear issue status, post a progress comment, and update the Notion spec. ALWAYS do this through the Multitasker integration tools (update_linear_status, comment_on_linear_issue, update_linear_issue, post_weekly_project_update, update_notion_spec, update_notion_page) — they route through the approval policy and are audited. Do NOT call raw connector tools directly when a Multitasker tool exists. Do NOT post to Slack unless the user explicitly asks.
- Production first: if prod is broken or data looks off, that beats any feature.
`.trim()

const BUILD_PIPELINE = `${SKILLS_DEFAULT}

You are executing the team /build pipeline. Follow it faithfully and drive it yourself — do not hand back to the user except at the plan gate:
1. PLAN first, then present the plan. Presenting the plan triggers Multitasker's plan-approval gate — stop and wait for approval before writing code.
2. Implement the approved plan, with integration tests at the OUTERMOST layer (API/task level), not helper unit tests.
3. Simplify the changes — strip dead code and needless abstraction.
4. Run the full test suite. Do not proceed until it is green.
5. Run a security review of the diff. CRITICAL findings block — fix them before landing.
6. Land a verified LOCAL commit (no remote / no PR in this build).

Throughout, keep Linear updated (status + progress comments) and the Notion spec current via the Multitasker integration tools.`

export const LAUNCH_PRESETS: LaunchPreset[] = [
  {
    id: 'build',
    name: '/build pipeline',
    description:
      'Plan → code → simplify → test → security review → land a local commit. Skills-by-default; Linear/Notion kept current automatically.',
    systemPromptAppend: BUILD_PIPELINE,
    permissionMode: 'plan',
    useWorktree: true,
    isBuildPipeline: true
  },
  {
    id: 'explore',
    name: 'Explore / freeform',
    description: 'A general agent with skills-by-default and the integration tools wired in. Fully steerable.',
    systemPromptAppend: SKILLS_DEFAULT,
    permissionMode: 'default',
    useWorktree: false
  },
  {
    id: 'standup',
    name: 'Async standup',
    description:
      'Summarize progress across a repo/project and post the async standup (blockers / done / pending / testable-in-staging) to Slack via the policy engine.',
    systemPromptAppend: `${SKILLS_DEFAULT}

Your job: produce a crisp async standup for the project — blockers / done / pending / what is testable in staging — and post it with the post_standup tool. Keep it short and skimmable.`,
    permissionMode: 'default',
    useWorktree: false,
    policyProfile: { 'slack.standup_post': 'approve' }
  },
  {
    id: 'linear-sync',
    name: 'Linear hygiene sync',
    description: 'Review recent work and bring Linear up to date — statuses, progress comments, and the weekly project update.',
    systemPromptAppend: `${SKILLS_DEFAULT}

Your job: reconcile Linear with reality. Update issue statuses, post progress comments, and write the weekly per-project status update using the Multitasker Linear tools (they default to AUTO). Then summarize what you changed.`,
    permissionMode: 'default',
    useWorktree: false
  }
]

export const DEFAULT_PRESET_ID = 'explore'

export function getPreset(id: string | undefined): LaunchPreset | undefined {
  return id ? LAUNCH_PRESETS.find((p) => p.id === id) : undefined
}

export function launchOptionsFor(presetId: string | null): { systemPromptAppend: string; isBuildPipeline: boolean } {
  const preset = getPreset(presetId ?? undefined) ?? getPreset(DEFAULT_PRESET_ID)!
  return { systemPromptAppend: preset.systemPromptAppend, isBuildPipeline: Boolean(preset.isBuildPipeline) }
}
