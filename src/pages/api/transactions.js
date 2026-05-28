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
    bankAccount = ''
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

    // If advanced comment or bankAccount filters are active, we query stats dynamically using fallback select
    // to ensure complete accuracy. Otherwise, we can try using RPC first.
    const hasAdvancedFilters = comment.trim() !== '' || bankAccount.trim() !== ''

    let statsFetched = false

    if (!hasAdvancedFilters) {
      try {
        const { data: statsData, error: statsError } = await supabase.rpc('get_transaction_dashboard_stats', {
          search_term: search.trim(),
          status_filter: status,
          start_date: startDate,
          end_date: endDate,
          comment_filter: '',
          bank_account_filter: ''
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
        console.warn('RPC stats failed, falling back to select query...')
      }
    }

    if (!statsFetched) {
      // Direct high-performance query for statistics when filters are applied
      let statsQuery = supabase
        .from('transactions')
        .select('transaction_amount, transaction_status')

      if (search.trim()) {
        const searchTerm = `%${search.trim()}%`
        statsQuery = statsQuery.or(`creditor_name.ilike.${searchTerm},batch_id.ilike.${searchTerm},transaction_id.ilike.${searchTerm}`)
      }
      if (status && status !== 'All') {
        statsQuery = statsQuery.eq('transaction_status', status)
      }
      if (startDate) {
        statsQuery = statsQuery.gte('batch_settlement_date', startDate)
      }
      if (endDate) {
        statsQuery = statsQuery.lte('batch_settlement_date', endDate)
      }
      if (comment.trim()) {
        statsQuery = statsQuery.ilike('comment', `%${comment.trim()}%`)
      }
      if (bankAccount.trim()) {
        const acc = bankAccount.trim()
        statsQuery = statsQuery.or(`creditor_account_number.ilike.%${acc}%,debtor_account_number.ilike.%${acc}%`)
      }

      // Execute stats call capped at 25000 rows for Vercel/Supabase safety
      const { data: statsData, error: statsError } = await statsQuery.limit(25000)

      if (!statsError && statsData) {
        totalCount = statsData.length
        statsData.forEach(row => {
          const amt = parseFloat(row.transaction_amount) || 0
          totalVolume += amt
          
          const stat = row.transaction_status || ''
          if (stat === 'Accepted') acceptedCount++
          else if (stat === 'Rejected') rejectedCount++
          else if (stat === 'Returned') returnedCount++
        })
      }
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
