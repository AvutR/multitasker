import { describe, expect, it } from 'vitest'
import type { DiffFile, DiffStatus } from '@shared/types'
import { computeBlastRadius, landRisk, reviewVerdict } from '../../src/shared/blastRadius'

function file(relPath: string, additions = 5, deletions = 2, status: DiffStatus = 'modified'): DiffFile {
  return { relPath, status, additions, deletions, oldContent: '', newContent: '' }
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

  it('reviewVerdict triages the finished diff for the queue', () => {
    // safe: contained change with tests present.
    const safe = computeBlastRadius([file('src/renderer/components/Foo.tsx', 8, 1), file('tests/integration/foo.test.ts', 6, 0)])
    expect(reviewVerdict(safe)).toBe('safe')

    // likely-wrong: sweeping + sensitive change with NO tests (a real test gap).
    const bad = computeBlastRadius([
      file('src/main/db/migrations.ts', 80, 10),
      file('src/main/auth/login.ts', 60, 30),
      file('package-lock.json', 300, 120),
      file('.github/workflows/deploy.yml', 40, 5),
      file('src/renderer/components/X.tsx', 50, 5)
    ])
    expect(bad.testGap).toBe(true)
    expect(reviewVerdict(bad)).toBe('likely-wrong')

    // needs-eyes: touches a sensitive path (migration) but tests are present.
    const eyes = computeBlastRadius([file('src/main/db/migrations.ts', 20, 4), file('tests/integration/m.test.ts', 10, 0)])
    expect(eyes.testGap).toBe(false)
    expect(eyes.criticalHits.length).toBeGreaterThan(0)
    expect(reviewVerdict(eyes)).toBe('needs-eyes')
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

describe('computeBlastRadius — in-depth signals', () => {
  it('flags a test gap when source changes but no tests do', () => {
    expect(computeBlastRadius([file('src/main/foo.ts', 40, 5)]).testGap).toBe(true)
    expect(computeBlastRadius([file('docs/readme.md')]).testGap).toBe(false) // non-source change
  })

  it('clears the test gap when a test file is part of the change', () => {
    const b = computeBlastRadius([file('src/main/foo.ts', 40, 5), file('tests/foo.test.ts', 20, 0)])
    expect(b.testGap).toBe(false)
  })

  it('counts deleted files', () => {
    const b = computeBlastRadius([
      file('src/a.ts', 0, 30, 'deleted'),
      file('src/b.ts', 0, 12, 'deleted'),
      file('src/c.ts', 5, 1)
    ])
    expect(b.deletedFiles).toBe(2)
  })

  it('produces an explainable factor breakdown that omits zero terms', () => {
    const b = computeBlastRadius([file('src/main/a.ts', 50, 5), file('src/renderer/b.tsx', 30, 2)])
    const labels = b.factors.map((f) => f.label)
    expect(labels).toContain('Breadth')
    expect(labels).toContain('Cross-cutting') // 2 subsystems
    expect(b.factors.every((f) => f.points > 0)).toBe(true)
    // factors should roughly sum toward the score (capped terms aside)
    expect(b.factors.reduce((s, f) => s + f.points, 0)).toBeGreaterThan(0)
  })

  it('ranks the most-churned files first (top 5)', () => {
    const b = computeBlastRadius([
      file('small.ts', 1, 0),
      file('huge.ts', 300, 100),
      file('mid.ts', 40, 10)
    ])
    expect(b.topFiles.map((f) => f.path)).toEqual(['huge.ts', 'mid.ts', 'small.ts'])
    expect(b.topFiles[0].churn).toBe(400)
  })

  it('treats shared/public-surface files as a critical hit', () => {
    const b = computeBlastRadius([file('src/shared/types.ts', 20, 5)])
    expect(b.criticalHits.map((h) => h.reason)).toContain('public surface / shared API')
  })
})

describe('landRisk — soft pre-commit gate', () => {
  it('is not risky for a small change with tests', () => {
    const r = landRisk(computeBlastRadius([file('src/a.ts', 5, 1), file('a.test.ts', 10, 0)]))
    expect(r.risky).toBe(false)
    expect(r.reasons).toEqual([])
  })

  it('is risky when source changes without tests, and says so', () => {
    const r = landRisk(computeBlastRadius([file('src/a.ts', 30, 2)]))
    expect(r.risky).toBe(true)
    expect(r.reasons).toContain('source changed but no tests')
  })

  it('is risky for a high/critical blast radius and explains why', () => {
    const r = landRisk(
      computeBlastRadius([
        file('src/main/db/migrations.ts', 80, 10),
        file('package-lock.json', 300, 120),
        file('.github/workflows/deploy.yml', 40, 5),
        file('src/main/auth/login.ts', 60, 30)
      ])
    )
    expect(r.risky).toBe(true)
    expect(r.reasons[0]).toMatch(/blast radius/)
    expect(r.reasons.some((x) => x.startsWith('touches'))).toBe(true)
  })
})
