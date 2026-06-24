import { useEffect, useRef, useState } from 'react'
import type { ReviewComment } from '@shared/types'
import { monaco } from '../monaco'

/**
 * A read-only Monaco viewer with Cursor/VSCode-style line-by-line review: click a
 * line's gutter to comment; existing comments mark the line and render as inline
 * cards anchored to it. Comments are persisted by the caller (CodeView).
 */
export function ReviewEditor({
  value,
  language,
  comments,
  onAdd,
  onDelete
}: {
  value: string
  language: string
  comments: ReviewComment[]
  onAdd: (line: number, body: string) => void
  onDelete: (id: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const [composerLine, setComposerLine] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [, setTick] = useState(0) // bump to recompute overlay anchors on scroll/layout

  useEffect(() => {
    if (!host.current) return
    const ed = monaco.editor.create(host.current, {
      value,
      language,
      theme: 'multitasker-dark',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      glyphMargin: true,
      scrollBeyondLastLine: false,
      smoothScrolling: true
    })
    editorRef.current = ed
    decoRef.current = ed.createDecorationsCollection([])
    const reflow = () => setTick((t) => t + 1)
    const subs = [
      ed.onDidScrollChange(reflow),
      ed.onDidLayoutChange(reflow),
      ed.onMouseDown((e) => {
        const G = monaco.editor.MouseTargetType
        if (
          (e.target.type === G.GUTTER_GLYPH_MARGIN || e.target.type === G.GUTTER_LINE_NUMBERS || e.target.type === G.GUTTER_LINE_DECORATIONS) &&
          e.target.position
        ) {
          setComposerLine(e.target.position.lineNumber)
          setDraft('')
        }
      })
    ]
    return () => {
      subs.forEach((s) => s.dispose())
      ed.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap content when the open file changes.
  useEffect(() => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model) return
    monaco.editor.setModelLanguage(model, language)
    if (model.getValue() !== value) ed.setValue(value)
    setComposerLine(null)
    setTick((t) => t + 1)
  }, [value, language])

  // Mark commented lines (gutter dot + left bar).
  useEffect(() => {
    const deco = decoRef.current
    if (!deco) return
    const byLine = new Map<number, number>()
    for (const c of comments) byLine.set(c.line, (byLine.get(c.line) ?? 0) + 1)
    deco.set(
      [...byLine].map(([line, n]) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          linesDecorationsClassName: 'mt-review-line',
          glyphMarginClassName: 'mt-review-glyph',
          glyphMarginHoverMessage: { value: `${n} review comment${n > 1 ? 's' : ''}` }
        }
      }))
    )
    setTick((t) => t + 1)
  }, [comments])

  // Anchor inline cards to their lines (commented lines + the open composer line).
  const ed = editorRef.current
  const lineSet = new Set<number>(comments.map((c) => c.line))
  if (composerLine) lineSet.add(composerLine)
  const anchors: { line: number; top: number }[] = []
  if (ed) {
    const scrollTop = ed.getScrollTop()
    const lh = ed.getOption(monaco.editor.EditorOption.lineHeight)
    const height = ed.getLayoutInfo().height
    for (const line of lineSet) {
      const top = ed.getTopForLineNumber(line) - scrollTop + lh
      if (top > -8 && top < height) anchors.push({ line, top })
    }
  }

  const submit = (line: number) => {
    const body = draft.trim()
    if (!body) return
    onAdd(line, body)
    setDraft('')
    setComposerLine(null)
  }

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {anchors.map(({ line, top }) => {
          const thread = comments.filter((c) => c.line === line)
          const composing = composerLine === line
          return (
            <div key={line} className="pointer-events-auto absolute right-3 w-80 max-w-[55%]" style={{ top }}>
              <div className="rounded-lg border border-ink-500 bg-ink-800/95 p-2 shadow-2xl backdrop-blur">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#6b7280]">Line {line}</div>
                {thread.map((c) => (
                  <div key={c.id} className="group mb-1 flex items-start gap-2 rounded bg-ink-900/50 px-2 py-1">
                    <span className="flex-1 whitespace-pre-wrap break-words text-xs text-[#d7dbe3]">{c.body}</span>
                    <button
                      onClick={() => onDelete(c.id)}
                      className="shrink-0 text-[#5b6472] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[#f06d6d]"
                      title="Delete comment"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {composing ? (
                  <div className="mt-1">
                    <textarea
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(line)
                        if (e.key === 'Escape') setComposerLine(null)
                      }}
                      rows={2}
                      placeholder="Review comment…  (⌘↵ to save)"
                      className="w-full resize-none rounded border border-ink-500 bg-ink-700 px-2 py-1 text-xs"
                    />
                    <div className="mt-1 flex justify-end gap-1">
                      <button onClick={() => setComposerLine(null)} className="rounded px-2 py-0.5 text-[11px] text-[#8a93a6] hover:bg-ink-700">
                        Cancel
                      </button>
                      <button
                        onClick={() => submit(line)}
                        disabled={!draft.trim()}
                        className="rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-ink-900 disabled:opacity-40 hover:bg-[#8bbcff]"
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setComposerLine(line); setDraft('') }} className="text-[10px] text-accent hover:underline">
                    + reply
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
