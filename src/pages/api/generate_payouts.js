import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { rows } = req.body

  if (!rows || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'Invalid payload: rows must be an array' })
  }

  try {
    // Extract all unique employee IDs from the incoming rows
    const employeeIds = [...new Set(rows.map(r => r.employeeId?.toString().trim()).filter(Boolean))]

    // Fetch all matching beneficiaries from Supabase in one query
    const { data: beneficiaries, error } = await supabase
      .from('beneficiaries')
      .select('employee_code, name, account_number, bank_bic')
      .in('employee_code', employeeIds)

    if (error) {
      throw error
    }

    // Create a lookup dictionary for extremely fast O(1) mapping
    const benDict = {}
    beneficiaries.forEach(b => {
      if (b.employee_code) {
        benDict[b.employee_code] = b
      }
    })

    // Map the incoming rows to the strict ACH format
    const processedData = rows.map((row, index) => {
      const empId = row.employeeId?.toString().trim()
      const ben = benDict[empId] || {}

      // Identify missing beneficiaries or missing bank details
      const isMissingDetails = !ben.name || !ben.account_number || !ben.bank_bic
      const status = isMissingDetails ? 'Missing Bank Details' : 'Matched'

      return {
        _id: index + 1, // Unique row ID for UI
        _status: status,
        TransactionID: index + 1,
        CreditorName: ben.name || '',
        CreditorAccountNumber: ben.account_number || '',
        CreditorBank: ben.bank_bic || '',
        CreditorBankBranch: '',
        TransactionAmount: row.amount || 0,
        TransactionPurpose: 'CASH', // Standard ACH purpose
        Comments: row.comment || '',
        ReceiverEmail: '',
        SMSMobileNumber: '',
        // Keep the original Employee ID for visibility
        _originalEmployeeId: empId
      }
    })

    return res.status(200).json({ 
      success: true, 
      data: processedData,
      stats: {
        total: processedData.length,
        matched: processedData.filter(r => r._status === 'Matched').length,
        missing: processedData.filter(r => r._status === 'Missing Bank Details').length
      }
    })

  } catch (error) {
    console.error('API Error in generate_payouts:', error)
    return res.status(500).json({ error: error.message })
  }
}
