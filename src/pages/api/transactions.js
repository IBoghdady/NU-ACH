import { supabase } from '../../lib/supabaseClient'

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
    sourceBank = 'All'
  } = req.query

  const pageNum = parseInt(page, 10)
  const limitNum = parseInt(limit, 10)
  const from = (pageNum - 1) * limitNum
  const to = from + limitNum - 1

  try {
    // 1. Build and run the main paginated query
    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })

    if (search.trim()) {
      const searchTerm = `%${search.trim()}%`
      query = query.or(`creditor_name.ilike.${searchTerm},batch_id.ilike.${searchTerm},transaction_id.ilike.${searchTerm}`)
    }

    if (status && status !== 'All') {
      query = query.eq('transaction_status', status)
    }

    if (startDate) {
      query = query.gte('batch_settlement_date', startDate)
    }
    if (endDate) {
      query = query.lte('batch_settlement_date', endDate)
    }

    if (comment.trim()) {
      query = query.ilike('comment', `%${comment.trim()}%`)
    }

    if (bankAccount.trim()) {
      const acc = bankAccount.trim()
      query = query.or(`creditor_account_number.ilike.%${acc}%,debtor_account_number.ilike.%${acc}%`)
    }

    if (sourceBank === 'Banque Misr') {
      query = query.eq('batch_purpose', 'Banque Misr')
    } else if (sourceBank === 'CIB') {
      query = query.neq('batch_purpose', 'Banque Misr')
    }

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

    let statsFetched = false

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

    if (!statsFetched) {
      // Emergency fallback just calculates page sum if RPC is completely broken
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

    return res.status(200).json({
      transactions,
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
