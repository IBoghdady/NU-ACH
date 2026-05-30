import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { search, status, startDate, endDate, comment, bankAccount } = req.query

  try {
    let query = supabase
      .from('transactions')
      .select('creditor_name, transaction_amount, batch_settlement_date')
      
    // If status is specific, use it. Otherwise default to successful ones for volume/vendor stats.
    if (status && status !== 'All') {
      query = query.eq('transaction_status', status)
    } else {
      query = query.in('transaction_status', ['Accepted', 'Matched'])
    }

    if (search) {
      query = query.or(`creditor_name.ilike.%${search}%,batch_id.ilike.%${search}%,creditor_account_number.ilike.%${search}%`)
    }
    if (comment) {
      query = query.ilike('transaction_purpose', `%${comment}%`)
    }
    if (bankAccount) {
      query = query.ilike('creditor_account_number', `%${bankAccount}%`)
    }
    if (startDate) {
      query = query.gte('batch_settlement_date', startDate)
    }
    if (endDate) {
      query = query.lte('batch_settlement_date', endDate)
    }

    const { data: txs, error: txErr } = await query

    if (txErr) throw txErr

    // Aggregate vendors
    const vendorMap = {}
    // Aggregate by date
    const dateMap = {}

    txs.forEach(tx => {
      const name = tx.creditor_name || 'Unknown'
      const amount = tx.transaction_amount || 0
      vendorMap[name] = (vendorMap[name] || 0) + amount

      const date = tx.batch_settlement_date ? tx.batch_settlement_date.split('T')[0] : 'Unknown'
      dateMap[date] = (dateMap[date] || 0) + amount
    })

    const top5Vendors = Object.keys(vendorMap)
      .map(name => ({ name, value: vendorMap[name] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    const dailyOutflows = Object.keys(dateMap)
      .map(date => ({ date, amount: dateMap[date] }))
      .sort((a, b) => new Date(a.date) - new Date(b.date))

    return res.status(200).json({
      success: true,
      topVendors: top5Vendors,
      dailyOutflows: dailyOutflows
    })

  } catch (error) {
    console.error('Analytics Error:', error)
    return res.status(500).json({ error: 'Failed to fetch analytics' })
  }
}
