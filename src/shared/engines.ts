/**
 * Agent engines — the AI coding CLIs Multitasker can drive. Claude Code runs
 * natively through the Agent SDK (full policy gating + plan approval + the
 * integration tools); the others are driven headlessly as CLI subprocesses and
 * their streamed output is parsed into the same transcript model.
 *
 * cursor-agent is the standout: one CLI, many providers (OpenAI / Anthropic /
 * Cursor), and it speaks the SAME stream-json protocol as Claude Code — so a
 * conductor can fan work out to models from different providers in unison.
 */

export type EngineId = 'claude' | 'cursor' | 'codex' | 'gemini' | 'aider'

/** How the engine's stdout is parsed into transcript events. */
export type EngineProtocol = 'claude-json' | 'codex-jsonl' | 'text'

export interface EngineModel {
  id: string
  label: string
}

export interface EngineSpec {
  id: EngineId
  label: string
  vendor: string
  /** 'sdk' = the in-process Agent SDK (claude); 'cli' = a spawned subprocess. */
  kind: 'sdk' | 'cli'
  /** CLI binary to detect on PATH and spawn (cli engines only). */
  bin?: string
  protocol: EngineProtocol
  /** Whether the tool can continue a prior session (so steering resumes context). */
  supportsResume: boolean
  /** Curated, provider-spanning model suggestions; the picker also allows free text. */
  models: EngineModel[]
  note?: string
}

export const ENGINES: EngineSpec[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    vendor: 'Anthropic',
    kind: 'sdk',
    protocol: 'claude-json',
    supportsResume: true,
    models: [], // claude uses the ModelOption registry (models.ts); the UI fills these
    note: 'Native via the Agent SDK — full policy gating, plan approval, and the integration tools.'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    vendor: 'Cursor',
    kind: 'cli',
    bin: 'cursor-agent',
    protocol: 'claude-json',
    supportsResume: true,
    models: [
      { id: 'auto', label: 'Auto (Cursor picks)' },
      { id: 'composer-2.5', label: 'Composer 2.5 · Cursor' },
      { id: 'gpt-5.2', label: 'GPT-5.2 · OpenAI' },
      { id: 'gpt-5.3-codex', label: 'Codex 5.3 · OpenAI' },
      { id: 'claude-opus-4-8-thinking-high', label: 'Opus 4.8 Thinking · Anthropic' },
      { id: 'claude-opus-4-8-low', label: 'Opus 4.8 Low · Anthropic' }
    ],
    note: 'Cursor’s agent CLI — one tool, many providers (OpenAI / Anthropic / Cursor). Claude-compatible stream.'
  },
  {
    id: 'codex',
    label: 'Codex',
    vendor: 'OpenAI',
    kind: 'cli',
    bin: 'codex',
    protocol: 'codex-jsonl',
    supportsResume: true,
    models: [
      { id: 'gpt-5-codex', label: 'GPT-5 Codex · OpenAI' },
      { id: 'o3', label: 'o3 · OpenAI' }
    ],
    note: 'OpenAI’s Codex CLI (codex exec). Runs sandboxed; its own tool calls aren’t policy-intercepted.'
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    vendor: 'Google',
    kind: 'cli',
    bin: 'gemini',
    protocol: 'text',
    supportsResume: false,
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro · Google' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash · Google' }
    ],
    note: 'Google’s Gemini CLI — text output captured as the transcript.'
  },
  {
    id: 'aider',
    label: 'Aider',
    vendor: 'Open source',
    kind: 'cli',
    bin: 'aider',
    protocol: 'text',
    supportsResume: false,
    models: [
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'gpt-4o', label: 'GPT-4o' }
    ],
    note: 'Aider (--message headless) — text output captured as the transcript.'
  }
]

export const ENGINE_BY_ID: Record<string, EngineSpec> = Object.fromEntries(ENGINES.map((e) => [e.id, e]))
export const DEFAULT_ENGINE: EngineId = 'claude'

/** Resolve an engine id to its spec, falling back to Claude (the always-available default). */
export function engineSpec(id: string | null | undefined): EngineSpec {
  return (id != null && ENGINE_BY_ID[id]) || ENGINE_BY_ID.claude
}

/** An engine plus whether its binary is installed on this machine (from the main process). */
export interface EngineInfo extends EngineSpec {
  available: boolean
}
