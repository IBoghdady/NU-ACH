import { supabase } from '../../lib/supabaseClient'
import { getVendorStore, resolveVendorAccountsFromQuery } from '../../lib/vendorStore'
import { ANALYTICS_CATEGORIES, classifyTransactionComment } from '../../lib/commentClassifier'
import { fetchAllPaginated } from '../../lib/supabasePagination'

function quotePostgrestList(items) {
  return items
    .slice(0, 60)
    .map(val => `"${String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const {
    search,
    status,
    startDate,
    endDate,
    comment,
    bankAccount,
    vendorAccount,
    commentCategory = 'All',
    sourceBank
  } = req.query

  try {
    const store = await getVendorStore()

    let vaLinkedAccounts = null
    if (vendorAccount && vendorAccount.trim()) {
      const resolvedVA = resolveVendorAccountsFromQuery(store, vendorAccount, true)
      if (resolvedVA.linkedAccounts.length === 0) {
        return res.status(200).json({
          success: true,
          topVendors: [],
          dailyOutflows: [],
          categoriesBreakdown: [],
          totalAnalyzedCount: 0,
          totalAnalyzedVolume: 0
        })
      }
      vaLinkedAccounts = resolvedVA.linkedAccounts
    }

    const searchResolvedAccs = search && search.trim()
      ? resolveVendorAccountsFromQuery(store, search, false).linkedAccounts
      : []

    const buildQuery = () => {
      let query = supabase
        .from('transactions')
        .select('creditor_name, transaction_amount, batch_settlement_date, creditor_account_number, comment', { count: 'exact' })

      if (status && status !== 'All') {
        query = query.eq('transaction_status', status)
      } else {
        query = query.in('transaction_status', ['Accepted', 'Matched'])
      }

      if (vaLinkedAccounts && vaLinkedAccounts.length > 0) {
        query = query.in('creditor_account_number', vaLinkedAccounts)
      }

      if (search && search.trim()) {
        const s = search.trim()
        const orParts = [
          `creditor_name.ilike.%${s}%`,
          `batch_id.ilike.%${s}%`,
          `creditor_account_number.ilike.%${s}%`
        ]
        if (searchResolvedAccs.length > 0) {
          orParts.push(`creditor_account_number.in.(${quotePostgrestList(searchResolvedAccs)})`)
        }
        query = query.or(orParts.join(','))
      }
      if (comment && comment.trim()) {
        query = query.ilike('comment', `%${comment.trim()}%`)
      }
      if (bankAccount && bankAccount.trim()) {
        query = query.ilike('creditor_account_number', `%${bankAccount.trim()}%`)
      }
      if (startDate) {
        query = query.gte('batch_settlement_date', startDate)
      }
      if (endDate) {
        query = query.lte('batch_settlement_date', endDate)
      }
      if (sourceBank === 'Banque Misr') {
        query = query.eq('batch_purpose', 'Banque Misr')
      } else if (sourceBank === 'CIB') {
        query = query.neq('batch_purpose', 'Banque Misr')
      }

      return query.order('id', { ascending: true })
    }

    let txs = await fetchAllPaginated(buildQuery)

    // Filter by Comment Category if selected
    if (commentCategory && commentCategory !== 'All') {
      txs = txs.filter(tx => classifyTransactionComment(tx.comment) === commentCategory)
    }

    const vendorMap = {}
    const dateMap = {}
    const categoryTotals = {}
    const categoryCounts = {}
    let totalAnalyzedVolume = 0

    for (const def of ANALYTICS_CATEGORIES) {
      categoryTotals[def.name] = 0
      categoryCounts[def.name] = 0
    }

    for (const tx of txs) {
      const name = tx.creditor_name || 'Unknown'
      const amount = parseFloat(tx.transaction_amount) || 0
      const cat = classifyTransactionComment(tx.comment)

      totalAnalyzedVolume += amount
      vendorMap[name] = (vendorMap[name] || 0) + amount
      categoryTotals[cat] = (categoryTotals[cat] || 0) + amount
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1

      const date = tx.batch_settlement_date ? tx.batch_settlement_date.split('T')[0] : null
      if (date) {
        dateMap[date] = (dateMap[date] || 0) + amount
      }
    }

    const top5Vendors = Object.keys(vendorMap)
      .map(name => ({ name, value: vendorMap[name] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    let dailyOutflows = Object.keys(dateMap)
      .map(date => ({ date, amount: dateMap[date] }))
      .sort((a, b) => new Date(a.date) - new Date(b.date))

    if (!startDate && !endDate && dailyOutflows.length > 30) {
      dailyOutflows = dailyOutflows.slice(-30)
    }

    const categoriesBreakdown = Object.keys(categoryTotals)
      .filter(name => categoryCounts[name] > 0)
      .map(name => ({
        name,
        value: Number(categoryTotals[name].toFixed(2)),
        count: categoryCounts[name],
        percentage: totalAnalyzedVolume > 0
          ? Number(((categoryTotals[name] / totalAnalyzedVolume) * 100).toFixed(1))
          : 0
      }))
      .sort((a, b) => b.value - a.value)

    return res.status(200).json({
      success: true,
      topVendors: top5Vendors,
      dailyOutflows,
      categoriesBreakdown,
      totalAnalyzedCount: txs.length,
      totalAnalyzedVolume: Number(totalAnalyzedVolume.toFixed(2))
    })
  } catch (error) {
    console.error('Analytics Error:', error)
    return res.status(500).json({ error: 'Failed to fetch analytics' })
  }
}
