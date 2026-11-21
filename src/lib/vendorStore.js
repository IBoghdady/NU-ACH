import { supabase } from './supabaseClient'
import vendorsRaw from './vendors.json'
import vendorLinksRaw from './vendorLinks.json'

/**
 * Normalizes a vendor account or search string for flexible exact/space-insensitive lookup.
 */
export function normalizeCode(val) {
  return String(val || '').trim().toLowerCase().replace(/\s+/g, '')
}

// Pre-index static vendors once at module load
const staticVendorByNorm = new Map()
const staticVendorByExactLower = new Map()

for (const v of vendorsRaw) {
  const exact = String(v.va || '').trim().toLowerCase()
  const norm = normalizeCode(v.va)
  if (exact && !staticVendorByExactLower.has(exact)) {
    staticVendorByExactLower.set(exact, v)
  }
  if (norm && !staticVendorByNorm.has(norm)) {
    staticVendorByNorm.set(norm, v)
  }
}

/**
 * Loads the authoritative merged view of Vendors, Links, and Review Suggestions,
 * combining pre-matched Vendor.xlsx links with any manual overrides stored in Supabase `vendor_links`.
 */
export async function getVendorStore() {
  let dbRows = []
  let dbAvailable = true

  try {
    let from = 0
    const limit = 1000
    while (true) {
      const { data, error } = await supabase
        .from('vendor_links')
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + limit - 1)

      if (error) {
        dbAvailable = false
        break
      }
      if (data && data.length > 0) {
        dbRows = dbRows.concat(data)
        from += limit
      }
      if (!data || data.length < limit) break
    }
  } catch (e) {
    dbAvailable = false
  }

  // Merge static links + DB overrides keyed by `${vendor_account}::${account_number}`
  const linkMap = new Map()
  const rejectedReviewKeys = new Set()

  const baseLinks = Array.isArray(vendorLinksRaw?.links) ? vendorLinksRaw.links : []
  for (const item of baseLinks) {
    const key = `${String(item.va).trim()}::${String(item.acc).trim()}`
    linkMap.set(key, {
      vendor_account: String(item.va).trim(),
      vendor_name: item.vn || '',
      ben_id: item.bid || null,
      ben_name: item.bn || '',
      account_number: String(item.acc).trim(),
      bank_bic: item.bic || null,
      category: item.cat || 'Operational',
      method: item.m || 'auto',
      score: item.s || 1,
      source: 'auto'
    })
  }

  for (const row of dbRows) {
    const va = String(row.vendor_account || '').trim()
    const acc = String(row.account_number || '').trim()
    if (!va || !acc) continue
    const key = `${va}::${acc}`

    if (row.status === 'linked') {
      const vObj = staticVendorByExactLower.get(va.toLowerCase()) || staticVendorByNorm.get(normalizeCode(va))
      linkMap.set(key, {
        vendor_account: vObj ? vObj.va : va,
        vendor_name: row.vendor_name || (vObj ? vObj.n : ''),
        ben_id: row.ben_id || null,
        ben_name: row.ben_name || '',
        account_number: acc,
        bank_bic: null,
        category: 'Operational',
        method: row.method || 'manual',
        score: 1,
        source: 'manual'
      })
    } else if (row.status === 'unlinked') {
      linkMap.delete(key)
    } else if (row.status === 'rejected_review') {
      rejectedReviewKeys.add(key)
    }
  }

  const links = Array.from(linkMap.values())

  // Build fast lookup indices
  const linksByVendorAccount = new Map()
  const linksByVendorNorm = new Map()
  const linksByBankAccount = new Map()
  const linksByBenId = new Map()
  const linkedVendorAccounts = new Set()
  const linkedBankAccounts = new Set()
  const linkedBenIds = new Set()

  for (const l of links) {
    const vaLower = l.vendor_account.toLowerCase()
    const vaNorm = normalizeCode(l.vendor_account)
    const accTrim = l.account_number.trim()

    linkedVendorAccounts.add(vaLower)
    linkedBankAccounts.add(accTrim)
    if (l.ben_id != null) linkedBenIds.add(Number(l.ben_id))

    if (!linksByVendorAccount.has(vaLower)) linksByVendorAccount.set(vaLower, [])
    linksByVendorAccount.get(vaLower).push(l)

    if (!linksByVendorNorm.has(vaNorm)) linksByVendorNorm.set(vaNorm, [])
    linksByVendorNorm.get(vaNorm).push(l)

    if (!linksByBankAccount.has(accTrim)) linksByBankAccount.set(accTrim, [])
    linksByBankAccount.get(accTrim).push(l)

    if (l.ben_id != null) {
      const bid = Number(l.ben_id)
      if (!linksByBenId.has(bid)) linksByBenId.set(bid, [])
      linksByBenId.get(bid).push(l)
    }
  }

  // Filter review list (exclude any rejected or already linked pairs)
  const baseReview = Array.isArray(vendorLinksRaw?.review) ? vendorLinksRaw.review : []
  const review = baseReview.filter(item => {
    const vaLower = String(item.va || '').trim().toLowerCase()
    if (linkedVendorAccounts.has(vaLower)) return false
    const accs = Array.isArray(item.accs) ? item.accs : []
    // Hide if every candidate account was explicitly rejected for this vendor or is already linked
    const hasPendingAcc = accs.some(acc => {
      const key = `${String(item.va).trim()}::${String(acc).trim()}`
      return !rejectedReviewKeys.has(key) && !linkedBankAccounts.has(String(acc).trim())
    })
    return hasPendingAcc
  })

  return {
    vendors: vendorsRaw,
    staticVendorByExactLower,
    staticVendorByNorm,
    links,
    review,
    linksByVendorAccount,
    linksByVendorNorm,
    linksByBankAccount,
    linksByBenId,
    linkedVendorAccounts,
    linkedBankAccounts,
    linkedBenIds,
    dbAvailable
  }
}

