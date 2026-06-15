# Multitasker

A UI editor layer atop **Claude Code** that maximizes multitasking: run, steer, and review **many parallel agent sessions** at once — with Claude Code **skills used by default** and an auditable, **policy-gated automation engine** for Slack, Notion, Linear, and GitHub.

One place to drive a dozen parallel workstreams, keep your issue tracker and specs current automatically, and review the work in a VS-Code-grade editor.

> **Plug-and-play.** Multitasker ships **no skills of its own** — it loads whatever skills/agents/commands you already have installed in Claude Code, and you can drop in your own launch **workflows** from a JSON file (see [Importing workflows](#importing-workflows)). Nothing here is tied to any one team's tooling.

---

## What it does

- **Mission Control (the home).** A board-first overview of every agent grouped by state (Running · Idle · Done), led by a **ranked "Needs you" inbox** that unifies plan approvals, action approvals, and errors into one attention queue (error > blocking plan > pending action, oldest first) with one-click Approve/Review/Open. The header keeps the **dry-run safety state** and a **"N needs you"** badge always visible, with a live concurrency-cap stepper and one-click **Reclaim idle slots**. Click any card to drill into the session; "← Mission Control" to come back.
- **Trust to land.** Each session shows a trust summary (branch + its policy-gated action roll-up), and **Land is reversible** — a one-click Undo soft-resets the commit and restores the changes to the working tree.
- **Parallel agents.** Each session is its own Claude Code subprocess (`@anthropic-ai/claude-agent-sdk` `query()`), spawned with its own working directory / git worktree. A concurrency cap queues the rest. Spawn, **steer** (inject messages mid-run), stop, resume, fork.
- **Skills by default — invoked by intent, no slash command.** Every session loads your installed skills/agents/commands (`settingSources: ['user','project','local']`) and is system-prompted to invoke them **proactively** instead of waiting for you to type a `/command`. Spawn with **Auto** (the default) and a [task router](src/shared/taskRouter.ts) picks the matching workflow from your prompt. The app brings no skills of its own — it uses yours.
- **Automatic pipeline updates on other apps.** Link a session to a Linear issue / Notion page / Slack channel and Multitasker auto-posts at lifecycle milestones — start → Linear *In Progress*, plan ready → comment, landed → *In Review* + Notion spec note, error → blocked comment. Every update is routed through the same policy engine (internal AUTO-fires, outward posts queue for one-click approval, dry-run suppresses) — see [`LifecycleAutomation.ts`](src/main/orchestrator/LifecycleAutomation.ts). (Slack is **not** auto-posted by lifecycle; it stays explicit.)
- **Start work from Linear.** The **Linear** button fetches the issues assigned to you (via your Linear connector — no separate token) and one-click-spawns a build session per issue: the git branch is auto-named from the issue **and pushed to GitHub `origin`** (policy-gated `github.push_branch`; a no-op for local-only repos), the session is linked so lifecycle updates fire (In Progress → In Review), a Notion page referenced in the issue is auto-linked, and the task is pre-filled from the issue. Working directory defaults to your last-used repo — see [`LinearService.ts`](src/main/integrations/LinearService.ts).
- **Model selection + multiple providers.** Pick the model per session in the New Session modal. Anthropic Claude models run natively; Bedrock/Vertex run Claude on those clouds; and an Anthropic-compatible **gateway** (LiteLLM / OpenRouter, configured in settings) routes to other providers (GPT, Gemini). Each model carries the right env to the spawned Claude Code subprocess — see [`models.ts`](src/main/models.ts).
- **Editor / review layer.** A Monaco-based file tree + editor (the "Copilot feel"), a side-by-side **diff review**, a live streaming transcript per agent, and an **inline plan-approval gate**.
- **Policy-gated integrations.** A typed taxonomy of every external action (`linear.status_update`, `slack.standup_post`, `notion.spec_update`, …), each independently set to **AUTO / one-click APPROVE / OFF**, plus a **global dry-run** master switch. Internal bookkeeping (Linear/Notion) defaults AUTO; outward posts (Slack) default APPROVE. Every action is written to an append-only **audit log**.
- **Local-commit landing + optional PRs.** The in-app "Commit" lands a verified local commit on the session's worktree branch. Pushing the branch and opening/commenting on a PR are available as **policy-gated** GitHub actions (`github.push_branch`, `github.pr_create`, `github.pr_comment`) — gated to one-click approval by default, suppressed under dry-run.

## Quickstart

**Prerequisites:** Node 20+ (tested on 22), and the **Claude Code CLI installed and logged in** (the Agent SDK reuses its auth — no API key needed).

```bash
git clone https://github.com/AvutR/multitasker.git
cd multitasker
npm install
npm run dev          # launch the desktop app (electron-vite dev)
```

Other scripts:

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest (policy engine, orchestration, board logic)
npm run build        # production bundle (electron-vite build)
```

### Package it as a real app

```bash
npm run package   # → release/mac-arm64/Multitasker.app  (no DMG/signing — fastest)
npm run dist      # → a distributable DMG
```

The packaged `.app` runs standalone (no dev server) and survives sleep like any
macOS app. It's ad-hoc signed, so the first launch may need right-click → Open.
electron-builder rebuilds `better-sqlite3` for the bundled Electron automatically.

### Native module note (better-sqlite3)

`better-sqlite3` is a native addon, so it must match the runtime's ABI — Electron and Node use different ones. This is handled automatically: `predev` rebuilds it for Electron before `npm run dev`, and `pretest` rebuilds it for Node before `npm test` (only when needed, so it's a no-op otherwise). To flip manually: `npm run rebuild:electron` / `npm run rebuild:node`.

Electron is pinned to **30.x** because `better-sqlite3@12.10.0` (latest) doesn't yet compile against Electron 42's V8. Bump Electron once `better-sqlite3` supports a newer V8, or swap to `node:sqlite` when it's unflagged in Electron's bundled Node.

In the app: **+ New** → pick a workflow, point it at a repo path, give it a task. Watch it stream, review the diff, approve its plan, and one-click-approve any outward integration actions in the right-hand drawer.

## Skills by default

Multitasker spawns every session with `settingSources: ['user','project','local']`, so it loads the **skills, subagents, and slash commands you already have** in Claude Code (`~/.claude/` and the target repo's `.claude/`). A system-prompt append tells the agent to recognize what a task needs and invoke the matching skill itself — you don't type `/`. The app ships none of its own, so it stays neutral and works with whatever pipeline your team uses.

## Importing workflows

Workflows are the launch presets in the **+ New** picker (system-prompt append + permission mode + worktree on/off). Multitasker ships neutral built-ins — **Build pipeline**, **Explore / freeform**, **Conductor (orchestrator)**, **Tune project context (CLAUDE.md)**, **Async standup**, **Issue tracker sync** — and you can add your own without touching the code.

On first run Multitasker drops a documented template at `~/.multitasker/workflows.example.json`. Copy it to `~/.multitasker/workflows.json` and edit:

```json
[
  {
    "id": "my-workflow",
    "name": "My workflow",
    "description": "Shown in the New Session picker.",
    "systemPromptAppend": "Extra instructions appended to the system prompt for this workflow.",
    "permissionMode": "default",
    "useWorktree": false
  }
]
```

Your workflows are **merged over the built-ins by `id`** (reuse a built-in `id` to override it). `permissionMode` is one of `default | acceptEdits | plan | bypassPermissions`; set `useWorktree: true` to run in an isolated git worktree. A malformed file is ignored rather than breaking startup. See [`launchPresets.ts`](src/main/skills/launchPresets.ts).

## Tracker providers

The "Linear" inbox and the lifecycle updates (status changes, comments, weekly project notes) are plugged into your project tracker through a small `TrackerProvider` interface. **Linear ships as the default**, and the engine is provider-agnostic — anything that walks like a tracker (Jira, GitHub Projects, ClickUp, Shortcut, Asana, a Notion database) plugs in by implementing a single file.

To wire up a different tracker:

1. Write a class that implements `TrackerProvider` (see `src/main/integrations/trackers/_template.ts.txt` and `linear.ts` — it's three small methods: `id`, `label`, `listMyItems`).
2. Register it in `src/main/integrations/trackers/registry.ts`.
3. Select it as the default with a one-line config:

   ```bash
   echo '{ "active": "jira" }' > ~/.multitasker/trackers.json
   ```

If `trackers.json` is missing or names a provider the build doesn't know, the engine falls back to Linear.

## CI/CD providers

The **CI/CD** tab in a session shows recent pipeline runs for its repo, through the same plug-in shape — a `CIProvider` interface (`src/main/integrations/ci/`). **GitHub Actions ships as the default** (via the `gh` CLI; read-only, scoped to the repo). GitLab CI, CircleCI, Jenkins, Buildkite, etc. plug in by implementing `CIProvider` + a registry entry, selected with:

```bash
echo '{ "active": "gitlab-ci" }' > ~/.multitasker/ci.json
```

## Power-user & performance

- **Command palette (⌘K).** Fuzzy-jump to any session by title or run a command (new session, toggle dry-run, go to Mission Control, open Tasks). ⌘N spawns a session; **esc** steps back to the board. The keyboard home base for driving many agents fast.
- **Shared agent memory.** Agents save notes to a per-project memory with the `remember` tool and read them back with `recall`. A conductor's sub-agents inherit its working dir, so they share one memory — a sub-agent's finding is instantly recallable by the conductor, and knowledge accumulates across runs instead of being rediscovered. See it in the session's **Memory** tab.
- **Read caching.** The Tasks inbox (which spawns a subprocess) and the CI/CD tab (which shells out to `gh`) are cached with a short TTL, so reopening them is instant; **Refresh** forces a live re-fetch.

## How it works

```
Renderer (React + Monaco + Zustand)
        │  typed IPC seam (src/shared/ipc.ts) — contextIsolation on, nodeIntegration off
        ▼
Electron main = the orchestrator (Node)
  ├─ SessionManager → AgentSession (one query() each, steering queue, concurrency cap)
  │     • settingSources → your installed skills, by default
  │     • canUseTool → plan-approval gate (ExitPlanMode) + connector policy gate
  ├─ Integration engine
  │     • PolicyEngine.decide (pure: fire | queue | dry_run | drop)
  │     • path #1: in-process MCP "integration tools" the agents call (post_standup, …)
  │     • path #2: canUseTool guard over raw connector calls (default-deny, fail-safe)
  │     • ConnectorGateway → real action via a scoped headless SDK run
  └─ SQLite (better-sqlite3): sessions, messages, actions (audit), policies, repos
```

Two enforcement paths guarantee **nothing outward escapes the policy**: agents are steered to call the high-level semantic tools (path #1, Multitasker owns execution + audit), and any *raw* connector call they attempt is caught by the `canUseTool` guard (path #2, default-deny per connector namespace, including out-of-band `gh`/`curl` via Bash).

## Built-in workflows

| Workflow | What it does |
|---|---|
| **Build pipeline** | plan → code → simplify → test → security review → land a local commit. Plan mode (hits the approval gate), runs in an isolated worktree. |
| **Explore / freeform** | a general steerable agent with your skills + integration tools wired in. |
| **Conductor (orchestrator)** | a high-power model decomposes the goal, fans independent sub-tasks out to **cheaper parallel sub-agents** (`delegate_subtask`), monitors them (`list_subtasks`), then synthesizes. Each sub-agent's model is **auto-tiered from its sub-task** (research → Haiku, code/test/review → Sonnet, orchestrate → Opus), per [Anthropic's subagent model guidance](https://code.claude.com/docs/en/subagents.md). |
| **Tune project context (CLAUDE.md)** | audits and **localizes** the repo's CLAUDE.md memory: keeps the root lean (<200 lines), moves subsystem-specific guidance into subdirectory `CLAUDE.md` (loaded only when an agent works there) and path-scoped `.claude/rules/*.md`, and prunes bloat. Encodes [Anthropic's CLAUDE.md best practices](https://code.claude.com/docs/en/claude-md.md). |
| **Async standup** | summarize progress and post the standup (blockers/done/pending/testable) to Slack via the policy. |
| **Issue tracker sync** | reconcile your tracker — statuses, progress comments, weekly project update. |

Add your own via `~/.multitasker/workflows.json` — see [Importing workflows](#importing-workflows).

## Security posture

- Electron: `contextIsolation` on, `nodeIntegration` off, `webviewTag` off, navigation pinned to local content, `openExternal` restricted to http(s)/mailto, strict CSP in production (always strict when packaged).
- Integrations ship **dry-run ON by default** — no action hits a live connector until you turn it off. The connector guard is **default-deny**: unknown/renamed connector writes fail safe.
- Auth is delegated to the local Claude CLI; no secrets are stored or logged. SQLite access is fully parameterized.

## Known limitations / follow-ups

- **GitHub PR actions** (`github.pr_create` / `github.pr_comment`) shell out to `gh` and are **gated to one-click approval by default** (suppressed under dry-run). They run scoped to the session repo; `gh` must be installed and authenticated.
- The connector execution worker allows only MCP connector tools (never shell/fs) with name-based containment of other *named* connectors (LOW): unidentified MCP servers aren't excluded, and it isn't yet bound to the single approved *tool*. Scope it to the connector's MCP server id as a follow-up.
- Idle-but-live sessions hold a concurrency slot until stopped (the subprocess is alive); the cap gates **resident** sessions.
- Deferred: browser/remote mode, multi-user/RBAC, cross-session orchestration graphs, worktree auto-merge, app signing/notarization, an `xterm` terminal panel, a cost dashboard.

## Layout

```
src/main/        Electron main = orchestrator (db, orchestrator, integrations, git, fs, skills, ipc)
src/preload/     contextBridge → window.api
src/renderer/    React + Monaco UI (store, components)
src/shared/      types + the typed IPC contract (the seam)
tests/integration/  outermost-layer tests (policy truth table, both enforcement paths, lifecycle)
```

## License

[MIT](LICENSE) © AvutR
