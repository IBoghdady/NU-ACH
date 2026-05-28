import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const {
    batch_id = '',
    transaction_amount,
    creditor_name,
    creditor_account_number,
    creditor_party_bic = '',
    transaction_purpose = 'CASH',
    comment = ''
  } = req.body

  // Validation
  if (!transaction_amount || !creditor_name || !creditor_account_number) {
    return res.status(400).json({ error: 'Amount, Creditor Name, and Creditor Account are required.' })
  }

  const amountNum = parseFloat(transaction_amount)
  if (isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'Transfer amount must be a positive number.' })
  }

  try {
    // Generate high-fidelity ACH transfer credentials
    const todayStr = new Date().toISOString().slice(0, 10)
    const timestampNano = Date.now().toString()
    const randomSuffix = Math.floor(100000 + Math.random() * 900000).toString()
    
    // Simulating institutional Batch and Transaction IDs matching CIB/EGP standard format
    const finalBatchId = batch_id.trim() || `CIBEEGCX-C-${todayStr.replace(/-/g, '')}-${randomSuffix}`
    const finalTxId = `NU-ACH-TX-${timestampNano.slice(-6)}-${randomSuffix.slice(0, 4)}`
    const finalEndToEndId = `E2E-NU-${timestampNano.slice(-8)}`
    const finalInstructionId = `${timestampNano.slice(-10)}`

    const newTransaction = {
      batch_id: finalBatchId,
      batch_settlement_date: todayStr,
      batch_purpose: 'SALARY_OR_OPERATIONAL',
      batch_currency: 'EGP',
      instruction_identification: finalInstructionId,
      end_to_end_identifier: finalEndToEndId,
      transaction_id: finalTxId,
      transaction_amount: amountNum,
      debtor_name: 'NILE UNIVERSITY ',
      debtor_account_number: '100020300405', // Nile University CIB main account
      debtor_party_bic: 'CIBEEGCX',           // CIB Head Office BIC
      creditor_name: creditor_name.trim(),
      creditor_account_number: creditor_account_number.trim(),
      creditor_party_bic: creditor_party_bic ? creditor_party_bic.trim() : 'UNKNOWN',
      transaction_purpose: transaction_purpose.trim(),
      comment: comment ? comment.trim() : 'Processed outbound ACH transfer',
      transaction_status: 'Accepted',
      receiving_date: todayStr,
      is_printed: 0,
      isostatus_description: 'Settled Final'
    }

    const { data, error } = await supabase
      .from('transactions')
      .insert([newTransaction])
      .select()

    if (error) throw error

    return res.status(201).json({
      message: 'Outbound ACH transfer settled successfully!',
      transaction: data[0]
    })

  } catch (error) {
    console.error('Error settling outbound transfer:', error)
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
}
