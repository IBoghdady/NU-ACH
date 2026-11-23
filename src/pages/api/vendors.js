import { supabase } from '../../lib/supabaseClient'
import {
  getVendorStore,
  normalizeCode,
  saveVendorLink,
  removeVendorLink,
  stripEmployeeCodeIfVendorTag
} from '../../lib/vendorStore'
import { fetchAllPaginated } from '../../lib/supabasePagination'

const BENS_CACHE_TTL_MS = 45 * 1000
let _cachedBensList = null
let _cachedBensAt = 0

export function invalidateVendorsBenCache() {
  _cachedBensList = null
  _cachedBensAt = 0
}

async function fetchAllBeneficiariesFromDB() {
  const now = Date.now()
  if (_cachedBensList && (now - _cachedBensAt) < BENS_CACHE_TTL_MS) {
    return _cachedBensList
  }
  const all = await fetchAllPaginated(() =>
    supabase
      .from('beneficiaries')
      .select('id, name, account_number, bank_bic, category, employee_code', { count: 'exact' })
      .order('id', { ascending: true })
  )
  _cachedBensList = all
  _cachedBensAt = Date.now()
  return all
}

function isMobileAccount(acc) {
  const digits = String(acc || '').replace(/[\s-]/g, '')
  return /^01[0125]\d{8}$/.test(digits)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    const store = await getVendorStore()

    if (req.method === 'GET') {
      const {
        action = 'directory',
        q = '',
        selectedVa = '',
        tab = 'linked',
        page = '1',
        limit = '30',
        search = '',
        group = 'All',
        hold = 'All',
        benFilter = 'operational_no_mobile'
      } = req.query

      // 1. VENDOR ACCOUNT / NAME LOOKUP WITH LINKED ACCOUNTS & TRANSFERS
      if (action === 'lookup') {
        const query = String(q || '').trim()
        if (!query) {
          return res.status(200).json({ matches: [], activeVendor: null, linkedBeneficiaries: [], transactions: [], txStats: null })
        }

        const lower = query.toLowerCase()
        const norm = normalizeCode(query)

        // Score matches: exact VA > norm VA > prefix VA > substring VA > vendor name > linked ben name / account
        const scoredMatches = []
        const seenVa = new Set()

        const pushVendor = (v, rank) => {
          const vaKey = String(v.va || '').toLowerCase()
          if (seenVa.has(vaKey)) return
          seenVa.add(vaKey)
          const vLinks = store.linksByVendorAccount.get(vaKey) || []
          scoredMatches.push({
            vendor_account: v.va,
            vendor_name: v.n,
            vendor_hold: v.h,
            phone: v.p,
            group: v.g,
            currency: v.c,
            linkedCount: vLinks.length,
            linkedAccounts: vLinks.map(l => l.account_number),
            _rank: rank
          })
        }

        for (const v of store.vendors) {
          const vaL = String(v.va || '').toLowerCase()
          const vaN = normalizeCode(v.va)
          const vnL = String(v.n || '').toLowerCase()
          if (vaL === lower || vaN === norm) pushVendor(v, 100)
          else if (vaL.startsWith(lower) || vaN.startsWith(norm)) pushVendor(v, 80)
          else if (vaL.includes(lower) || vaN.includes(norm)) pushVendor(v, 60)
          else if (vnL.includes(lower)) pushVendor(v, 40)
        }

        // Also check if query matches a linked bank account, beneficiary name, or custom linked vendor account
        for (const l of store.links) {
          const lVaL = String(l.vendor_account || '').toLowerCase()
          const lVnL = String(l.vendor_name || '').toLowerCase()
          const accL = String(l.account_number || '').toLowerCase()
          const bnL = String(l.ben_name || '').toLowerCase()
          if (lVaL.includes(lower) || lVnL.includes(lower) || accL.includes(lower) || bnL.includes(lower)) {
            const vObj = store.staticVendorByExactLower.get(lVaL) || {
              va: l.vendor_account,
              n: l.vendor_name,
              h: '',
              p: '',
              g: '',
              c: 'EGP'
            }
            const rank = (lVaL === lower || accL === lower) ? 95 : 50
            pushVendor(vObj, rank)
          }
        }

        scoredMatches.sort((a, b) => {
          if (b._rank !== a._rank) return b._rank - a._rank
          if ((b.linkedCount > 0) !== (a.linkedCount > 0)) return b.linkedCount - a.linkedCount
          return a.vendor_account.localeCompare(b.vendor_account)
        })

        const topMatches = scoredMatches.slice(0, 30)
        let activeVendor = null
        if (selectedVa) {
          activeVendor = topMatches.find(m => m.vendor_account.toLowerCase() === selectedVa.toLowerCase()) || null
          if (!activeVendor) {
            const vObj = store.staticVendorByExactLower.get(selectedVa.toLowerCase()) || store.staticVendorByNorm.get(normalizeCode(selectedVa))
            if (vObj) {
              const vLinks = store.linksByVendorAccount.get(String(vObj.va).toLowerCase()) || []
              activeVendor = {
                vendor_account: vObj.va,
                vendor_name: vObj.n,
                vendor_hold: vObj.h,
                phone: vObj.p,
                group: vObj.g,
                currency: vObj.c,
                linkedCount: vLinks.length,
                linkedAccounts: vLinks.map(l => l.account_number)
              }
            }
          }
        }
        if (!activeVendor && topMatches.length > 0) {
          activeVendor = topMatches[0]
        }

        let linkedBeneficiaries = []
        let transactions = []
        let txStats = { totalVolume: 0, totalCount: 0, acceptedCount: 0, rejectedCount: 0, returnedCount: 0 }

        if (activeVendor) {
          const vLinks = store.linksByVendorAccount.get(activeVendor.vendor_account.toLowerCase()) || []
          const benIds = [...new Set(vLinks.map(l => l.ben_id).filter(Boolean))]
          const accNums = [...new Set(vLinks.map(l => l.account_number).filter(Boolean))]

          if (benIds.length > 0 || accNums.length > 0) {
            // Fetch live beneficiary records from Supabase
            let liveBens = []
            if (benIds.length > 0) {
              const { data } = await supabase.from('beneficiaries').select('*').in('id', benIds)
              if (data) liveBens = liveBens.concat(data)
            }
            const seenBenIds = new Set(liveBens.map(b => b.id))
            const missingAccs = accNums.filter(a => !liveBens.some(b => b.account_number === a))
            if (missingAccs.length > 0) {
              const { data } = await supabase.from('beneficiaries').select('*').in('account_number', missingAccs)
              if (data) {
                for (const b of data) {
                  if (!seenBenIds.has(b.id)) {
                    liveBens.push(b)
                    seenBenIds.add(b.id)
                  }
                }
              }
            }

            // Merge link metadata with live beneficiary rows
            linkedBeneficiaries = vLinks.map(l => {
              const live = liveBens.find(b => (l.ben_id && b.id === Number(l.ben_id)) || b.account_number === l.account_number)
              return {
                ben_id: live ? live.id : l.ben_id,
                name: live ? live.name : l.ben_name,
                account_number: live ? live.account_number : l.account_number,
                bank_bic: live ? live.bank_bic : l.bank_bic,
                category: live ? live.category : l.category,
                employee_code: live ? stripEmployeeCodeIfVendorTag(live.employee_code) : null,
                method: l.method,
                score: l.score,
                source: l.source
              }
            })

            const liveAccounts = [...new Set(linkedBeneficiaries.map(b => b.account_number).filter(Boolean))]

            // Fetch all transactions for these linked bank accounts
            if (liveAccounts.length > 0) {
              let allTx = []
              let from = 0
              const chunk = 1000
              while (true) {
                const { data: txData, error: txErr } = await supabase
                  .from('transactions')
                  .select('*')
                  .in('creditor_account_number', liveAccounts)
                  .order('batch_settlement_date', { ascending: false })
                  .range(from, from + chunk - 1)
                if (txErr) throw txErr
                if (txData && txData.length > 0) {
                  allTx = allTx.concat(txData)
                  from += chunk
                }
                if (!txData || txData.length < chunk || allTx.length >= 3000) break
              }

              txStats.totalCount = allTx.length
              for (const t of allTx) {
                const amt = parseFloat(t.transaction_amount) || 0
                txStats.totalVolume += amt
                if (t.transaction_status === 'Accepted') txStats.acceptedCount++
                else if (t.transaction_status === 'Rejected') txStats.rejectedCount++
                else if (t.transaction_status === 'Returned') txStats.returnedCount++
              }
              transactions = allTx.slice(0, 500)
            }
          }
        }

        return res.status(200).json({
          matches: topMatches,
          activeVendor,
          linkedBeneficiaries,
          transactions,
          txStats,
          dbAvailable: store.dbAvailable
        })
      }

      // 2. AUTOCOMPLETE HELPERS FOR MANUAL LINKING
      if (action === 'search_bens') {
        const term = String(q || '').trim()
        if (!term) return res.status(200).json({ items: [] })
        const pattern = `%${term}%`
        const { data, error } = await supabase
          .from('beneficiaries')
          .select('id, name, account_number, bank_bic, category, employee_code')
          .or(`name.ilike.${pattern},account_number.ilike.${pattern},employee_code.ilike.${pattern}`)
          .order('name', { ascending: true })
          .limit(30)
        if (error) throw error
        const items = (data || []).map(b => ({
          ...b,
          employee_code: stripEmployeeCodeIfVendorTag(b.employee_code),
          existing_links: store.linksByBenId.get(Number(b.id)) || store.linksByBankAccount.get(String(b.account_number).trim()) || []
        }))
        return res.status(200).json({ items })
      }

      if (action === 'search_vendors') {
        const term = String(q || '').trim().toLowerCase()
        const norm = normalizeCode(q)
        if (!term) return res.status(200).json({ items: [] })
        const items = []
        for (const v of store.vendors) {
          if (String(v.va).toLowerCase().includes(term) || normalizeCode(v.va).includes(norm) || String(v.n).toLowerCase().includes(term)) {
            items.push({
              vendor_account: v.va,
              vendor_name: v.n,
              group: v.g,
              vendor_hold: v.h,
              currency: v.c,
              existing_links: store.linksByVendorAccount.get(String(v.va).toLowerCase()) || []
            })
            if (items.length >= 30) break
          }
        }
        return res.status(200).json({ items })
      }

      // 3. FULL DATA FOR MULTI-SHEET EXCEL EXPORT
      if (action === 'export_all') {
        const allBens = await fetchAllBeneficiariesFromDB()
        const benByIdMap = new Map()
        const benByAccMap = new Map()
        for (const b of allBens) {
          benByIdMap.set(Number(b.id), b)
          benByAccMap.set(String(b.account_number).trim(), b)
        }

        const linkedRows = store.links.map(l => {
          const live = (l.ben_id && benByIdMap.get(Number(l.ben_id))) || benByAccMap.get(l.account_number)
          const vObj = store.staticVendorByExactLower.get(l.vendor_account.toLowerCase())
          return {
            vendor_account: l.vendor_account,
            vendor_name: l.vendor_name,
            vendor_group: vObj ? vObj.g : '',
            vendor_hold: vObj ? vObj.h : '',
            beneficiary_id: live ? live.id : l.ben_id,
            beneficiary_name: live ? live.name : l.ben_name,
            account_number: live ? live.account_number : l.account_number,
            bank_bic: live ? live.bank_bic : l.bank_bic,
            category: live ? live.category : l.category,
            match_method: l.method,
            confidence: l.score
          }
        })

        const unlinkedBens = allBens
          .filter(b => !store.linkedBenIds.has(Number(b.id)) && !store.linkedBankAccounts.has(String(b.account_number).trim()))
          .map(b => ({
            beneficiary_id: b.id,
            name: b.name,
            account_number: b.account_number,
            bank_bic: b.bank_bic || '',
            category: b.category || 'Operational',
            employee_code: stripEmployeeCodeIfVendorTag(b.employee_code) || '',
            is_mobile_wallet: isMobileAccount(b.account_number) ? 'Yes (InstaPay/Wallet)' : 'No'
          }))

        const unlinkedVendors = store.vendors
          .filter(v => !store.linkedVendorAccounts.has(String(v.va).toLowerCase()))
          .map(v => ({
            vendor_account: v.va,
            vendor_name: v.n,
            group: v.g,
            vendor_hold: v.h,
            phone: v.p || '',
            currency: v.c || 'EGP'
          }))

        return res.status(200).json({
          linked: linkedRows,
          unlinkedBens,
          unlinkedVendors,
          review: store.review
        })
      }

      // 4. DIRECTORY TABS (PAGINATED) + SUMMARY COUNTS
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const limitNum = Math.min(100, Math.max(10, parseInt(limit, 10) || 30))
      const searchLower = String(search || '').trim().toLowerCase()
      const searchNorm = normalizeCode(search)

      // Fetch live beneficiaries count/rows when needed (fast ~100ms for 6705 rows)
      const allBens = await fetchAllBeneficiariesFromDB()
      const unlinkedBensAll = allBens.filter(
        b => !store.linkedBenIds.has(Number(b.id)) && !store.linkedBankAccounts.has(String(b.account_number).trim())
      )
      const unlinkedVendorsAll = store.vendors.filter(
        v => !store.linkedVendorAccounts.has(String(v.va).toLowerCase())
      )

      const summary = {
        totalVendors: store.vendors.length,
        linkedVendorsCount: store.linkedVendorAccounts.size,
        unlinkedVendorsCount: unlinkedVendorsAll.length,
        totalBensCount: allBens.length,
        linkedBensCount: allBens.length - unlinkedBensAll.length,
        unlinkedBensCount: unlinkedBensAll.length,
        unlinkedOperationalNoMobileCount: unlinkedBensAll.filter(
          b => !['Staff', 'Satff', 'Students'].includes(b.category) && !isMobileAccount(b.account_number)
        ).length,
        totalLinksCount: store.links.length,
        reviewCount: store.review.length,
        dbAvailable: store.dbAvailable
      }

      let filtered = []
      if (tab === 'linked') {
        const benByIdMap = new Map()
        for (const b of allBens) benByIdMap.set(Number(b.id), b)

        filtered = store.links.map(l => {
          const live = l.ben_id ? benByIdMap.get(Number(l.ben_id)) : null
          const vObj = store.staticVendorByExactLower.get(l.vendor_account.toLowerCase())
          return {
            ...l,
            ben_name: live ? live.name : l.ben_name,
            account_number: live ? live.account_number : l.account_number,
            bank_bic: live ? live.bank_bic : l.bank_bic,
            category: live ? live.category : l.category,
            vendor_group: vObj ? vObj.g : '',
            vendor_hold: vObj ? vObj.h : ''
          }
        })

        if (searchLower) {
          filtered = filtered.filter(item =>
            item.vendor_account.toLowerCase().includes(searchLower) ||
            normalizeCode(item.vendor_account).includes(searchNorm) ||
            String(item.vendor_name).toLowerCase().includes(searchLower) ||
            String(item.ben_name).toLowerCase().includes(searchLower) ||
            String(item.account_number).toLowerCase().includes(searchLower)
          )
        }
      } else if (tab === 'unlinked_bens') {
        filtered = unlinkedBensAll.map(b => ({
          ...b,
          employee_code: stripEmployeeCodeIfVendorTag(b.employee_code)
        }))
        if (benFilter === 'operational_no_mobile') {
          filtered = filtered.filter(b => !['Staff', 'Satff', 'Students'].includes(b.category) && !isMobileAccount(b.account_number))
        } else if (benFilter === 'operational') {
          filtered = filtered.filter(b => !['Staff', 'Satff', 'Students'].includes(b.category))
        } else if (benFilter === 'staff_students') {
          filtered = filtered.filter(b => ['Staff', 'Satff', 'Students'].includes(b.category))
        } else if (benFilter === 'mobile_only') {
          filtered = filtered.filter(b => isMobileAccount(b.account_number))
        }

        if (searchLower) {
          filtered = filtered.filter(b =>
            String(b.name || '').toLowerCase().includes(searchLower) ||
            String(b.account_number || '').toLowerCase().includes(searchLower) ||
            String(b.employee_code || '').toLowerCase().includes(searchLower)
          )
        }
      } else if (tab === 'unlinked_vendors') {
        filtered = unlinkedVendorsAll
        if (group !== 'All') {
          filtered = filtered.filter(v => String(v.g) === String(group))
        }
        if (hold !== 'All') {
          filtered = filtered.filter(v => String(v.h) === String(hold))
        }
        if (searchLower) {
          filtered = filtered.filter(v =>
            String(v.va || '').toLowerCase().includes(searchLower) ||
            normalizeCode(v.va).includes(searchNorm) ||
            String(v.n || '').toLowerCase().includes(searchLower)
          )
        }
      } else if (tab === 'review') {
        filtered = store.review
        if (searchLower) {
          filtered = filtered.filter(r =>
            String(r.va || '').toLowerCase().includes(searchLower) ||
            String(r.vn || '').toLowerCase().includes(searchLower) ||
            String(r.bn || '').toLowerCase().includes(searchLower)
          )
        }
      }

      const totalRecords = filtered.length
      const totalPages = Math.max(1, Math.ceil(totalRecords / limitNum))
      const start = (pageNum - 1) * limitNum
      const items = filtered.slice(start, start + limitNum)

      return res.status(200).json({
        summary,
        items,
        pagination: {
          totalRecords,
          currentPage: pageNum,
          totalPages,
          limit: limitNum
        }
      })
    }

    // POST: Manual Link, Approve Review, Unlink, or Reject Review
    if (req.method === 'POST') {
      const { action, vendor_account, vendor_name, ben_id, ben_name, account_number, method = 'manual' } = req.body

      const va = String(vendor_account || '').trim()
      const acc = String(account_number || '').trim()
      if (!va || !acc) {
        return res.status(400).json({ error: 'vendor_account and account_number are required.' })
      }

      if (action === 'link') {
        const result = await saveVendorLink(store, {
          vendorAccount: va,
          vendorName: vendor_name,
          benId: ben_id,
          benName: ben_name,
          accountNumber: acc,
          method,
          replaceExisting: false
        })
        if (result.needsSqlSetup) {
          return res.status(400).json({
            needsSqlSetup: true,
            error: 'Database table "vendor_links" is required to link this record. Please run setup_vendors.sql in Supabase SQL Editor.'
          })
        }
        invalidateVendorsBenCache()
        return res.status(200).json({ success: true, message: 'Vendor linked successfully.' })
      }

      if (action === 'unlink') {
        const result = await removeVendorLink(store, {
          vendorAccount: va,
          vendorName: vendor_name,
          benId: ben_id,
          benName: ben_name,
          accountNumber: acc
        })
        if (result.needsSqlSetup) {
          return res.status(400).json({
            needsSqlSetup: true,
            error: 'Database table "vendor_links" is required to unlink pre-matched records. Please run setup_vendors.sql in Supabase SQL Editor.'
          })
        }
        invalidateVendorsBenCache()
        return res.status(200).json({ success: true, message: 'Unlinked successfully.' })
      }

      if (action === 'reject_review') {
        if (!store.dbAvailable) {
          return res.status(400).json({
            needsSqlSetup: true,
            error: 'Database table "vendor_links" is not created yet in Supabase. Please run setup_vendors.sql in Supabase SQL Editor.'
          })
        }
        const payload = {
          vendor_account: va,
          vendor_name: vendor_name || null,
          ben_id: ben_id ? Number(ben_id) : null,
          ben_name: ben_name || null,
          account_number: acc,
          status: 'rejected_review',
          method
        }
        const { error } = await supabase
          .from('vendor_links')
          .upsert(payload, { onConflict: 'vendor_account,account_number' })
        if (error) throw error

        return res.status(200).json({ success: true, message: 'Suggestion dismissed.' })
      }

      return res.status(400).json({ error: 'Invalid action' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('Vendors API Error:', error)
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
}
