import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { transactions } = req.body

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'No transactions provided' })
    }

    // Since we are inserting in bulk, let's fetch existing transaction_ids to avoid duplicates
    // We assume transaction_id is the unique identifier for a transaction
    const txIds = transactions.map(tx => tx.transaction_id).filter(id => id)

    let existingTxIds = new Set()
    
    if (txIds.length > 0) {
      // Chunk the duplicate check to prevent URL length limits (HTTP 414) in PostgREST
      const chunkSize = 100
      for (let i = 0; i < txIds.length; i += chunkSize) {
        const chunk = txIds.slice(i, i + chunkSize)
        const { data: existing, error: fetchError } = await supabase
          .from('transactions')
          .select('transaction_id')
          .in('transaction_id', chunk)
          
        if (fetchError) {
          throw new Error('Failed to check duplicates: ' + fetchError.message)
        }
        
        if (existing) {
          existing.forEach(tx => existingTxIds.add(tx.transaction_id))
        }
      }
    }

    // Filter out transactions that already exist
    const newTransactions = transactions.filter(tx => 
      !tx.transaction_id || !existingTxIds.has(tx.transaction_id)
    )

    if (newTransactions.length === 0) {
      return res.status(200).json({ 
        success: true, 
        inserted: 0, 
        skipped: transactions.length,
        message: 'All transactions already exist in the database.'
      })
    }

    // Insert the new transactions
    const { data, error } = await supabase
      .from('transactions')
      .insert(newTransactions)
      .select()

    if (error) {
      throw error
    }

    return res.status(200).json({
      success: true,
      inserted: data ? data.length : 0,
      skipped: transactions.length - newTransactions.length,
      data
    })

  } catch (error) {
    console.error('Bulk Import Error:', error)
    return res.status(500).json({ error: error.message || 'Failed to process bulk import' })
  }
}

/* Vercel bundle update */