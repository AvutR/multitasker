# Multitasker

A UI editor layer atop **Claude Code** that maximizes multitasking: run, steer, and review **many parallel agent sessions** at once — with Claude Code **skills used by default** and an auditable, **policy-gated automation engine** for Slack, Notion, Linear, and GitHub.

Built for the Unbound velocity bar (see *Raising the Bar*): one place to drive 15–20 parallel workstreams, keep Linear/Notion current automatically, and review the work in a VS-Code-grade editor.

---

## What it does

- **Parallel agents.** Each session is its own Claude Code subprocess (`@anthropic-ai/claude-agent-sdk` `query()`), spawned with its own working directory / git worktree. A concurrency cap queues the rest. Spawn, **steer** (inject messages mid-run), stop, resume, fork.
- **Skills by default — invoked by intent, no slash command.** Every session loads your installed skills/agents/commands (`settingSources: ['user','project','local']`) and is system-prompted to invoke them **proactively**: run the `/build` pipeline for feature work, `/council` for a thin spec, `/security-review` before landing, delegate to the `principal-*` subagents. Spawn with **Auto** (the default) and a [task router](src/main/skills/taskRouter.ts) picks the right skill/pipeline from your prompt — you never type `/`. The team pipeline from [websentry-ai/skills](https://github.com/websentry-ai/skills) is **vendored into [`.claude/`](.claude)**, so anyone opening this repo in Claude Code gets it with zero setup.
- **Automatic pipeline updates on other apps.** Link a session to a Linear issue / Notion page / Slack channel and Multitasker auto-posts at lifecycle milestones — start → Linear *In Progress*, plan ready → comment, landed → *In Review* + Notion spec note + Slack post, error → blocked comment. Every update is routed through the same policy engine (internal AUTO-fires, outward posts queue for one-click approval, dry-run suppresses) — see [`LifecycleAutomation.ts`](src/main/orchestrator/LifecycleAutomation.ts).
- **Editor / review layer.** A Monaco-based file tree + editor (the "Copilot feel"), a side-by-side **diff review**, a live streaming transcript per agent, and an **inline plan-approval gate**.
- **Policy-gated integrations.** A typed taxonomy of every external action (`linear.status_update`, `slack.standup_post`, `notion.spec_update`, …), each independently set to **AUTO / one-click APPROVE / OFF**, plus a **global dry-run** master switch. Internal bookkeeping (Linear/Notion) defaults AUTO; outward posts (Slack) default APPROVE. Every action is written to an append-only **audit log**.
- **Local-commit landing.** No remote / no PR in this build — the in-app "Commit" lands a verified local commit on the session's worktree branch.

## Quickstart

**Prerequisites:** Node 20+ (tested on 22), and the **Claude Code CLI installed and logged in** (the Agent SDK reuses its auth — no API key needed).

```bash
npm install
npm run dev          # launch the desktop app (electron-vite dev)
```

Other scripts:

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest (orchestration + policy engine, 35 tests)
npm run build        # production bundle (electron-vite build)
```

In the app: **+ New** → pick a preset, point it at a repo path, give it a task. Watch it stream, review the diff, approve its plan, and one-click-approve any outward integration actions in the right-hand drawer.

## How it works

```
Renderer (React + Monaco + Zustand)
        │  typed IPC seam (src/shared/ipc.ts) — contextIsolation on, nodeIntegration off
        ▼
Electron main = the orchestrator (Node)
  ├─ SessionManager → AgentSession (one query() each, steering queue, concurrency cap)
  │     • settingSources → skills by default
  │     • canUseTool → plan-approval gate (ExitPlanMode) + connector policy gate
  ├─ Integration engine
  │     • PolicyEngine.decide (pure: fire | queue | dry_run | drop)
  │     • path #1: in-process MCP "integration tools" the agents call (post_standup, …)
  │     • path #2: canUseTool guard over raw connector calls (default-deny, fail-safe)
  │     • ConnectorGateway → real action via a scoped headless SDK run
  └─ SQLite (better-sqlite3): sessions, messages, actions (audit), policies, repos
```

Two enforcement paths guarantee **nothing outward escapes the policy**: agents are steered to call the high-level semantic tools (path #1, Multitasker owns execution + audit), and any *raw* connector call they attempt is caught by the `canUseTool` guard (path #2, default-deny per connector namespace, including out-of-band `gh`/`curl` via Bash).

## Presets

| Preset | What it does |
|---|---|
| **/build pipeline** | plan → code → simplify → test → security review → land a local commit. Plan mode (hits the approval gate), runs in an isolated worktree. |
| **Explore / freeform** | a general steerable agent with skills + integration tools wired in. |
| **Async standup** | summarize progress and post the standup (blockers/done/pending/testable) to Slack via the policy. |
| **Linear hygiene sync** | reconcile Linear — statuses, progress comments, weekly project update. |

## Security posture

- Electron: `contextIsolation` on, `nodeIntegration` off, `webviewTag` off, navigation pinned to local content, `openExternal` restricted to http(s)/mailto, strict CSP in production (always strict when packaged).
- Integrations ship **dry-run ON by default** — no action hits a live connector until you turn it off. The connector guard is **default-deny**: unknown/renamed connector writes fail safe.
- Auth is delegated to the local Claude CLI; no secrets are stored or logged. SQLite access is fully parameterized.

## Known limitations / v1 follow-ups

- **GitHub PR actions are disabled** (the no-remote constraint) — the plumbing exists, flip them on when remotes are in scope.
- The connector execution worker is scoped to the target *connector* but not yet to the single approved *tool* (LOW): an injected payload could in principle steer it to another write tool of the **same** connector. Bind to the exact tool as a follow-up.
- Idle-but-live sessions hold a concurrency slot until stopped (the subprocess is alive); the cap gates **resident** sessions.
- Deferred: browser/remote mode, multi-user/RBAC, cross-session orchestration graphs, worktree auto-merge, app packaging/signing, an `xterm` terminal panel, a cost dashboard.

## Layout

```
.claude/         vendored team skills: /build, /council + principal-* / reviewer / evaluator agents
src/main/        Electron main = orchestrator (db, orchestrator, integrations, git, fs, skills, ipc)
src/preload/     contextBridge → window.api
src/renderer/    React + Monaco UI (store, components)
src/shared/      types + the typed IPC contract (the seam)
tests/integration/  outermost-layer tests (policy truth table, both enforcement paths, lifecycle)
```
