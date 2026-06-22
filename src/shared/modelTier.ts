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
  { test: /\b(implement|build|add|create|write|fix|repair|debug|patch|resolve|refactor|migrate|wire|update|change|rename)\b/i, kind: 'implement' }
]

/** Capability ranking of the tiers, cheap → strong. Used to break multi-match ties. */
const TIER_RANK: Record<ModelTier, number> = { haiku: 1, sonnet: 2, opus: 3 }

const TIER_BY_KIND: Record<TaskKind, ModelTier> = {
  orchestrate: 'opus',
  review: 'sonnet',
  test: 'sonnet',
  implement: 'sonnet',
  research: 'haiku',
  docs: 'haiku'
}

/** All task kinds, for validating a caller-supplied (LLM-judged) kind. */
export const TASK_KINDS: TaskKind[] = ['orchestrate', 'review', 'test', 'research', 'docs', 'implement']

/** The tier for a known task kind — the conductor names the kind, we map it. */
export function tierForKind(kind: TaskKind): ModelTier {
  return TIER_BY_KIND[kind]
}

/**
 * Best-effort task kind for a sub-task prompt, or null if nothing matches.
 *
 * When several rules match (e.g. "find and fix the N+1" hits both `research` and
 * `implement`), we pick the kind with the MOST-CAPABLE tier rather than the
 * first rule in the list. The asymmetry is the whole point: over-tiering a
 * borderline task (Sonnet does a job Haiku could) costs a little; under-tiering
 * (Haiku botches an implement task) costs the failed attempt PLUS the conductor
 * noticing and re-delegating. So on ambiguity, bias capable.
 */
export function classifySubtask(text: string): TaskKind | null {
  const matched = RULES.filter((r) => r.test.test(text)).map((r) => r.kind)
  if (matched.length === 0) return null
  // reduce keeps `best` on ties (strict >), so rule order still breaks same-tier ties.
  return matched.reduce((best, k) => (TIER_RANK[TIER_BY_KIND[k]] > TIER_RANK[TIER_BY_KIND[best]] ? k : best))
}

/** Recommended model tier for a sub-task prompt, or null if it can't be classified. */
export function recommendModelForSubtask(text: string): ModelTier | null {
  const kind = classifySubtask(text)
  return kind ? TIER_BY_KIND[kind] : null
}
