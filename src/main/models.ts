import type { AppSettings, ModelOption } from '@shared/types'

/**
 * The model registry. Anthropic models run natively through the logged-in
 * Claude Code CLI. Bedrock/Vertex run the same Claude models on another cloud
 * (need that cloud's creds in the environment). A "gateway" model routes to any
 * Anthropic-compatible proxy (LiteLLM / OpenRouter / …) so non-Anthropic models
 * (GPT, Gemini) are reachable — configured via app settings.
 */
export const MODELS: ModelOption[] = [
  { id: 'opus', label: 'Claude Opus 4.7', provider: 'anthropic', sdkModel: 'claude-opus-4-7' },
  { id: 'sonnet', label: 'Claude Sonnet 4.6', provider: 'anthropic', sdkModel: 'claude-sonnet-4-6' },
  { id: 'haiku', label: 'Claude Haiku 4.6', provider: 'anthropic', sdkModel: 'claude-haiku-4-6' },
  { id: 'bedrock-sonnet', label: 'Claude Sonnet · Bedrock', provider: 'bedrock', sdkModel: 'claude-sonnet-4-6' },
  { id: 'vertex-sonnet', label: 'Claude Sonnet · Vertex', provider: 'vertex', sdkModel: 'claude-sonnet-4-6' }
]

export const DEFAULT_MODEL_ID = 'opus'

/** Registry plus a gateway model synthesized from settings, when configured. */
export function listModels(settings: AppSettings): ModelOption[] {
  const out = [...MODELS]
  if (settings.gatewayBaseUrl && settings.gatewayModel) {
    out.push({
      id: 'gateway',
      label: settings.gatewayLabel || `Gateway · ${settings.gatewayModel}`,
      provider: 'gateway',
      sdkModel: settings.gatewayModel
    })
  }
  return out
}

/** Resolve a model id to the SDK model string + any provider env overrides. */
export function resolveModel(id: string | null, settings: AppSettings): { sdkModel: string; env?: Record<string, string> } {
  const all = listModels(settings)
  const model = all.find((m) => m.id === id) ?? all.find((m) => m.id === DEFAULT_MODEL_ID) ?? all[0]
  return { sdkModel: model.sdkModel, env: providerEnv(model, settings) }
}

function providerEnv(model: ModelOption, settings: AppSettings): Record<string, string> | undefined {
  switch (model.provider) {
    case 'bedrock':
      return { CLAUDE_CODE_USE_BEDROCK: '1' }
    case 'vertex':
      return { CLAUDE_CODE_USE_VERTEX: '1' }
    case 'gateway': {
      if (!settings.gatewayBaseUrl) return undefined
      const env: Record<string, string> = { ANTHROPIC_BASE_URL: settings.gatewayBaseUrl }
      if (settings.gatewayApiKey) env.ANTHROPIC_AUTH_TOKEN = settings.gatewayApiKey
      return env
    }
    default:
      return undefined
  }
}
