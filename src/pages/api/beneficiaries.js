import { supabase } from '../../lib/supabaseClient'
import {
  getVendorStore,
  resolveVendorAccountsFromQuery,
  saveVendorLink,
  removeVendorLink,
  stripEmployeeCodeIfVendorTag
} from '../../lib/vendorStore'

async function syncBeneficiaryVendorLink(store, { ben, vendorAccount, clearWhenEmpty = false }) {
  const vaRaw = String(vendorAccount || '').trim()
  if (!vaRaw) {
    if (clearWhenEmpty && ben) {
      const remRes = await removeVendorLink(store, {
        vendorAccount: '',
        benId: ben.id,
        benName: ben.name,
        accountNumber: ben.account_number
      })
      return {
        vendorLinkSaved: remRes.saved,
        needsSqlSetup: remRes.needsSqlSetup,
        vendor_account: null,
        vendor_name: null
      }
    }
    return { vendorLinkSaved: true, needsSqlSetup: false, vendor_account: null, vendor_name: null }
  }

  const saveRes = await saveVendorLink(store, {
    vendorAccount: vaRaw,
    vendorName: '',
    benId: ben.id,
    benName: ben.name,
    accountNumber: ben.account_number,
    method: 'manual',
    replaceExisting: true
  })

  return {
    vendorLinkSaved: saveRes.saved,
    needsSqlSetup: saveRes.needsSqlSetup,
    vendor_account: saveRes.vendor_account || null,
    vendor_name: saveRes.vendor_name || null
  }
}

