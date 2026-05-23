import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { FileContent, FileEntry } from '@shared/types'

const MAX_BYTES = 1_000_000 // editor cap (1 MB)
const IGNORE = new Set(['node_modules', '.git', 'out', 'dist', '.DS_Store', '.vite'])

/** Resolve `relPath` under `root`, refusing anything that escapes the root. */
function safeResolve(root: string, relPath: string): string {
  const r = resolve(root)
  const target = resolve(r, relPath || '.')
  if (target !== r && !target.startsWith(r + sep)) {
    throw new Error('path escapes session root')
  }
  return target
}

export async function listDir(root: string, relPath: string): Promise<FileEntry[]> {
  const dir = safeResolve(root, relPath)
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => !IGNORE.has(e.name))
    .map((e) => ({ name: e.name, relPath: join(relPath, e.name), isDir: e.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
}

export async function readFileScoped(root: string, relPath: string): Promise<FileContent> {
  const file = safeResolve(root, relPath)
  const info = await stat(file)
  const buf = await readFile(file)
  return {
    relPath,
    content: buf.subarray(0, MAX_BYTES).toString('utf8'),
    language: languageFromPath(relPath),
    truncated: info.size > MAX_BYTES
  }
}

function languageFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sql: 'sql',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini'
  }
  return map[ext] ?? 'plaintext'
}
