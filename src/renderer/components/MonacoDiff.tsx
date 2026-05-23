import { useEffect, useRef } from 'react'
import { monaco } from '../monaco'

export function MonacoDiff({
  original,
  modified,
  language
}: {
  original: string
  modified: string
  language: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const diff = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  useEffect(() => {
    if (!host.current) return
    const d = monaco.editor.createDiffEditor(host.current, {
      theme: 'multitasker-dark',
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      fontSize: 12,
      scrollBeyondLastLine: false
    })
    diff.current = d
    return () => d.dispose()
  }, [])

  useEffect(() => {
    const d = diff.current
    if (!d) return
    const o = monaco.editor.createModel(original, language)
    const m = monaco.editor.createModel(modified, language)
    d.setModel({ original: o, modified: m })
    return () => {
      o.dispose()
      m.dispose()
    }
  }, [original, modified, language])

  return <div ref={host} className="h-full w-full" />
}
