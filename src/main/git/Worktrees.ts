import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { simpleGit } from 'simple-git'
import type { CommitResult, DiffFile, DiffStatus, RepoInfo } from '@shared/types'

/** Creates per-session git worktrees so parallel agents never collide in the
 *  working tree. Worktrees live under a dedicated base dir (outside the repo). */
export class WorktreeManager {
  constructor(private baseDir: string) {}

  /** Create a fresh branch + worktree from the repo's current HEAD. Returns null
   *  if the repo can't support a worktree (e.g. no commits yet) — the caller
   *  then falls back to running in the repo root. */
  async create(repoPath: string, branch: string): Promise<{ worktreePath: string; branch: string } | null> {
    const git = simpleGit(repoPath)
    const safeBranch = branch.replace(/[^\w./-]/g, '_')
    const worktreePath = join(this.baseDir, basename(repoPath), safeBranch.replace(/\//g, '__'))
    try {
      await mkdir(dirname(worktreePath), { recursive: true })
      await git.raw(['worktree', 'add', '-b', safeBranch, worktreePath, 'HEAD'])
      return { worktreePath, branch: safeBranch }
    } catch {
      return null
    }
  }
}

export async function readRepoMeta(repoPath: string): Promise<RepoInfo> {
  let defaultBranch = 'main'
  try {
    const branch = await simpleGit(repoPath).revparse(['--abbrev-ref', 'HEAD'])
    if (branch && branch !== 'HEAD') defaultBranch = branch.trim()
  } catch {
    // not a git repo or no commits — leave the default
  }
  return {
    id: randomUUID(),
    path: repoPath,
    name: basename(repoPath),
    defaultBranch,
    addedAt: Date.now()
  }
}

/** Working-tree diff against HEAD for review (feeds the Monaco DiffEditor). */
export async function computeDiff(cwd: string): Promise<DiffFile[]> {
  const git = simpleGit(cwd)
  const status = await git.status()
  const out: DiffFile[] = []

  for (const f of status.files) {
    const rel = f.path
    const untracked = f.index === '?' && f.working_dir === '?'
    const deleted = f.working_dir === 'D' || f.index === 'D'
    const renamed = f.index === 'R'

    const oldContent = clampContent(untracked ? '' : await git.show([`HEAD:${rel}`]).catch(() => ''))
    const newContent = clampContent(deleted ? '' : await readFile(join(cwd, rel), 'utf8').catch(() => ''))

    out.push({
      relPath: rel,
      status: classify(untracked, deleted, renamed, f.index),
      ...countLines(oldContent, newContent),
      oldContent,
      newContent
    })
  }
  return out
}

/** Stage everything in the (session-isolated) worktree and commit. Local only —
 *  never pushes (no-remote constraint). */
export async function commitAll(cwd: string, message: string): Promise<CommitResult> {
  const git = simpleGit(cwd)
  const status = await git.status()
  if (status.files.length === 0) return { committed: false, reason: 'nothing to commit — working tree clean' }
  await git.add(['-A'])
  const res = await git.commit(message)
  return { committed: true, hash: res.commit }
}

const MAX_DIFF_BYTES = 256_000

// Keep the main process responsive and the IPC payload small: don't ship huge
// or binary blobs to the diff view. Binary files decoded as utf-8 contain the
// replacement char (U+FFFD), which we use as a cheap binary sniff.
function clampContent(s: string): string {
  if (s.includes('�')) return '(binary file — not shown)'
  if (s.length > MAX_DIFF_BYTES) return `${s.slice(0, MAX_DIFF_BYTES)}\n… (truncated)`
  return s
}

function classify(untracked: boolean, deleted: boolean, renamed: boolean, index: string): DiffStatus {
  if (untracked) return 'untracked'
  if (deleted) return 'deleted'
  if (renamed) return 'renamed'
  if (index === 'A') return 'added'
  return 'modified'
}

// Approximate badge counts; the DiffEditor renders the precise line-level diff.
function countLines(oldContent: string, newContent: string): { additions: number; deletions: number } {
  const o = oldContent ? oldContent.split('\n').length : 0
  const n = newContent ? newContent.split('\n').length : 0
  if (o === 0) return { additions: n, deletions: 0 }
  if (n === 0) return { additions: 0, deletions: o }
  return { additions: Math.max(0, n - o), deletions: Math.max(0, o - n) }
}
