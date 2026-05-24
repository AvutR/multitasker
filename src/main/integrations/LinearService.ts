import type { LinearIssue } from '@shared/types'

/** Returns the raw text the Linear-reading agent produced. Injected for tests. */
export interface LinearReader {
  fetchAssignedIssuesRaw(): Promise<string>
}

const FETCH_PROMPT = [
  'Use the Linear tools to list up to 25 issues assigned to the CURRENT user (me)',
  'that are not Done or Canceled, most-recently-updated first.',
  'Return ONLY a compact JSON array and nothing else — no prose, no code fence.',
  'Each element: {"id","identifier","title","url","state","branchName","description"}.',
  'branchName = Linear\'s suggested git branch name for the issue.',
  'description = a short plain-text summary (<= 500 chars).'
].join(' ')

/** Reads the user's assigned Linear issues by driving the Linear connector
 *  through a tightly-scoped headless Agent SDK run (reuses the user's connector
 *  auth — no separate Linear token). */
export class SdkLinearReader implements LinearReader {
  async fetchAssignedIssuesRaw(): Promise<string> {
    // The SDK is the untyped edge — bind query to a minimal local signature.
    const sdk = (await import('@anthropic-ai/claude-agent-sdk')) as { query: unknown }
    const query = sdk.query as (args: { prompt: unknown; options: Record<string, unknown> }) => AsyncIterable<
      Record<string, unknown>
    >
    const run = query({
      prompt: FETCH_PROMPT,
      options: {
        settingSources: ['user', 'project', 'local'],
        permissionMode: 'default',
        maxTurns: 8,
        canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
          // Read-only Linear access only.
          if (toolName.toLowerCase().includes('linear')) return { behavior: 'allow', updatedInput: toolInput }
          return { behavior: 'deny', message: 'Linear reader may only call Linear tools' }
        }
      }
    })

    let text = ''
    for await (const msg of run) {
      if (msg.type === 'result' && msg.subtype === 'success') {
        text = typeof msg.result === 'string' ? msg.result : text
      }
    }
    return text
  }
}

export class LinearService {
  constructor(private reader: LinearReader) {}

  async listMyIssues(): Promise<LinearIssue[]> {
    const raw = await this.reader.fetchAssignedIssuesRaw()
    return parseLinearIssues(raw)
  }
}

/** Tolerant parse: pull the first JSON array out of the agent's reply. */
export function parseLinearIssues(raw: string): LinearIssue[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []
  let arr: unknown
  try {
    arr = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).title === 'string')
    .map((x) => {
      const identifier = String(x.identifier ?? '')
      const title = String(x.title ?? '')
      return {
        id: String(x.id ?? identifier),
        identifier,
        title,
        url: String(x.url ?? ''),
        state: String(x.state ?? ''),
        branchName: String(x.branchName ?? slugBranch(identifier, title)),
        description: x.description != null ? String(x.description) : undefined
      }
    })
}

function slugBranch(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${identifier || 'issue'}-${slug}`.toLowerCase()
}
