import { useEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '@shared/types'
import { buildTimeline, summarizeTool, type TimelineEvent, type ToolStatus } from '@shared/transcript'
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
  const timeline = buildTimeline(messages)

  const send = () => {
    const t = text.trim()
    if (!t) return
    void steer(sessionId, t)
    setText('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
        {timeline.map((ev) => (
          <Event key={ev.id} ev={ev} />
        ))}
        {delta && (
          <div className="whitespace-pre-wrap py-1 text-sm leading-relaxed text-[#c7cdd8]">
            {delta}
            <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-accent align-middle" />
          </div>
        )}
        <PlanApprovalCard sessionId={sessionId} />
        {timeline.length === 0 && !delta && (
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
        <button onClick={send} className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-ink-900 hover:bg-[#8bbcff]">
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

function Event({ ev }: { ev: TimelineEvent }) {
  switch (ev.kind) {
    case 'user':
      return (
        <div className="flex justify-end py-0.5">
          <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent/15 px-3 py-2 text-sm leading-relaxed text-[#d7dbe3]">
            {ev.text}
          </div>
        </div>
      )
    case 'assistant':
      return <div className="whitespace-pre-wrap py-1 text-sm leading-relaxed text-[#d7dbe3]">{ev.text}</div>
    case 'thinking':
      return (
        <details className="group py-0.5">
          <summary className="cursor-pointer select-none text-[11px] italic text-[#5b6472] hover:text-[#8a93a6]">
            thinking
          </summary>
          <div className="mt-1 whitespace-pre-wrap border-l border-ink-600 pl-3 text-xs italic leading-relaxed text-[#6b7280]">
            {ev.text}
          </div>
        </details>
      )
    case 'tool':
      return <ToolRow ev={ev} />
    case 'result':
      return (
        <div className="flex items-center gap-2 pt-2 text-[11px] text-[#5b6472]">
          <span className="h-px flex-1 bg-ink-600" />
          {ev.text && ev.text !== '(turn complete)' && <span className="max-w-[60%] truncate">{ev.text}</span>}
          {ev.costUsd != null && ev.costUsd > 0 && <span className="tabular-nums">${ev.costUsd.toFixed(4)}</span>}
          <span className="h-px w-6 bg-ink-600" />
        </div>
      )
  }
}

const DOT: Record<ToolStatus, string> = { running: '#6ea8fe', ok: '#5bd4a4', error: '#f06d6d' }

function ToolRow({ ev }: { ev: Extract<TimelineEvent, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const { label, detail } = summarizeTool(ev.name, ev.input)

  return (
    <div className="py-0.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-ink-800"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${ev.status === 'running' ? 'animate-pulse' : ''}`}
          style={{ background: DOT[ev.status] }}
        />
        <span className="shrink-0 font-medium text-[#9aa4b2]">{label}</span>
        {detail && <span className="truncate font-mono text-[11px] text-[#6b7280]">{detail}</span>}
        <span className="ml-auto shrink-0 text-[#3a4150]">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="ml-3.5 mt-1 space-y-1.5 border-l border-ink-600 pl-3">
          {ev.input != null && (
            <pre className="max-h-48 overflow-auto rounded bg-ink-900/60 px-2 py-1 font-mono text-[11px] text-[#8a93a6]">
              {safeJson(ev.input)}
            </pre>
          )}
          {ev.result && (
            <pre
              className={`max-h-48 overflow-auto rounded bg-ink-900/60 px-2 py-1 font-mono text-[11px] ${
                ev.status === 'error' ? 'text-[#f0a0a0]' : 'text-[#8a93a6]'
              }`}
            >
              {ev.result.slice(0, 4000)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 4000)
  } catch {
    return String(value)
  }
}
