import { describe, expect, it } from 'vitest'
import type { DiffFile } from '@shared/types'
import { computeBlastRadius } from '../../src/shared/blastRadius'

function file(relPath: string, additions = 5, deletions = 2): DiffFile {
  return { relPath, status: 'modified', additions, deletions, oldContent: '', newContent: '' }
}

describe('computeBlastRadius', () => {
  it('is minimal for no changes', () => {
    const b = computeBlastRadius([])
    expect(b.level).toBe('minimal')
    expect(b.score).toBe(0)
    expect(b.summary).toBe('No changes')
  })

  it('is low for a small single-file change', () => {
    const b = computeBlastRadius([file('src/renderer/components/Foo.tsx', 8, 1)])
    expect(b.level).toBe('low')
    expect(b.filesChanged).toBe(1)
    expect(b.additions).toBe(8)
    expect(b.criticalHits).toEqual([])
  })

  it('counts distinct subsystems (top-2 path segments)', () => {
    const b = computeBlastRadius([
      file('src/main/integrations/A.ts'),
      file('src/main/integrations/B.ts'), // same subsystem
      file('src/renderer/components/C.tsx'),
      file('tests/integration/d.test.ts')
    ])
    expect(b.subsystems).toEqual(['src/main', 'src/renderer', 'tests/integration'])
  })

  it('flags migrations, lockfiles, and CI config as critical hits', () => {
    const b = computeBlastRadius([
      file('src/main/db/migrations.ts'),
      file('package-lock.json', 200, 50),
      file('.github/workflows/ci.yml')
    ])
    const reasons = b.criticalHits.map((h) => h.reason)
    expect(reasons).toContain('migration / schema')
    expect(reasons).toContain('lockfile')
    expect(reasons).toContain('CI/CD pipeline')
    expect(b.level === 'high' || b.level === 'critical').toBe(true) // sensitive files dominate
  })

  it('escalates to critical for a sprawling, sensitive change', () => {
    const files: DiffFile[] = [
      file('src/main/db/migrations.ts', 80, 10),
      file('package.json', 5, 1),
      file('package-lock.json', 300, 120),
      file('.github/workflows/deploy.yml', 40, 5),
      file('src/main/auth/login.ts', 60, 30),
      file('Dockerfile', 10, 2),
      file('src/renderer/components/X.tsx', 50, 5)
    ]
    const b = computeBlastRadius(files)
    expect(b.level).toBe('critical')
    expect(b.score).toBeGreaterThanOrEqual(80)
    expect(b.summary).toMatch(/subsystems/)
  })

  it('treats a root-level file as the (root) subsystem', () => {
    const b = computeBlastRadius([file('README.md')])
    expect(b.subsystems).toEqual(['(root)'])
  })
})
