import { useEffect, useRef } from 'react'
import { monaco } from '../monaco'

export function MonacoEditor({ value, language }: { value: string; language: string }) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

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
      scrollBeyondLastLine: false,
      smoothScrolling: true
    })
    editor.current = ed
    return () => ed.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const ed = editor.current
    if (!ed) return
    const model = ed.getModel()
    if (model) {
      monaco.editor.setModelLanguage(model, language)
      if (model.getValue() !== value) ed.setValue(value)
    }
  }, [value, language])

  return <div ref={host} className="h-full w-full" />
}
