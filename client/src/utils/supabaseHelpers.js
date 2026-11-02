// Supabase query helpers.
//
// PostgREST (and Supabase) enforce a server-side `max-rows` cap (1000 by
// default). A single `.range(0, N)` request can never return more than that
// cap, so large tables silently truncate at 1000 rows. fetchAllRows walks the
// result in 1000-row pages until a short page signals the end, returning the
// complete set.
//
// Pass a query builder with its filters/order already applied, e.g.:
//   const rows = await fetchAllRows(
//     supabase.from('po_orders').select('*').order('updated_at', { ascending: false })
//   )
// Throws on the first page error (matching the caller-side try/catch pattern).

const PAGE_SIZE = 1000
const MAX_PAGES  = 20   // safety cap → up to 20,000 rows

export async function fetchAllRows(queryBuilder) {
  let allRows = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    const from = page * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1

    const { data, error } = await queryBuilder.range(from, to)
    if (error) throw error

    allRows = allRows.concat(data || [])
    hasMore = (data || []).length === PAGE_SIZE
    page++

    if (page >= MAX_PAGES) break
  }

  return allRows
}
