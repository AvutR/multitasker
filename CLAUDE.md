# CLAUDE.md — conventions for Multitasker

Electron + TypeScript desktop app: a parallel Claude Code agent orchestrator with a policy-gated integration engine. Read `README.md` for the product overview.

## Architecture rules

- **The Electron main process is the orchestrator.** All Agent SDK use, SQLite, git, fs, and the integration engine live there. The renderer reaches it ONLY through the typed IPC seam in `src/shared/ipc.ts` (`window.api.invoke` / `.on`). Never widen the preload surface.
- **The Agent SDK is the one untyped edge.** `@anthropic-ai/claude-agent-sdk` message/option types drift across versions, so `AgentSession` binds `query` to a minimal local signature and `sdkMapping.ts` narrows raw messages into strict `ContentBlock`s. Keep SDK-shaped `any`/`Record<string,unknown>` confined to those boundaries; everything inward is strictly typed.
- **The policy invariant is sacred:** every outward action goes through `ActionService` → `PolicyEngine.decide`. Two enforcement paths — the in-process semantic MCP tools (`integrationMcpServer.ts`, path #1) and the `canUseTool` connector guard (`guards.ts` + `classifyRawTool`, path #2, default-deny). If you add a connector action, add it to `actionTypes.ts` and keep the guard fail-safe.
- **Skills by default:** sessions are spawned with `settingSources: ['user','project','local']` and a system-prompt append (see `skills/launchPresets.ts`) that tells agents to prefer installed skills.
- **Local commits only** in this build — no remote, no PR. GitHub PR action types ship disabled.

## Conventions

- Strict TS (`noUnusedLocals`/`noUnusedParameters` on). No `baseUrl`; `@shared/*` path alias only.
- Tests are **integration tests at the outermost layer** (Vitest), in `tests/integration/`. The SDK is mocked via `vi.hoisted`; the connector gateway is injected as a fake. The policy truth-table and both enforcement paths are the most important coverage — keep them green.
- DB access goes through the repositories in `src/main/db/repositories.ts` (parameterized queries only). Migrations are forward-only in `migrations.ts`.

## Gates (run before landing)

```bash
npm run typecheck && npm test && npm run build
```

All three must pass. New code paths get outermost-layer tests. Run `/security-review` on changes that touch IPC, fs, the connector guard, or the Electron window config.
