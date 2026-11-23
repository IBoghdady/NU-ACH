import { supabase } from '../../lib/supabaseClient'
import { getVendorStore, resolveVendorAccountsFromQuery } from '../../lib/vendorStore'
import { classifyTransactionComment } from '../../lib/commentClassifier'
import { fetchAllPaginated } from '../../lib/supabasePagination'

function quotePostgrestList(items) {
  return items
    .slice(0, 60)
    .map(val => `"${String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
}

async function computeDirectStats(applyCommonFilters) {
  const rows = await fetchAllPaginated(() =>
    applyCommonFilters(
      supabase.from('transactions').select('transaction_amount, transaction_status', { count: 'exact' })
    ).order('id', { ascending: true })
  )
  let totalVolume = 0
  let acceptedCount = 0
  let rejectedCount = 0
  let returnedCount = 0
  for (const row of rows) {
    totalVolume += parseFloat(row.transaction_amount) || 0
    if (row.transaction_status === 'Accepted') acceptedCount++
    else if (row.transaction_status === 'Rejected') rejectedCount++
    else if (row.transaction_status === 'Returned') returnedCount++
  }
  return { totalCount: rows.length, totalVolume, acceptedCount, rejectedCount, returnedCount }
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
    commentCategory = 'All',
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

    // 1. Run paginated query (special path when filtering by JS commentCategory)
    let transactions = []
    let totalVolume = 0
    let totalCount = 0
    let acceptedCount = 0
    let rejectedCount = 0
    let returnedCount = 0
    let statsFetched = skipStats === '1'

    const hasCommentCategory = commentCategory && commentCategory !== 'All'

    if (hasCommentCategory) {
      const allCandidateMeta = await fetchAllPaginated(() =>
        applyCommonFilters(
          supabase.from('transactions').select('id, comment, transaction_amount, transaction_status', { count: 'exact' })
        )
          .order(sortBy, { ascending: sortOrder === 'asc' })
          .order('id', { ascending: true })
      )

      const filteredMeta = allCandidateMeta.filter(
        r => classifyTransactionComment(r.comment) === commentCategory
      )
      totalCount = filteredMeta.length

      if (!statsFetched) {
        for (const row of filteredMeta) {
          totalVolume += parseFloat(row.transaction_amount) || 0
          if (row.transaction_status === 'Accepted') acceptedCount++
          else if (row.transaction_status === 'Rejected') rejectedCount++
          else if (row.transaction_status === 'Returned') returnedCount++
        }
        statsFetched = true
      }

      const pageIds = filteredMeta.slice(from, to + 1).map(r => r.id)
      if (pageIds.length > 0) {
        const ID_CHUNK = 250
        const idChunks = []
        for (let i = 0; i < pageIds.length; i += ID_CHUNK) {
          idChunks.push(pageIds.slice(i, i + ID_CHUNK))
        }
        const chunkResults = await Promise.all(
          idChunks.map(ids => supabase.from('transactions').select('*').in('id', ids))
        )
        const byId = new Map()
        for (const cr of chunkResults) {
          if (cr.error) throw cr.error
          for (const row of (cr.data || [])) {
            byId.set(row.id, row)
          }
        }
        transactions = pageIds.map(id => byId.get(id)).filter(Boolean)
      }
    } else {
      let query = applyCommonFilters(
        supabase.from('transactions').select('*', { count: 'exact' })
      )

      query = query
        .order(sortBy, { ascending: sortOrder === 'asc' })
        .order('id', { ascending: true })
        .range(from, to)

      const { data: txRows, count: rowCount, error } = await query

      if (error) {
        throw error
      }
      transactions = txRows || []
      totalCount = rowCount || 0
    }

    // 2. Fetch Aggregated Statistics in Real-Time (when not already computed above)
    const usedVendorFilter = Boolean(vaResolved || searchResolvedAccs.length > 0)
    const needsDirectStats = usedVendorFilter || (sourceBank && sourceBank !== 'All')

    if (needsDirectStats && !statsFetched) {
      try {
        const direct = await computeDirectStats(applyCommonFilters)
        totalCount = direct.totalCount
        totalVolume = direct.totalVolume
        acceptedCount = direct.acceptedCount
        rejectedCount = direct.rejectedCount
        returnedCount = direct.returnedCount
        statsFetched = true
      } catch (e) {
        console.warn('Direct stats calc fallback:', e)
      }
    }

    if (!statsFetched) {
      try {
        // Call the 6-parameter Supabase RPC (also handles sourceBank === 'All')
        const { data: statsData, error: statsError } = await supabase.rpc('get_transaction_dashboard_stats', {
          search_term: search.trim(),
          status_filter: status,
          start_date: startDate,
          end_date: endDate,
          comment_filter: comment.trim(),
          bank_account_filter: bankAccount.trim()
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
      try {
        const direct = await computeDirectStats(applyCommonFilters)
        totalCount = direct.totalCount
        totalVolume = direct.totalVolume
        acceptedCount = direct.acceptedCount
        rejectedCount = direct.rejectedCount
        returnedCount = direct.returnedCount
      } catch (fallbackErr) {
        transactions.forEach(row => {
          const amt = parseFloat(row.transaction_amount) || 0
          totalVolume += amt
          const stat = row.transaction_status || ''
          if (stat === 'Accepted') acceptedCount++
          else if (stat === 'Rejected') rejectedCount++
          else if (stat === 'Returned') returnedCount++
        })
      }
    }

    // Enrich transactions with linked vendor_account, vendor_name, and comment_category
    const enrichedTransactions = (transactions || []).map(tx => {
      const acc = String(tx.creditor_account_number || '').trim()
      const vLinks = acc ? (store.linksByBankAccount.get(acc) || []) : []
      return {
        ...tx,
        vendor_account: vLinks[0]?.vendor_account || null,
        vendor_name: vLinks[0]?.vendor_name || null,
        comment_category: classifyTransactionComment(tx.comment)
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
