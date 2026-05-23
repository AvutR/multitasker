import { useState } from 'react'
import { useStore } from '../store/store'

export function NewSessionModal({ onClose }: { onClose: () => void }) {
  const presets = useStore((s) => s.presets)
  const repos = useStore((s) => s.repos)
  const spawn = useStore((s) => s.spawn)
  const addRepo = useStore((s) => s.addRepo)

  const [presetId, setPresetId] = useState('auto')
  const [cwd, setCwd] = useState(repos[0]?.path ?? '')
  const [newRepoPath, setNewRepoPath] = useState('')
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  // Optional automation links (lifecycle updates on other apps).
  const [showLinks, setShowLinks] = useState(false)
  const [linearIssueId, setLinearIssueId] = useState('')
  const [notionPageId, setNotionPageId] = useState('')
  const [slackChannel, setSlackChannel] = useState('')
  const [autoUpdates, setAutoUpdates] = useState(true)

  const preset = presets.find((p) => p.id === presetId)
  const canSubmit = prompt.trim().length > 0 && cwd.trim().length > 0 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      await spawn({
        prompt: prompt.trim(),
        presetId,
        cwd: cwd.trim(),
        title: title.trim() || undefined,
        linearIssueId: linearIssueId.trim() || undefined,
        notionPageId: notionPageId.trim() || undefined,
        slackChannel: slackChannel.trim() || undefined,
        autoUpdates
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const registerRepo = async () => {
    const path = newRepoPath.trim()
    if (!path) return
    await addRepo(path)
    setCwd(path)
    setNewRepoPath('')
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[90vh] w-[600px] overflow-y-auto rounded-lg border border-ink-500 bg-ink-800 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-sm font-semibold text-white">New agent session</div>

        <Label text="Preset">
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="w-full rounded border border-ink-500 bg-ink-700 px-2 py-1.5 text-sm"
          >
            <option value="auto">Auto — detect the right skill from the task</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] leading-snug text-[#6b7280]">
            {preset
              ? preset.description
              : 'Picks the matching skill/pipeline from your task — feature work → /build, "standup" → standup, "linear" → Linear sync — no slash command needed.'}
          </p>
        </Label>

        <Label text="Working directory">
          <input
            list="repo-paths"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/absolute/path/to/repo"
            className="w-full rounded border border-ink-500 bg-ink-700 px-2 py-1.5 font-mono text-xs"
          />
          <datalist id="repo-paths">
            {repos.map((r) => (
              <option key={r.id} value={r.path} />
            ))}
          </datalist>
          <div className="mt-1.5 flex gap-2">
            <input
              value={newRepoPath}
              onChange={(e) => setNewRepoPath(e.target.value)}
              placeholder="…or register a new repo path"
              className="flex-1 rounded border border-ink-600 bg-ink-900 px-2 py-1 font-mono text-[11px]"
            />
            <button
              onClick={() => void registerRepo()}
              className="rounded bg-ink-600 px-2 py-1 text-xs text-[#b9c0cc] hover:bg-ink-500"
            >
              Add repo
            </button>
          </div>
        </Label>

        <Label text="Title (optional)">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Auto-derived from the prompt if blank"
            className="w-full rounded border border-ink-500 bg-ink-700 px-2 py-1.5 text-sm"
          />
        </Label>

        <Label text="Task / prompt">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            autoFocus
            placeholder="What should this agent do?"
            className="w-full resize-none rounded border border-ink-500 bg-ink-700 px-2 py-1.5 text-sm"
          />
        </Label>

        <button
          onClick={() => setShowLinks((v) => !v)}
          className="mb-2 text-[11px] font-medium text-accent hover:underline"
        >
          {showLinks ? '▾' : '▸'} Automatic updates (optional)
        </button>
        {showLinks && (
          <div className="mb-3 rounded border border-ink-600 bg-ink-900/40 p-2.5">
            <p className="mb-2 text-[11px] text-[#6b7280]">
              Link a work item and Multitasker auto-posts lifecycle updates (start → In Progress, landed → In
              Review + Slack), routed through the policy engine.
            </p>
            <LinkInput label="Linear issue" value={linearIssueId} onChange={setLinearIssueId} placeholder="ENG-1234" />
            <LinkInput label="Notion page" value={notionPageId} onChange={setNotionPageId} placeholder="page id or URL" />
            <LinkInput label="Slack channel" value={slackChannel} onChange={setSlackChannel} placeholder="#eng" />
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-[#8a93a6]">
              <input type="checkbox" checked={autoUpdates} onChange={(e) => setAutoUpdates(e.target.checked)} />
              Auto-post lifecycle updates for this session
            </label>
          </div>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-[#8a93a6] hover:bg-ink-700">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-ink-900 disabled:opacity-40 hover:bg-[#8bbcff]"
          >
            {busy ? 'Spawning…' : 'Spawn agent'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">{text}</span>
      {children}
    </label>
  )
}

function LinkInput({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] text-[#8a93a6]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded border border-ink-600 bg-ink-700 px-2 py-1 text-xs"
      />
    </div>
  )
}
