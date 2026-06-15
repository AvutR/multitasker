/**
 * Automated model tiering for delegated sub-agents.
 *
 * Anthropic's multi-agent guidance is to use cheaper models for sub-tasks and a
 * stronger model to orchestrate — concretely: Haiku for exploration/research,
 * Sonnet for code/review/test, Opus for orchestration/architecture.
 * (https://code.claude.com/docs/en/subagents.md — "Model selection per subagent")
 *
 * When a conductor delegates without naming a model, we classify the sub-task
 * from its prompt and pick the matching tier, so a "find where X lives" task
 * runs on Haiku while "implement Y + tests" runs on Sonnet — automatically.
 * Pure + deterministic.
 */

export type TaskKind = 'orchestrate' | 'review' | 'test' | 'research' | 'docs' | 'implement'

/** Model-registry ids (see main/models.ts). Anthropic tiers, cheap → strong. */
export type ModelTier = 'haiku' | 'sonnet' | 'opus'

// Most-specific / most-expensive intents first; 'implement' is the broad
// catch-all and must come last so it doesn't shadow the others.
const RULES: { test: RegExp; kind: TaskKind }[] = [
  { test: /\b(orchestrat|decompose|coordinat|architect|break (this|it) (down|up)|delegate|plan the)\b/i, kind: 'orchestrate' },
  { test: /\b(review|audit|critique|inspect|security[- ]review|vet|assess)\b/i, kind: 'review' },
  { test: /\b(test|tests|unit test|coverage|spec|reproduce|repro)\b/i, kind: 'test' },
  { test: /\b(research|investigate|explore|search|find|locate|gather|survey|look up|map out|trace)\b/i, kind: 'research' },
  { test: /\b(document|docs|readme|changelog|comment|write[- ]?up|summari[sz]e)\b/i, kind: 'docs' },
  { test: /\b(implement|build|add|create|write|fix|refactor|migrate|wire|update|change|rename)\b/i, kind: 'implement' }
]

const TIER_BY_KIND: Record<TaskKind, ModelTier> = {
  orchestrate: 'opus',
  review: 'sonnet',
  test: 'sonnet',
  implement: 'sonnet',
  research: 'haiku',
  docs: 'haiku'
}

/** Best-effort task kind for a sub-task prompt, or null if nothing matches. */
export function classifySubtask(text: string): TaskKind | null {
  for (const r of RULES) if (r.test.test(text)) return r.kind
  return null
}

/** Recommended model tier for a sub-task prompt, or null if it can't be classified. */
export function recommendModelForSubtask(text: string): ModelTier | null {
  const kind = classifySubtask(text)
  return kind ? TIER_BY_KIND[kind] : null
}
