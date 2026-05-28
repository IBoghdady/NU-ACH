import { supabase } from '../../lib/supabaseClient'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // GET: Fetch list of beneficiaries
  if (req.method === 'GET') {
    const { search = '', employeeCode = '', page = 1, limit = 50 } = req.query
    const pageNum = parseInt(page, 10)
    const limitNum = parseInt(limit, 10)
    const from = (pageNum - 1) * limitNum
    const to = from + limitNum - 1

    try {
      let query = supabase
        .from('beneficiaries')
        .select('*', { count: 'exact' })

      if (search.trim()) {
        const term = `%${search.trim()}%`
        query = query.or(`name.ilike.${term},account_number.ilike.${term}`)
      }

      if (employeeCode.trim()) {
        query = query.eq('employee_code', employeeCode.trim())
      }

      // Order alphabetically by name
      query = query
        .order('name', { ascending: true })
        .range(from, to)

      const { data: beneficiaries, count, error } = await query

      if (error) throw error

      return res.status(200).json({
        beneficiaries,
        pagination: {
          totalRecords: count || 0,
          currentPage: pageNum,
          totalPages: Math.ceil((count || 0) / limitNum),
          limit: limitNum
        }
      })
    } catch (error) {
      console.error('Error fetching beneficiaries:', error)
      return res.status(500).json({ error: error.message || 'Internal Server Error' })
    }
  }

  // POST: Create a new beneficiary
  if (req.method === 'POST') {
    const { name, account_number, bank_bic, category = 'Operational' } = req.body

    if (!name || !account_number) {
      return res.status(400).json({ error: 'Name and Account Number are required.' })
    }

    try {
      const { data, error } = await supabase
        .from('beneficiaries')
        .insert([{
          name: name.trim(),
          account_number: account_number.trim(),
          bank_bic: bank_bic ? bank_bic.trim() : null,
          category
        }])
        .select()

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'A beneficiary with this account number already exists.' })
        }
        throw error
      }

      return res.status(201).json(data[0])
    } catch (error) {
      console.error('Error creating beneficiary:', error)
      return res.status(500).json({ error: error.message || 'Internal Server Error' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