/**
 * Given a search string (e.g. "200127918" or "EMP005"), resolves matching vendor(s) and linked bank account numbers.
 * @param {object} store - output of getVendorStore()
 * @param {string} query - search string
 * @param {boolean} allowPartial - true for dedicated Vendor Account filter, false for generic search bar
 */
export function resolveVendorAccountsFromQuery(store, query, allowPartial = false) {
  const raw = String(query || '').trim()
  if (!raw) return { matchedVendors: [], linkedAccounts: [], links: [] }

  const lower = raw.toLowerCase()
  const norm = normalizeCode(raw)
  const matchedVendors = []
  const seenVa = new Set()

  // 1. Exact or space-insensitive match on vendor_account
  if (store.staticVendorByExactLower.has(lower)) {
    const v = store.staticVendorByExactLower.get(lower)
    matchedVendors.push(v)
    seenVa.add(v.va.toLowerCase())
  } else if (store.staticVendorByNorm.has(norm)) {
    const v = store.staticVendorByNorm.get(norm)
    matchedVendors.push(v)
    seenVa.add(v.va.toLowerCase())
  }

  // 2. Partial match on vendor_account or vendor_name (only when allowPartial=true and query >= 2 chars)
  if (allowPartial && raw.length >= 2 && matchedVendors.length === 0) {
    for (const v of store.vendors) {
      const vVaLower = String(v.va || '').toLowerCase()
      const vVaNorm = normalizeCode(v.va)
      const vNameLower = String(v.n || '').toLowerCase()
      if (vVaLower.includes(lower) || vVaNorm.includes(norm) || vNameLower.includes(lower)) {
        if (!seenVa.has(vVaLower)) {
          matchedVendors.push(v)
          seenVa.add(vVaLower)
          if (matchedVendors.length >= 50) break
        }
      }
    }
  }

  const linkedAccountsSet = new Set()
  const matchedLinks = []

  for (const v of matchedVendors) {
    const vLinks = store.linksByVendorAccount.get(String(v.va).toLowerCase()) || []
    for (const l of vLinks) {
      linkedAccountsSet.add(l.account_number)
      matchedLinks.push(l)
    }
  }

  return {
    matchedVendors,
    linkedAccounts: Array.from(linkedAccountsSet),
    links: matchedLinks
  }
}
