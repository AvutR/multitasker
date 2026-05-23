import { useEffect, useRef, useState } from 'react'
import type { ContentBlock, TranscriptMessage } from '@shared/types'
import { useStore } from '../store/store'
import { PlanApprovalCard } from './PlanApprovalCard'

export function Transcript({ sessionId }: { sessionId: string }) {
  const messages = useStore((s) => s.messages[sessionId] ?? EMPTY)
  const delta = useStore((s) => s.deltas[sessionId] ?? '')
  const status = useStore((s) => s.sessions[sessionId]?.status)
  const steer = useStore((s) => s.steer)
  const stop = useStore((s) => s.stop)

  const [text, setText] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, delta])

  const live = status === 'running' || status === 'awaiting_plan_approval' || status === 'queued'

  const send = () => {
    const t = text.trim()
    if (!t) return
    void steer(sessionId, t)
    setText('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
        {delta && (
          <div className="whitespace-pre-wrap rounded bg-ink-800 px-3 py-2 text-sm text-[#c7cdd8]">
            {delta}
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent align-middle" />
          </div>
        )}
        <PlanApprovalCard sessionId={sessionId} />
        {messages.length === 0 && !delta && (
          <div className="py-10 text-center text-xs text-[#5b6472]">Waiting for the agent to start…</div>
        )}
      </div>
      <div className="flex items-end gap-2 border-t border-ink-600 px-3 py-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
          rows={1}
          placeholder="Steer this agent…  (⌘↵ to send)"
          className="min-h-[34px] flex-1 resize-none rounded border border-ink-500 bg-ink-700 px-2.5 py-1.5 text-sm"
        />
        <button
          onClick={send}
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-ink-900 hover:bg-[#8bbcff]"
        >
          Send
        </button>
        {live && (
          <button
            onClick={() => void stop(sessionId)}
            className="rounded border border-[#f06d6d]/50 px-3 py-1.5 text-sm text-[#f06d6d] hover:bg-[#f06d6d]/10"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  )
}

const EMPTY: TranscriptMessage[] = []

function Message({ message }: { message: TranscriptMessage }) {
  if (message.kind === 'result') {
    return (
      <div className="border-t border-dashed border-ink-600 pt-2 text-[11px] text-[#5b6472]">
        {message.blocks.map((b, i) => (b.type === 'text' ? <span key={i}>{b.text}</span> : null))}
        {message.costUsd != null && <span className="ml-2 tabular-nums">${message.costUsd.toFixed(4)}</span>}
      </div>
    )
  }
  const isUser = message.kind === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : ''}>
      <div
        className={`max-w-full space-y-1.5 rounded-lg px-3 py-2 ${
          isUser ? 'bg-accent/15 text-[#d7dbe3]' : 'bg-ink-800 text-[#c7cdd8]'
        }`}
      >
        {message.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
    </div>
  )
}

function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return <div className="whitespace-pre-wrap text-sm leading-relaxed">{block.text}</div>
    case 'thinking':
      return (
        <details className="text-xs text-[#6b7280]">
          <summary className="cursor-pointer select-none italic">thinking…</summary>
          <div className="mt-1 whitespace-pre-wrap pl-2 italic">{block.text}</div>
        </details>
      )
    case 'tool_use':
      return (
        <details className="rounded border border-ink-600 bg-ink-900/60 text-xs">
          <summary className="cursor-pointer select-none px-2 py-1 text-accent">⚙ {block.name}</summary>
          <pre className="max-h-48 overflow-auto px-2 py-1 font-mono text-[11px] text-[#8a93a6]">
            {safeJson(block.input)}
          </pre>
        </details>
      )
    case 'tool_result':
      return (
        <details className="rounded border border-ink-600 bg-ink-900/60 text-xs">
          <summary className={`cursor-pointer select-none px-2 py-1 ${block.isError ? 'text-[#f06d6d]' : 'text-[#5bd4a4]'}`}>
            ↳ result{block.isError ? ' (error)' : ''}
          </summary>
          <pre className="max-h-48 overflow-auto px-2 py-1 font-mono text-[11px] text-[#8a93a6]">
            {block.text.slice(0, 4000)}
          </pre>
        </details>
      )
    default:
      return null
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 4000)
  } catch {
    return String(value)
  }
}
