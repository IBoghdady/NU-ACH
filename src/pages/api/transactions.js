import { supabase } from '../../lib/supabaseClient'
import { getVendorStore, resolveVendorAccountsFromQuery } from '../../lib/vendorStore'

function quotePostgrestList(items) {
  return items
    .slice(0, 60)
    .map(val => `"${String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const {
    page = 1,
    limit = 25,
    search = '',
    status = 'All',
    startDate = '',
    endDate = '',
    sortBy = 'batch_settlement_date',
    sortOrder = 'desc',
    comment = '',
    bankAccount = '',
    vendorAccount = '',
    sourceBank = 'All',
    skipStats = '0'
  } = req.query

  const pageNum = parseInt(page, 10)
  const limitNum = parseInt(limit, 10)
  const from = (pageNum - 1) * limitNum
  const to = from + limitNum - 1

  try {
    const store = await getVendorStore()

    let vaResolved = null
    if (vendorAccount.trim()) {
      vaResolved = resolveVendorAccountsFromQuery(store, vendorAccount, true)
      if (vaResolved.linkedAccounts.length === 0) {
        return res.status(200).json({
          transactions: [],
          matchedVendors: vaResolved.matchedVendors,
          pagination: {
            totalRecords: 0,
            currentPage: pageNum,
            totalPages: 1,
            limit: limitNum
          },
          stats: {
            totalVolume: 0,
            totalCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            returnedCount: 0,
            successRate: '100.00'
          }
        })
      }
    }

    let searchResolvedAccs = []
    let searchMatchedVendors = []
    if (search.trim()) {
      const resolvedSearch = resolveVendorAccountsFromQuery(store, search, false)
      searchResolvedAccs = resolvedSearch.linkedAccounts
      searchMatchedVendors = resolvedSearch.matchedVendors
    }

    const applyCommonFilters = (q) => {
      if (vaResolved && vaResolved.linkedAccounts.length > 0) {
        q = q.in('creditor_account_number', vaResolved.linkedAccounts)
      }

      if (search.trim()) {
        const searchTerm = `%${search.trim()}%`
        const orParts = [
          `creditor_name.ilike.${searchTerm}`,
          `batch_id.ilike.${searchTerm}`,
          `transaction_id.ilike.${searchTerm}`
        ]
        if (searchResolvedAccs.length > 0) {
          orParts.push(`creditor_account_number.in.(${quotePostgrestList(searchResolvedAccs)})`)
        }
        q = q.or(orParts.join(','))
      }

      if (status && status !== 'All') {
        q = q.eq('transaction_status', status)
      }

      if (startDate) {
        q = q.gte('batch_settlement_date', startDate)
      }
      if (endDate) {
        q = q.lte('batch_settlement_date', endDate)
      }

      if (comment.trim()) {
        q = q.ilike('comment', `%${comment.trim()}%`)
      }

      if (bankAccount.trim()) {
        const acc = bankAccount.trim()
        q = q.or(`creditor_account_number.ilike.%${acc}%,debtor_account_number.ilike.%${acc}%`)
      }

      if (sourceBank === 'Banque Misr') {
        q = q.eq('batch_purpose', 'Banque Misr')
      } else if (sourceBank === 'CIB') {
        q = q.neq('batch_purpose', 'Banque Misr')
      }
      return q
    }

    // 1. Build and run the main paginated query
    let query = applyCommonFilters(
      supabase.from('transactions').select('*', { count: 'exact' })
    )

    query = query
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range(from, to)

    const { data: transactions, count, error } = await query

    if (error) {
      throw error
    }

    // 2. Fetch Aggregated Statistics in Real-Time
    let totalVolume = 0
    let totalCount = count || 0
    let acceptedCount = 0
    let rejectedCount = 0
    let returnedCount = 0

    const usedVendorFilter = Boolean(vaResolved || searchResolvedAccs.length > 0)
    let statsFetched = skipStats === '1'

    if (usedVendorFilter && !statsFetched) {
      // Compute exact stats directly across all matching vendor rows
      try {
        let statFrom = 0
        const chunk = 1000
        let allStatRows = []
        while (true) {
          const statQuery = applyCommonFilters(
            supabase.from('transactions').select('transaction_amount, transaction_status')
          ).range(statFrom, statFrom + chunk - 1)
          const { data: sData, error: sErr } = await statQuery
          if (sErr) throw sErr
          if (sData && sData.length > 0) {
            allStatRows = allStatRows.concat(sData)
            statFrom += chunk
          }
          if (!sData || sData.length < chunk) break
        }
        totalCount = allStatRows.length
        for (const row of allStatRows) {
          totalVolume += parseFloat(row.transaction_amount) || 0
          if (row.transaction_status === 'Accepted') acceptedCount++
          else if (row.transaction_status === 'Rejected') rejectedCount++
          else if (row.transaction_status === 'Returned') returnedCount++
        }
        statsFetched = true
      } catch (e) {
        console.warn('Vendor stats calc fallback:', e)
      }
    }

    if (!statsFetched) {
      try {
        const { data: statsData, error: statsError } = await supabase.rpc('get_transaction_dashboard_stats', {
          search_term: search.trim(),
          status_filter: status,
          start_date: startDate,
          end_date: endDate,
          comment_filter: comment.trim(),
          bank_account_filter: bankAccount.trim(),
          source_bank_filter: sourceBank
        })

        if (!statsError && statsData) {
          totalVolume = parseFloat(statsData.totalVolume) || 0
          totalCount = parseInt(statsData.totalCount, 10) || totalCount
          acceptedCount = parseInt(statsData.acceptedCount, 10) || 0
          rejectedCount = parseInt(statsData.rejectedCount, 10) || 0
          returnedCount = parseInt(statsData.returnedCount, 10) || 0
          statsFetched = true
        }
      } catch (rpcErr) {
        console.warn('RPC stats failed:', rpcErr)
      }
    }

    if (!statsFetched) {
      totalCount = count || 0
      transactions.forEach(row => {
        const amt = parseFloat(row.transaction_amount) || 0
        totalVolume += amt
        const stat = row.transaction_status || ''
        if (stat === 'Accepted') acceptedCount++
        else if (stat === 'Rejected') rejectedCount++
        else if (stat === 'Returned') returnedCount++
      })
    }

    // Enrich transactions with linked vendor_account and vendor_name
    const enrichedTransactions = (transactions || []).map(tx => {
      const acc = String(tx.creditor_account_number || '').trim()
      const vLinks = acc ? (store.linksByBankAccount.get(acc) || []) : []
      return {
        ...tx,
        vendor_account: vLinks[0]?.vendor_account || null,
        vendor_name: vLinks[0]?.vendor_name || null
      }
    })

    return res.status(200).json({
      transactions: enrichedTransactions,
      matchedVendors: vaResolved ? vaResolved.matchedVendors : searchMatchedVendors,
      pagination: {
        totalRecords: totalCount,
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        limit: limitNum
      },
      stats: {
        totalVolume,
        totalCount,
        acceptedCount,
        rejectedCount,
        returnedCount,
        successRate: totalCount ? ((acceptedCount / totalCount) * 100).toFixed(2) : '100.00'
      }
    })

  } catch (error) {
    console.error('API Error:', error)
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
}
