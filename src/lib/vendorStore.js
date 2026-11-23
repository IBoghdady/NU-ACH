import { supabase } from './supabaseClient'
import vendorsRaw from './vendors.json'
import vendorLinksRaw from './vendorLinks.json'

/**
 * Normalizes a vendor account or search string for flexible exact/space-insensitive lookup.
 */
export function normalizeCode(val) {
  return String(val || '').trim().toLowerCase().replace(/\s+/g, '')
}

export function stripEmployeeCodeIfVendorTag(code) {
  const s = String(code || '').trim()
  if (!s || /^VA:/i.test(s)) return null
  return s
}

export function parseVendorTagFromEmployeeCode(code) {
  const s = String(code || '').trim()
  if (!/^VA:/i.test(s)) return []
  return s.slice(3).split(',').map(x => x.trim()).filter(Boolean)
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

const STORE_CACHE_TTL_MS = 60 * 1000
let _cachedStore = null
let _cachedStoreAt = 0
let _inFlightStore = null

export function invalidateVendorStoreCache() {
  _cachedStore = null
  _cachedStoreAt = 0
  _inFlightStore = null
}

/**
 * Loads the authoritative merged view of Vendors, Links, and Review Suggestions,
 * combining pre-matched Vendor.xlsx links with any manual overrides stored in Supabase `vendor_links`.
 */
export async function getVendorStore(forceRefresh = false) {
  const now = Date.now()
  if (!forceRefresh && _cachedStore && (now - _cachedStoreAt) < STORE_CACHE_TTL_MS) {
    return _cachedStore
  }
  if (!forceRefresh && _inFlightStore) {
    return _inFlightStore
  }

  _inFlightStore = buildVendorStore()
  try {
    const store = await _inFlightStore
    _cachedStore = store
    _cachedStoreAt = Date.now()
    return store
  } finally {
    _inFlightStore = null
  }
}

async function buildVendorStore() {
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

  // Merge manual Vendor Accounts saved directly on corporate/non-Staff beneficiaries
  try {
    let benRows = []
    let bFrom = 0
    const bLimit = 1000
    while (true) {
      const { data: chunkData, error: chunkErr } = await supabase
        .from('beneficiaries')
        .select('id, name, account_number, bank_bic, category, employee_code')
        .not('employee_code', 'is', null)
        .not('category', 'in', '("Staff","Satff","Students")')
        .order('id', { ascending: true })
        .range(bFrom, bFrom + bLimit - 1)
      if (chunkErr) break
      if (chunkData && chunkData.length > 0) {
        benRows = benRows.concat(chunkData)
        bFrom += bLimit
      }
      if (!chunkData || chunkData.length < bLimit) break
    }

    if (benRows.length > 0) {
      for (const b of benRows) {
        const rawCode = String(b.employee_code || '').trim()
        let vas = parseVendorTagFromEmployeeCode(rawCode)

        // Also treat non-Staff/Student code exact-matching a Vendor.xlsx vendor_account as a vendor link
        if (vas.length === 0 && rawCode && !['Staff', 'Satff', 'Students'].includes(b.category)) {
          const vMatch = staticVendorByExactLower.get(rawCode.toLowerCase()) || staticVendorByNorm.get(normalizeCode(rawCode))
          if (vMatch) vas = [vMatch.va]
        }

        for (const rawVa of vas) {
          const vObj = staticVendorByExactLower.get(rawVa.toLowerCase()) || staticVendorByNorm.get(normalizeCode(rawVa))
          const va = vObj ? vObj.va : rawVa
          const acc = String(b.account_number || '').trim()
          if (!va || !acc) continue
          const key = `${va}::${acc}`
          linkMap.set(key, {
            vendor_account: va,
            vendor_name: vObj ? vObj.n : (b.name || ''),
            ben_id: b.id,
            ben_name: b.name || '',
            account_number: acc,
            bank_bic: b.bank_bic || null,
            category: b.category || 'Vendor',
            method: 'manual',
            score: 1,
            source: 'manual'
          })
        }
      }
    }
  } catch (e) {}

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

  // 1. Exact or space-insensitive match on vendor_account (static vendors + dynamic manual links)
  if (store.staticVendorByExactLower.has(lower)) {
    const v = store.staticVendorByExactLower.get(lower)
    matchedVendors.push(v)
    seenVa.add(v.va.toLowerCase())
  } else if (store.staticVendorByNorm.has(norm)) {
    const v = store.staticVendorByNorm.get(norm)
    matchedVendors.push(v)
    seenVa.add(v.va.toLowerCase())
  } else if (store.linksByVendorAccount.has(lower)) {
    const first = store.linksByVendorAccount.get(lower)[0]
    matchedVendors.push({ va: first.vendor_account, n: first.vendor_name, h: 'No', p: '', g: '', c: 'EGP' })
    seenVa.add(first.vendor_account.toLowerCase())
  } else if (store.linksByVendorNorm.has(norm)) {
    const first = store.linksByVendorNorm.get(norm)[0]
    matchedVendors.push({ va: first.vendor_account, n: first.vendor_name, h: 'No', p: '', g: '', c: 'EGP' })
    seenVa.add(first.vendor_account.toLowerCase())
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
    for (const l of store.links) {
      if (matchedVendors.length >= 50) break
      const lVaLower = String(l.vendor_account || '').toLowerCase()
      const lVaNorm = normalizeCode(l.vendor_account)
      const lVnLower = String(l.vendor_name || '').toLowerCase()
      if (lVaLower.includes(lower) || lVaNorm.includes(norm) || lVnLower.includes(lower)) {
        if (!seenVa.has(lVaLower)) {
          matchedVendors.push({ va: l.vendor_account, n: l.vendor_name, h: 'No', p: '', g: '', c: 'EGP' })
          seenVa.add(lVaLower)
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

/**
 * Resolves canonical Vendor Account & Name from store, and persists a link either in
 * `vendor_links` (when created) or safely via `VA:<code(s)>` in `beneficiaries.employee_code` fallback.
 */
export async function saveVendorLink(store, {
  vendorAccount,
  vendorName = '',
  benId = null,
  benName = '',
  accountNumber,
  method = 'manual',
  replaceExisting = false
}) {
  const vaRaw = String(vendorAccount || '').trim()
  const accTrim = String(accountNumber || '').trim()
  if (!vaRaw || !accTrim) {
    return { saved: false, needsSqlSetup: false, error: 'vendor_account and account_number are required.' }
  }

  const vObj =
    store.staticVendorByExactLower.get(vaRaw.toLowerCase()) ||
    store.staticVendorByNorm.get(normalizeCode(vaRaw))
  const canonicalVa = vObj ? vObj.va : vaRaw
  const resolvedVendorName = vObj ? vObj.n : (vendorName || benName || '')

  // Already linked cleanly in store?
  const existingForAcc = store.linksByBankAccount.get(accTrim) || []
  const alreadyLinked = existingForAcc.some(l => l.vendor_account.toLowerCase() === canonicalVa.toLowerCase())
  if (alreadyLinked && !replaceExisting) {
    return { saved: true, needsSqlSetup: false, vendor_account: canonicalVa, vendor_name: resolvedVendorName }
  }

  if (store.dbAvailable) {
    if (replaceExisting) {
      for (const oldLink of existingForAcc) {
        if (oldLink.vendor_account.toLowerCase() !== canonicalVa.toLowerCase()) {
          await supabase
            .from('vendor_links')
            .upsert({
              vendor_account: oldLink.vendor_account,
              vendor_name: oldLink.vendor_name || null,
              ben_id: benId ? Number(benId) : null,
              ben_name: benName || null,
              account_number: accTrim,
              status: 'unlinked',
              method: 'manual'
            }, { onConflict: 'vendor_account,account_number' })
        }
      }
    }

    const { error: upsertErr } = await supabase
      .from('vendor_links')
      .upsert({
        vendor_account: canonicalVa,
        vendor_name: resolvedVendorName || null,
        ben_id: benId ? Number(benId) : null,
        ben_name: benName || null,
        account_number: accTrim,
        status: 'linked',
        method
      }, { onConflict: 'vendor_account,account_number' })
    if (upsertErr) throw upsertErr

    try {
      const q = supabase.from('beneficiaries').update({ vendor_account: canonicalVa })
      await (benId ? q.eq('id', Number(benId)) : q.eq('account_number', accTrim))
    } catch (e) {}

    invalidateVendorStoreCache()
    return { saved: true, needsSqlSetup: false, vendor_account: canonicalVa, vendor_name: resolvedVendorName }
  }

  // Fallback when vendor_links table has not been created yet in Supabase:
  // Store `VA:<vendor_account>` in beneficiaries.employee_code for non-Staff/Student rows without overwriting EMP/STU codes.
  let benRow = null
  if (benId) {
    const { data } = await supabase.from('beneficiaries').select('id, name, account_number, category, employee_code').eq('id', Number(benId)).limit(1)
    benRow = data?.[0] || null
  }
  if (!benRow) {
    const { data } = await supabase.from('beneficiaries').select('id, name, account_number, category, employee_code').eq('account_number', accTrim).limit(1)
    benRow = data?.[0] || null
  }

  if (benRow) {
    const isStaffOrStudent = ['Staff', 'Satff', 'Students'].includes(benRow.category)
    const rawCode = String(benRow.employee_code || '').trim()
    const isVendorTagged = /^VA:/i.test(rawCode)
    const existingVas = parseVendorTagFromEmployeeCode(rawCode)
    const isSameStaticVa = rawCode && rawCode.toLowerCase() === canonicalVa.toLowerCase()

    if (!isStaffOrStudent && (!rawCode || isVendorTagged || isSameStaticVa)) {
      const nextVas = replaceExisting
        ? [canonicalVa]
        : Array.from(new Set([...existingVas, canonicalVa]))
      const newTag = `VA:${nextVas.join(',')}`
      const { error: updErr } = await supabase
        .from('beneficiaries')
        .update({ employee_code: newTag })
        .eq('id', benRow.id)
      if (!updErr) {
        invalidateVendorStoreCache()
        return { saved: true, needsSqlSetup: false, vendor_account: canonicalVa, vendor_name: resolvedVendorName, usedFallback: true }
      }
    }
  }

  if (alreadyLinked) {
    return { saved: true, needsSqlSetup: false, vendor_account: canonicalVa, vendor_name: resolvedVendorName }
  }

  return { saved: false, needsSqlSetup: true, vendor_account: canonicalVa, vendor_name: resolvedVendorName }
}

/**
 * Unlinks a Vendor Account from a bank account (supports both `vendor_links` table and `VA:` fallback).
 */
export async function removeVendorLink(store, {
  vendorAccount = '',
  vendorName = '',
  benId = null,
  benName = '',
  accountNumber
}) {
  const vaTrim = String(vendorAccount || '').trim()
  const accTrim = String(accountNumber || '').trim()

  if (store.dbAvailable) {
    const targets = vaTrim
      ? [{ va: vaTrim, vn: vendorName }]
      : (store.linksByBankAccount.get(accTrim) || []).map(l => ({ va: l.vendor_account, vn: l.vendor_name }))

    for (const t of targets) {
      const { error } = await supabase
        .from('vendor_links')
        .upsert({
          vendor_account: t.va,
          vendor_name: t.vn || null,
          ben_id: benId ? Number(benId) : null,
          ben_name: benName || null,
          account_number: accTrim,
          status: 'unlinked',
          method: 'manual'
        }, { onConflict: 'vendor_account,account_number' })
      if (error) throw error
    }

    try {
      const q = supabase.from('beneficiaries').update({ vendor_account: null })
      await (benId ? q.eq('id', Number(benId)) : q.eq('account_number', accTrim))
    } catch (e) {}

    // Also strip any fallback VA tag on beneficiaries row if present
    try {
      const { data } = await (benId
        ? supabase.from('beneficiaries').select('id, employee_code').eq('id', Number(benId)).limit(1)
        : supabase.from('beneficiaries').select('id, employee_code').eq('account_number', accTrim).limit(1))
      const row = data?.[0]
      if (row && /^VA:/i.test(String(row.employee_code || ''))) {
        const remaining = vaTrim
          ? parseVendorTagFromEmployeeCode(row.employee_code).filter(v => v.toLowerCase() !== vaTrim.toLowerCase())
          : []
        await supabase.from('beneficiaries').update({
          employee_code: remaining.length > 0 ? `VA:${remaining.join(',')}` : null
        }).eq('id', row.id)
      }
    } catch (e) {}

    invalidateVendorStoreCache()
    return { saved: true, needsSqlSetup: false }
  }

  // Fallback check: can unlink if stored via VA: tag or exact matching vendor code on beneficiaries.employee_code
  const { data } = await (benId
    ? supabase.from('beneficiaries').select('id, category, employee_code').eq('id', Number(benId)).limit(1)
    : supabase.from('beneficiaries').select('id, category, employee_code').eq('account_number', accTrim).limit(1))
  const row = data?.[0]
  if (row) {
    const rawCode = String(row.employee_code || '').trim()
    const isTagged = /^VA:/i.test(rawCode)
    const isLegacyNonStaffVa = rawCode && !['Staff', 'Satff', 'Students'].includes(row.category) && (!vaTrim || rawCode.toLowerCase() === vaTrim.toLowerCase())
    if (isTagged || isLegacyNonStaffVa) {
      const remaining = isTagged && vaTrim
        ? parseVendorTagFromEmployeeCode(rawCode).filter(v => v.toLowerCase() !== vaTrim.toLowerCase())
        : []
      const { error } = await supabase
        .from('beneficiaries')
        .update({ employee_code: remaining.length > 0 ? `VA:${remaining.join(',')}` : null })
        .eq('id', row.id)
      if (!error) {
        invalidateVendorStoreCache()
        return { saved: true, needsSqlSetup: false }
      }
    }
  }

  return { saved: false, needsSqlSetup: true }
}
