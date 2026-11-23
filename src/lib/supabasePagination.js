/**
 * Fetches all rows matching a Supabase query builder factory using concurrent 1000-row range batches.
 * @param {Function} buildQuery - function returning a fresh Supabase query with `{ count: 'exact' }` and deterministic `.order()`
 * @returns {Promise<Array>}
 */
export async function fetchAllPaginated(buildQuery) {
  const PAGE_SIZE = 1000
  const { data: firstPage, count, error } = await buildQuery().range(0, PAGE_SIZE - 1)
  if (error) throw error
  if (!firstPage || firstPage.length === 0) return []
  if (firstPage.length < PAGE_SIZE || !count || count <= PAGE_SIZE) {
    return firstPage
  }

  let allRows = firstPage
  const offsets = []
  for (let off = PAGE_SIZE; off < count; off += PAGE_SIZE) {
    offsets.push(off)
  }

  const CONCURRENCY = 12
  for (let i = 0; i < offsets.length; i += CONCURRENCY) {
    const batch = offsets.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(off => buildQuery().range(off, off + PAGE_SIZE - 1))
    )
    for (const r of results) {
      if (r.error) throw r.error
      if (r.data && r.data.length > 0) {
        allRows = allRows.concat(r.data)
      }
    }
  }
  return allRows
}
