/**
 * A tiny fuzzy subsequence matcher for the command palette. Scores how well a
 * query matches a target: contiguous runs and word-start hits score higher, so
 * "nc" ranks "New conductor" above a scattered match. Pure + tested.
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  let score = 0
  let streak = 0
  let prev = -2
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    let pts = 1
    if (ti === prev + 1) {
      streak += 1
      pts += streak * 2 // reward contiguous runs
    } else {
      streak = 0
    }
    if (ti === 0 || /[^a-z0-9]/.test(t[ti - 1])) pts += 3 // word-start bonus
    score += pts
    prev = ti
    qi += 1
  }
  if (qi < q.length) return 0 // query is not a subsequence of target
  score += Math.max(0, 8 - t.length / 6) // gently prefer shorter targets
  return score
}

/** Filter + rank items by fuzzy match on `key`. Empty query returns all, unranked. */
export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string): T[] {
  if (!query.trim()) return items
  return items
    .map((item) => ({ item, score: fuzzyScore(query, key(item)) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.item)
}
