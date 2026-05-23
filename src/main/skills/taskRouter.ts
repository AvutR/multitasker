// Maps a free-text task to the preset whose skill/pipeline should run, so the
// right skill is invoked automatically — the user never types a slash command.
// Used when a session is spawned with preset 'auto' (the default).

const RULES: { test: RegExp; preset: string }[] = [
  { test: /\b(stand[- ]?up|status update|what (did|have) (we|i) ship)/i, preset: 'standup' },
  { test: /\b(linear|backlog|ticket|issue hygiene|cycle|sprint board|triage)/i, preset: 'linear-sync' },
  { test: /\b(build|implement|add|create|fix|refactor|ship|feature|endpoint|bug|migrate|wire up|write)/i, preset: 'build' }
]

export const AUTO_PRESET = 'auto'

/** Infer the preset for a task. Falls back to the freeform 'explore' preset. */
export function routePreset(prompt: string): string {
  for (const rule of RULES) {
    if (rule.test.test(prompt)) return rule.preset
  }
  return 'explore'
}

/** Resolve a requested preset id: 'auto'/empty routes by intent, else honored as-is. */
export function resolvePresetId(requested: string | undefined, prompt: string): string {
  if (!requested || requested === AUTO_PRESET) return routePreset(prompt)
  return requested
}