function quotePostgrestList(items) {
  return items
    .slice(0, 60)
    .map(val => `"${String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // GET: Fetch list of beneficiaries
  if (req.method === 'GET') {
    const { search = '', employeeCode = '', vendorAccount = '', page = 1, limit = 50 } = req.query
    const pageNum = parseInt(page, 10)
    const limitNum = parseInt(limit, 10)
    const from = (pageNum - 1) * limitNum
    const to = from + limitNum - 1

    try {
      const store = await getVendorStore()

      // Resolve Vendor Account filter if provided explicitly
      let vaFilterIds = []
      let vaFilterAccs = []
      if (vendorAccount.trim()) {
        const resolved = resolveVendorAccountsFromQuery(store, vendorAccount, true)
        vaFilterIds = [...new Set(resolved.links.map(l => l.ben_id).filter(Boolean))]
        vaFilterAccs = resolved.linkedAccounts
        if (vaFilterIds.length === 0 && vaFilterAccs.length === 0) {
          return res.status(200).json({
            beneficiaries: [],
            pagination: { totalRecords: 0, currentPage: pageNum, totalPages: 1, limit: limitNum }
          })
        }
      }

      // Check if main search query resolves to Vendor Accounts (exact/norm or vendor name if >=3 chars)
      let searchVendorIds = []
      let searchVendorAccs = []
      if (search.trim()) {
        const allowPartialVendor = search.trim().length >= 3
        const resolvedSearch = resolveVendorAccountsFromQuery(store, search, allowPartialVendor)
        searchVendorIds = [...new Set(resolvedSearch.links.map(l => l.ben_id).filter(Boolean))]
        searchVendorAccs = resolvedSearch.linkedAccounts
      }

      let query = supabase
        .from('beneficiaries')
        .select('*', { count: 'exact' })

      if (vaFilterIds.length > 0 || vaFilterAccs.length > 0) {
        const parts = []
        if (vaFilterIds.length > 0) parts.push(`id.in.(${vaFilterIds.slice(0, 60).join(',')})`)
        if (vaFilterAccs.length > 0) parts.push(`account_number.in.(${quotePostgrestList(vaFilterAccs)})`)
        query = query.or(parts.join(','))
      }

      if (search.trim()) {
        const term = `%${search.trim()}%`
        const orParts = [`name.ilike.${term}`, `account_number.ilike.${term}`]
        if (searchVendorIds.length > 0) orParts.push(`id.in.(${searchVendorIds.slice(0, 60).join(',')})`)
        if (searchVendorAccs.length > 0) orParts.push(`account_number.in.(${quotePostgrestList(searchVendorAccs)})`)
        query = query.or(orParts.join(','))
        // Fetch more for search so we can sort by relevance in JS
        query = query.limit(1000)
      } else {
        query = query.order('name', { ascending: true }).range(from, to)
      }

      if (employeeCode.trim()) {
        query = query.ilike('employee_code', `%${employeeCode.trim()}%`).not('employee_code', 'ilike', 'VA:%')
      }

      let { data: beneficiaries, count, error } = await query

      if (error) {
        throw error
      }

      // If searching, sort by vendor-account match / prefix match first, then alphabetically, then paginate manually
      if (search.trim() && beneficiaries) {
        const lowerSearch = search.toLowerCase().trim()
        const accSet = new Set(searchVendorAccs)
        const idSet = new Set(searchVendorIds.map(Number))

        beneficiaries.sort((a, b) => {
          const aVendorMatch = (idSet.has(Number(a.id)) || accSet.has(a.account_number)) ? 1 : 0
          const bVendorMatch = (idSet.has(Number(b.id)) || accSet.has(b.account_number)) ? 1 : 0
          if (aVendorMatch !== bVendorMatch) return bVendorMatch - aVendorMatch

          const aName = (a.name || '').toLowerCase()
          const bName = (b.name || '').toLowerCase()
          const aStarts = aName.startsWith(lowerSearch) ? 1 : 0
          const bStarts = bName.startsWith(lowerSearch) ? 1 : 0
          if (aStarts !== bStarts) return bStarts - aStarts

          return aName.localeCompare(bName)
        })
        count = beneficiaries.length
        beneficiaries = beneficiaries.slice(from, from + limitNum)
      }

      // Enrich beneficiaries with Vendor Account link details
      const enriched = (beneficiaries || []).map(b => {
        const byId = store.linksByBenId.get(Number(b.id)) || []
        const byAcc = store.linksByBankAccount.get(String(b.account_number || '').trim()) || []
        const seen = new Set()
        const vLinks = []
        for (const l of [...byId, ...byAcc]) {
          if (!seen.has(l.vendor_account)) {
            seen.add(l.vendor_account)
            const vObj = store.staticVendorByExactLower.get(l.vendor_account.toLowerCase())
            vLinks.push({
              vendor_account: l.vendor_account,
              vendor_name: l.vendor_name,
              vendor_hold: vObj ? vObj.h : '',
              vendor_group: vObj ? vObj.g : '',
              method: l.method,
              score: l.score,
              source: l.source
            })
          }
        }
        return {
          ...b,
          employee_code: stripEmployeeCodeIfVendorTag(b.employee_code),
          vendor_account: vLinks[0]?.vendor_account || b.vendor_account || null,
          vendor_name: vLinks[0]?.vendor_name || null,
          vendor_links: vLinks
        }
      })

      return res.status(200).json({
        beneficiaries: enriched,
        pagination: {
          totalRecords: count || 0,
          currentPage: pageNum,
          totalPages: Math.ceil((count || 0) / limitNum),
          limit: limitNum
        }
      })
    } catch (error) {
      console.error('Error fetching beneficiaries:', error)
      return res.status(500).json({ error: error.message || 'Internal Server Error' })
    }
  }

  // POST: Create a new beneficiary
  if (req.method === 'POST') {
    const { name, account_number, bank_bic, category = 'Operational', employee_code, vendor_account, force } = req.body

    if (!name || !account_number) {
      return res.status(400).json({ error: 'Name and Account Number are required.' })
    }

    try {
      const payload = {
        name: name.trim(),
        account_number: account_number.trim(),
        bank_bic: bank_bic ? bank_bic.trim() : null,
        category,
        employee_code: employee_code ? employee_code.trim() : null
      }

      let query = supabase.from('beneficiaries')
      
      if (force) {
        query = query.upsert(payload, { onConflict: 'account_number' }).select()
      } else {
        query = query.insert([payload]).select()
      }

      const { data, error } = await query

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'A beneficiary with this account number already exists.' })
        }
        throw error
      }

      const savedBen = data[0]
      let syncRes = { vendorLinkSaved: true, needsSqlSetup: false, vendor_account: savedBen.vendor_account || null, vendor_name: null }
      if (vendor_account && String(vendor_account).trim()) {
        const store = await getVendorStore()
        syncRes = await syncBeneficiaryVendorLink(store, { ben: savedBen, vendorAccount: vendor_account, clearWhenEmpty: false })
      }

      return res.status(201).json({
        ...savedBen,
        employee_code: stripEmployeeCodeIfVendorTag(savedBen.employee_code),
        vendor_account: syncRes.vendor_account || savedBen.vendor_account || null,
        vendor_name: syncRes.vendor_name || null,
        _vendorLinkSaved: syncRes.vendorLinkSaved,
        _needsSqlSetup: syncRes.needsSqlSetup
      })
    } catch (error) {
      console.error('Error creating beneficiary:', error)
      return res.status(500).json({ error: error.message || 'Internal Server Error' })
    }
  }

  // PUT: Update an existing beneficiary by ID
  if (req.method === 'PUT') {
    const { id, name, account_number, bank_bic, category = 'Operational', employee_code, vendor_account } = req.body

    if (!id) {
      return res.status(400).json({ error: 'Beneficiary ID is required for update.' })
    }
    if (!name || !account_number) {
      return res.status(400).json({ error: 'Name and Account Number are required.' })
    }

    try {
      const payload = {
        name: name.trim(),
        account_number: account_number.trim(),
        bank_bic: bank_bic ? bank_bic.trim() : null,
        category: category || 'Operational',
        employee_code: employee_code ? employee_code.trim() : null
      }

      const { data, error } = await supabase
        .from('beneficiaries')
        .update(payload)
        .eq('id', id)
        .select()

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Another beneficiary with this account number already exists.' })
        }
        throw error
      }

      if (!data || data.length === 0) {
        return res.status(404).json({ error: 'Beneficiary not found or update blocked.' })
      }

      const savedBen = data[0]
      let syncRes = { vendorLinkSaved: true, needsSqlSetup: false, vendor_account: savedBen.vendor_account || null, vendor_name: null }
      if (vendor_account !== undefined) {
        const store = await getVendorStore()
        syncRes = await syncBeneficiaryVendorLink(store, {
          ben: savedBen,
          vendorAccount: vendor_account,
          clearWhenEmpty: String(vendor_account || '').trim() === ''
        })
      }

      return res.status(200).json({
        ...savedBen,
        employee_code: stripEmployeeCodeIfVendorTag(savedBen.employee_code),
        vendor_account: syncRes.vendor_account || null,
        vendor_name: syncRes.vendor_name || null,
        _vendorLinkSaved: syncRes.vendorLinkSaved,
        _needsSqlSetup: syncRes.needsSqlSetup
      })
    } catch (error) {
      console.error('Error updating beneficiary:', error)
      return res.status(500).json({ error: error.message || 'Internal Server Error' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
