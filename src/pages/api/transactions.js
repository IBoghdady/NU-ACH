import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  // Allow CORS
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
    sortOrder = 'desc'
  } = req.query

  const pageNum = parseInt(page, 10)
  const limitNum = parseInt(limit, 10)
  const from = (pageNum - 1) * limitNum
  const to = from + limitNum - 1

  try {
    // 1. Build base query for paginated results
    let query = supabase
      .from('transactions')
      .select('*', { count: 'exact' })

    // Apply search filter (match creditor_name, batch_id, or transaction_id)
    if (search.trim()) {
      const searchTerm = `%${search.trim()}%`
      query = query.or(`creditor_name.ilike.${searchTerm},batch_id.ilike.${searchTerm},transaction_id.ilike.${searchTerm}`)
    }

    // Apply status filter
    if (status && status !== 'All') {
      query = query.eq('transaction_status', status)
    }

    // Apply date range filters
    if (startDate) {
      query = query.gte('batch_settlement_date', startDate)
    }
    if (endDate) {
      query = query.lte('batch_settlement_date', endDate)
    }

    // Apply sorting & range pagination
    query = query
      .order(sortBy, { ascending: sortOrder === 'asc' })
      .range(from, to)

    const { data: transactions, count, error } = await query

    if (error) {
      throw error
    }

    // 2. Fetch stats for the active filters to update KPI cards in real-time!
    // To prevent high memory usage, we fetch only the 'transaction_amount' and 'transaction_status' for filtered stats
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

    // Capping at 24000 rows to ensure fast execution
    const { data: statsData, error: statsError } = await statsQuery.limit(24000)

    let totalVolume = 0
    let acceptedCount = 0
    let rejectedCount = 0
    let returnedCount = 0

    if (!statsError && statsData) {
      statsData.forEach(row => {
        const amt = parseFloat(row.transaction_amount) || 0
        totalVolume += amt
        
        const stat = row.transaction_status || ''
        if (stat === 'Accepted') acceptedCount++
        else if (stat === 'Rejected') rejectedCount++
        else if (stat === 'Returned') returnedCount++
      });
    }

    return res.status(200).json({
      transactions,
      pagination: {
        totalRecords: count || 0,
        currentPage: pageNum,
        totalPages: Math.ceil((count || 0) / limitNum),
        limit: limitNum
      },
      stats: {
        totalVolume,
        totalCount: count || 0,
        acceptedCount,
        rejectedCount,
        returnedCount,
        successRate: count ? ((acceptedCount / count) * 100).toFixed(2) : '100.00'
      }
    })

  } catch (error) {
    console.error('API Error:', error)
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
}
