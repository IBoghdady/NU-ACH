import { supabase } from '../../lib/supabaseClient'
import { fetchAllPaginated } from '../../lib/supabasePagination'
import { stripEmployeeCodeIfVendorTag } from '../../lib/vendorStore'

function normalizePersonId(val) {
  const raw = String(val || '').trim().toLowerCase()
  if (!raw) return ''
  const stripped = raw.replace(/^(?:emp|emb|stu|stud)[-\s_:]*/i, '').replace(/^0+(?=\d)/, '')
  return stripped || raw
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { rows } = req.body

  if (!rows || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'Invalid payload: rows must be an array' })
  }

  try {
    // Fetch all beneficiaries with employee/student codes (ordered by id ASC so newest active account overrides old ones)
    const beneficiaries = await fetchAllPaginated(() =>
      supabase
        .from('beneficiaries')
        .select('id, employee_code, name, account_number, bank_bic', { count: 'exact' })
        .not('employee_code', 'is', null)
        .not('employee_code', 'ilike', 'VA:%')
        .order('id', { ascending: true })
    )

    const exactDict = {}
    const normDict = {}
    beneficiaries.forEach(b => {
      const code = stripEmployeeCodeIfVendorTag(b.employee_code)
      if (!code) return
      exactDict[code.toLowerCase()] = b
      const norm = normalizePersonId(code)
      if (norm) normDict[norm] = b
    })

    // Map the incoming rows to the strict ACH format
    const processedData = rows.map((row, index) => {
      const empId = row.employeeId?.toString().trim() || ''
      const lower = empId.toLowerCase()
      const norm = normalizePersonId(empId)
      const ben = (lower && exactDict[lower]) || (norm && normDict[norm]) || {}

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
