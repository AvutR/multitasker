import { useState } from 'react'
import { useStore } from '../store/store'

export function PlanApprovalCard({ sessionId }: { sessionId: string }) {
  const plan = useStore((s) => s.planRequests[sessionId])
  const approvePlan = useStore((s) => s.approvePlan)
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)

  if (!plan) return null

  return (
    <div className="my-3 rounded-lg border border-[#f5c451]/40 bg-[#f5c451]/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#f5c451]">
        Plan approval required
      </div>
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded bg-ink-900 p-2.5 font-mono text-xs leading-relaxed text-[#c7cdd8]">
        {plan.plan || '(no plan text provided)'}
      </pre>
      {showFeedback && (
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          autoFocus
          placeholder="What should change? (sent back to the agent)"
          className="mt-2 w-full resize-none rounded border border-ink-500 bg-ink-700 px-2 py-1.5 text-xs"
        />
      )}
      <div className="mt-2 flex justify-end gap-2">
        {showFeedback ? (
          <>
            <button
              onClick={() => setShowFeedback(false)}
              className="rounded px-2.5 py-1 text-xs text-[#8a93a6] hover:bg-ink-700"
            >
              Back
            </button>
            <button
              onClick={() => void approvePlan(sessionId, false, feedback.trim() || undefined)}
              className="rounded bg-[#f06d6d] px-2.5 py-1 text-xs font-semibold text-ink-900"
            >
              Send changes
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowFeedback(true)}
              className="rounded border border-ink-500 px-2.5 py-1 text-xs text-[#b9c0cc] hover:bg-ink-700"
            >
              Request changes
            </button>
            <button
              onClick={() => void approvePlan(sessionId, true)}
              className="rounded bg-[#5bd4a4] px-2.5 py-1 text-xs font-semibold text-ink-900"
            >
              Approve & build
            </button>
          </>
        )}
      </div>
    </div>
  )
}
