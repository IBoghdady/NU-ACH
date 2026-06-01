import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import Script from 'next/script'
import styles from '../styles/Home.module.css'
import { supabase } from '../lib/supabaseClient'
import TransactionReceipt from '../components/TransactionReceipt'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import toast from 'react-hot-toast'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'

export default function Home() {
  // Authentication State
  const [session, setSession] = useState(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(false)
  const [isInitialCheck, setIsInitialCheck] = useState(true)

  // Theme State
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    const savedTheme = localStorage.getItem('app-theme') || 'dark'
    setTheme(savedTheme)
    document.documentElement.setAttribute('data-theme', savedTheme)
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
    localStorage.setItem('app-theme', newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setIsInitialCheck(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setIsAuthLoading(true)
    setAuthError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    })
    if (error) setAuthError(error.message)
    setIsAuthLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  // Navigation State (Active View)
  const [activeView, setActiveView] = useState('dashboard') // 'dashboard' | 'beneficiaries'
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleNavClick = (view) => {
    setActiveView(view)
    setSidebarOpen(false)
  }

  // Clipboard Copied State
  const [copiedKey, setCopiedKey] = useState('')

  // Transaction Import State
  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState([])
  const [importStats, setImportStats] = useState({ total: 0, valid: 0, warnings: 0, errors: 0 })
  const [isImporting, setIsImporting] = useState(false)

  // Receipt Generator State
  const receiptRef = useRef(null)
  const [receiptTx, setReceiptTx] = useState(null)
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false)

  const handleGeneratePDF = (tx) => {
    if (typeof window === 'undefined' || !window.html2pdf) {
      toast.error('PDF Engine is still loading, please wait a moment.')
      return
    }
    setReceiptTx(tx)
    setIsGeneratingPDF(true)
    
    // Give React a moment to render the hidden receipt with the correct transaction data
    setTimeout(() => {
      const element = receiptRef.current
      if (element) {
        const opt = {
          margin: 0,
          filename: `Advice_Report_${tx.transaction_id || 'receipt'}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        }
        window.html2pdf().set(opt).from(element).save().then(() => {
          setIsGeneratingPDF(false)
          setReceiptTx(null)
        })
      }
    }, 500)
  }

  // ----------------------------------------------------------------
  // BULK PAYOUT GENERATOR STATE & LOGIC
  // ----------------------------------------------------------------
  const [payoutFile, setPayoutFile] = useState(null)
  const [payoutPreview, setPayoutPreview] = useState([])
  const [isPayoutProcessing, setIsPayoutProcessing] = useState(false)
  const [payoutStats, setPayoutStats] = useState(null)

  const handlePayoutFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setPayoutFile(file)
    setIsPayoutProcessing(true)

    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const data = XLSX.utils.sheet_to_json(ws)
        
        // Map common column variations
        const mappedData = data.map(row => ({
          employeeId: row['Employee ID'] || row['EmployeeID'] || row['EMP ID'] || row['Employee Code'] || '',
          amount: row['Amount'] || row['TransactionAmount'] || 0,
          comment: row['Comment'] || row['Comments'] || row['Description'] || ''
        }))

        // Call API
        const res = await fetch('/api/generate_payouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: mappedData })
        })
        const result = await res.json()
        
        if (result.success) {
          setPayoutPreview(result.data)
          setPayoutStats(result.stats)
        } else {
          toast.error('Error processing file: ' + result.error)
        }
      } catch (err) {
        console.error(err)
        toast.error('Error parsing file. Please ensure it is a valid Excel or CSV file.')
      } finally {
        setIsPayoutProcessing(false)
      }
    }
    reader.readAsBinaryString(file)
  }

  const exportPayoutToExcel = () => {
    if (!payoutPreview.length) return
    
    // Remove internal fields used for UI state
    const exportData = payoutPreview.map(row => {
      const { _id, _status, _originalEmployeeId, ...rest } = row
      return rest
    })
    
    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "ACH Payouts")
    XLSX.writeFile(wb, `ACH_Payout_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const downloadPayoutTemplate = () => {
    const templateData = [
      { "Employee ID": "", "Amount": "", "Comment": "" }
    ]
    const ws = XLSX.utils.json_to_sheet(templateData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Template")
    XLSX.writeFile(wb, "Payout_Template.xlsx")
  }

  const generateACHRow = (ben, amount, comment) => {
    return {
      TransactionID: 1,
      CreditorName: ben.name || '',
      CreditorAccountNumber: ben.account_number || '',
      CreditorBank: ben.bank_bic || '',
      CreditorBankBranch: '',
      TransactionAmount: parseFloat(amount) || 0,
      TransactionPurpose: 'CASH',
      Comments: comment || '',
      ReceiverEmail: '',
      SMSMobileNumber: ''
    }
  }

  const getFormattedDate = () => {
    const d = new Date()
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    return `${day}-${month}-${year}`
  }

  const handleSingleQuickPayout = () => {
    const { amount, comment } = payoutFormData[selectedBen.id] || {}
    if (!amount) return toast.error('Please enter an amount.')
    
    const row = generateACHRow(selectedBen, amount, comment)
    const ws = XLSX.utils.json_to_sheet([row])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "ACH")
    XLSX.writeFile(wb, `${selectedBen.name} - ${amount} - ${getFormattedDate()}.xlsx`)
    setShowSinglePayoutModal(false)
  }

  const handleGroupQuickPayout = async () => {
    for (const ben of selectedForPayout) {
      const { amount } = payoutFormData[ben.id] || {}
      if (!amount) return toast.error(`Please enter an amount for ${ben.name}`)
    }

    const zip = new JSZip()
    const dateStr = getFormattedDate()
    
    selectedForPayout.forEach((ben) => {
      const { amount, comment } = payoutFormData[ben.id] || {}
      const row = generateACHRow(ben, amount, comment)
      const ws = XLSX.utils.json_to_sheet([row])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "ACH")
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      zip.file(`${ben.name} - ${amount} - ${dateStr}.xlsx`, excelBuffer)
    })

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Group_Payout_${dateStr}.zip`
    a.click()
    URL.revokeObjectURL(url)
    
    setShowGroupPayoutModal(false)
    setSelectedForPayout([])
  }

  // Helper: Copy text to clipboard
  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(''), 2000)
  }

  // ----------------------------------------------------------------
  // DASHBOARD & TRANSACTION ARCHIVE DATA & FILTER STATES
  // ----------------------------------------------------------------
  const [search, setSearch] = useState('')
  const [commentFilter, setCommentFilter] = useState('')
  const [bankAccountFilter, setBankAccountFilter] = useState('')
  const [status, setStatus] = useState('All')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [transactions, setTransactions] = useState([])
  const [pagination, setPagination] = useState({ totalRecords: 0, currentPage: 1, totalPages: 1 })
  const [stats, setStats] = useState({ totalVolume: 0, totalCount: 0, acceptedCount: 0, rejectedCount: 0, returnedCount: 0, successRate: '100.00' })
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [analyticsData, setAnalyticsData] = useState({ topVendors: [], dailyOutflows: [] })
  
  useEffect(() => {
    if (activeView === 'dashboard') {
      const fetchAnalytics = async () => {
        try {
          const queryParams = new URLSearchParams({
            search: search,
            comment: commentFilter,
            bankAccount: bankAccountFilter,
            status: status,
            startDate: startDate,
            endDate: endDate
          })
          const res = await fetch(`/api/analytics?${queryParams.toString()}`)
          if (res.ok) {
            const data = await res.json()
            setAnalyticsData({ topVendors: data.topVendors || [], dailyOutflows: data.dailyOutflows || [] })
          }
        } catch (e) {
          console.error(e)
        }
      }
      fetchAnalytics()
    }
  }, [activeView, search, commentFilter, bankAccountFilter, status, startDate, endDate])

  // --- Functions ---Dashboard Transactions
  const fetchDashboardData = async () => {
    setIsLoading(true)
    setDashboardError('')
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: '25',
        search: search,
        comment: commentFilter,
        bankAccount: bankAccountFilter,
        status: status,
        startDate: startDate,
        endDate: endDate
      })

      const res = await fetch(`/api/transactions?${queryParams.toString()}`)
      if (!res.ok) throw new Error('Failed to retrieve transactions.')
      const data = await res.json()
      setTransactions(data.transactions || [])
      setPagination(data.pagination || { totalRecords: 0, currentPage: 1, totalPages: 1 })
      setStats(data.stats || { totalVolume: 0, totalCount: 0, acceptedCount: 0, rejectedCount: 0, returnedCount: 0, successRate: '100.00' })
    } catch (err) {
      console.error(err)
      setDashboardError('Could not load transactions. Please verify your Supabase connectivity.')
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch Dashboard Transactions
  useEffect(() => {
    if (activeView === 'dashboard' || activeView === 'transactions') {
      fetchDashboardData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, startDate, endDate, activeView])

  // Debounced search trigger for Dashboard
  useEffect(() => {
    if (activeView === 'dashboard' || activeView === 'transactions') {
      const delayDebounce = setTimeout(() => {
        fetchDashboardData()
      }, 500)

      return () => clearTimeout(delayDebounce)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, commentFilter, bankAccountFilter, activeView])

  // Export to Excel Function (All Dashboard Data)
  const handleExport = async () => {
    setIsExporting(true)
    try {
      let allRows = []
      let from = 0
      let to = 999
      let hasMore = true

      while (hasMore) {
        let query = supabase.from('transactions').select('*')

        if (search.trim()) {
          const term = `%${search.trim()}%`
          query = query.or(`creditor_name.ilike.${term},batch_id.ilike.${term},transaction_id.ilike.${term}`)
        }
        if (commentFilter.trim()) {
          query = query.ilike('comment', `%${commentFilter.trim()}%`)
        }
        if (bankAccountFilter.trim()) {
          const acc = bankAccountFilter.trim()
          query = query.or(`creditor_account_number.ilike.%${acc}%,debtor_account_number.ilike.%${acc}%`)
        }
        if (status !== 'All') {
          query = query.eq('transaction_status', status)
        }
        if (startDate) {
          query = query.gte('batch_settlement_date', startDate)
        }
        if (endDate) {
          query = query.lte('batch_settlement_date', endDate)
        }

        query = query
          .order('batch_settlement_date', { ascending: false })
          .range(from, to)

        const { data, error } = await query
        if (error) throw error

        if (!data || data.length === 0) {
          hasMore = false
        } else {
          allRows = [...allRows, ...data]
          if (data.length < 1000) {
            hasMore = false
          } else {
            from += 1000
            to += 1000
          }
        }
      }

      if (allRows.length === 0) {
        toast.error('No data matches the current filters to export!')
        return
      }

      let excelTemplate = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Nile University ACH</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; }
          th { background-color: #1e293b; color: #ffffff; padding: 10px; border: 1px solid #cbd5e1; }
          td { padding: 8px; border: 1px solid #cbd5e1; }
          .number { mso-number-format: "\#,##0\.00"; text-align: right; }
          .text { mso-number-format: "\@"; }
        </style>
      </head>
      <body>
        <table>
          <thead>
            <tr>
              <th>Batch ID</th>
              <th>Settlement Date</th>
              <th>Currency</th>
              <th>Transaction ID</th>
              <th>Transaction Amount (EGP)</th>
              <th>Debtor Name</th>
              <th>Debtor Account Number</th>
              <th>Debtor Party BIC</th>
              <th>Creditor Name</th>
              <th>Creditor Account Number</th>
              <th>Creditor Party BIC</th>
              <th>Transaction Purpose</th>
              <th>Transaction Status</th>
              <th>ISO Status Description</th>
              <th>ISO Rejection Reason</th>
              <th>Comment</th>
            </tr>
          </thead>
          <tbody>`

      allRows.forEach(row => {
        excelTemplate += `
            <tr>
              <td class="text">${row.batch_id || ''}</td>
              <td>${row.batch_settlement_date || ''}</td>
              <td>${row.batch_currency || ''}</td>
              <td class="text">${row.transaction_id || ''}</td>
              <td class="number">${row.transaction_amount || 0}</td>
              <td>${row.debtor_name || ''}</td>
              <td class="text">${row.debtor_account_number || ''}</td>
              <td>${row.debtor_party_bic || ''}</td>
              <td>${row.creditor_name || ''}</td>
              <td class="text">${row.creditor_account_number || ''}</td>
              <td>${row.creditor_party_bic || ''}</td>
              <td>${row.transaction_purpose || ''}</td>
              <td>${row.transaction_status || ''}</td>
              <td>${row.isostatus_description || ''}</td>
              <td>${row.transaction_isostatus_reason || ''}</td>
              <td>${row.comment || ''}</td>
            </tr>`
      })

      excelTemplate += `
          </tbody>
        </table>
      </body>
      </html>`

      const blob = new Blob([excelTemplate], { type: 'application/vnd.ms-excel;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `NU_ACH_Export_${new Date().toISOString().slice(0, 10)}.xls`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

    } catch (err) {
      console.error(err)
      toast.error('Failed to export to Excel. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  // ----------------------------------------------------------------
  // BENEFICIARIES DIRECTORY STATES & ACTIONS
  // ----------------------------------------------------------------
  const [beneficiaries, setBeneficiaries] = useState([])
  const [benSearch, setBenSearch] = useState('')
  const [benEmployeeCodeSearch, setBenEmployeeCodeSearch] = useState('')
  const [isBenLoading, setIsBenLoading] = useState(false)
  const [showAddBen, setShowAddBen] = useState(false)
  const [selectedBen, setSelectedBen] = useState(null)
  const [benHistory, setBenHistory] = useState([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  
  // Payout States
  const [selectedForPayout, setSelectedForPayout] = useState([])
  const [showGroupPayoutModal, setShowGroupPayoutModal] = useState(false)
  const [showSinglePayoutModal, setShowSinglePayoutModal] = useState(false)
  const [payoutFormData, setPayoutFormData] = useState({}) // { id: { amount, comment } }
  
  // New Beneficiary Form State
  const [newBenName, setNewBenName] = useState('')
  const [newBenAcc, setNewBenAcc] = useState('')
  const [newBenBic, setNewBenBic] = useState('')
  const [newBenEmpCode, setNewBenEmpCode] = useState('')
  const [newBenCategory, setNewBenCategory] = useState('Operational')
  const [benFormSuccess, setBenFormSuccess] = useState('')
  const [benFormError, setBenFormError] = useState('')

  // Bulk Registration States
  const [showBulkConflictModal, setShowBulkConflictModal] = useState(false)
  const [bulkConflicts, setBulkConflicts] = useState([]) // array of { newRow, existingRow, action: 'skip' | 'update' }
  const [bulkNewBens, setBulkNewBens] = useState([])
  const [isBulkProcessing, setIsBulkProcessing] = useState(false)
  
  // Quick Add State
  const [showQuickAddModal, setShowQuickAddModal] = useState(false)
  const [quickAddRow, setQuickAddRow] = useState(null)

  const downloadBulkRegistrationTemplate = () => {
    const templateData = [{ "Name": "John Doe", "Account Number": "123456789", "BIC": "CIBEEGCX", "Employee Code": "EMP-123", "Category": "Operational" }]
    const ws = XLSX.utils.json_to_sheet(templateData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Template")
    XLSX.writeFile(wb, "Bulk_Registration_Template.xlsx")
  }

  const exportAllBeneficiaries = async () => {
    try {
      let allData = []
      let from = 0
      const limit = 1000
      let hasMore = true
      
      while (hasMore) {
        const { data, error } = await supabase
          .from('beneficiaries')
          .select('name, account_number, bank_bic, employee_code, category')
          .order('name', { ascending: true })
          .range(from, from + limit - 1)
          
        if (error) throw error
        
        if (data && data.length > 0) {
          allData = [...allData, ...data]
          from += limit
        }
        
        if (!data || data.length < limit) {
          hasMore = false
        }
      }

      if (allData.length === 0) return toast.error('No beneficiaries found.')
      
      // Rename keys for better Excel headers
      const formattedData = allData.map(row => ({
        "Name": row.name,
        "Account Number": row.account_number,
        "BIC": row.bank_bic || '',
        "Employee Code": row.employee_code || '',
        "Category": row.category || ''
      }))

      const ws = XLSX.utils.json_to_sheet(formattedData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Beneficiaries")
      XLSX.writeFile(wb, `NU_Beneficiaries_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      console.error(err)
      toast.error('Failed to export beneficiaries.')
    }
  }

  const handleBulkRegistrationUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsBulkProcessing(true)
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const rawData = XLSX.utils.sheet_to_json(ws)
        
        if (!rawData || rawData.length === 0) throw new Error('File is empty or invalid.')
        
        // Fetch all existing beneficiaries to check conflicts
        let existingData = []
        let from = 0
        const limit = 1000
        let hasMore = true
        while (hasMore) {
          const { data, error } = await supabase.from('beneficiaries').select('*').range(from, from + limit - 1)
          if (error) throw error
          if (data && data.length > 0) {
            existingData = [...existingData, ...data]
            from += limit
          }
          if (!data || data.length < limit) {
            hasMore = false
          }
        }
        
        const existingMap = new Map()
        existingData.forEach(b => existingMap.set(b.account_number.toString(), b))

        const newBens = []
        const conflicts = []
        const newBensMap = new Set() // For deduplicating the excel file itself

        rawData.forEach(row => {
          const name = row['Name'] || row['name']
          const acc = (row['Account Number'] || row['account_number'] || row['account'])?.toString()
          if (!name || !acc) return // skip invalid
          
          const newRow = {
            name: String(name).trim(),
            account_number: acc.trim(),
            bank_bic: (row['BIC'] || row['bic'] || row['bank_bic'])?.toString()?.trim() || null,
            employee_code: (row['Employee Code'] || row['employee_code'])?.toString()?.trim() || null,
            category: (row['Category'] || row['category'])?.toString()?.trim() || 'Operational'
          }

          if (existingMap.has(newRow.account_number)) {
            conflicts.push({ newRow, existingRow: existingMap.get(newRow.account_number), action: 'skip' })
          } else if (!newBensMap.has(newRow.account_number)) {
            newBensMap.add(newRow.account_number)
            newBens.push(newRow)
          }
        })

        setBulkNewBens(newBens)
        if (conflicts.length > 0) {
          setBulkConflicts(conflicts)
          setShowBulkConflictModal(true)
        } else {
          await executeBulkInsert(newBens, [])
        }
      } catch (err) {
        console.error(err)
        toast.error('Failed to process bulk upload: ' + err.message)
      } finally {
        setIsBulkProcessing(false)
        e.target.value = '' // reset input
      }
    }
    reader.readAsBinaryString(file)
  }

  const executeBulkInsert = async (newBens, resolvedConflicts) => {
    setIsBulkProcessing(true)
    try {
      const updates = resolvedConflicts.filter(c => c.action === 'update').map(c => ({
        id: c.existingRow.id,
        ...c.newRow
      }))

      // Insert new
      if (newBens.length > 0) {
        const { error: insertErr } = await supabase.from('beneficiaries').insert(newBens)
        if (insertErr) throw insertErr
      }

      // Update existing
      if (updates.length > 0) {
        const { error: updateErr } = await supabase.from('beneficiaries').upsert(updates)
        if (updateErr) throw updateErr
      }

      toast.success(`Successfully registered ${newBens.length} new and updated ${updates.length} existing beneficiaries.`)
      setShowBulkConflictModal(false)
      setBulkNewBens([])
      fetchBeneficiaries()
    } catch (err) {
      console.error(err)
      toast.error('Failed to save bulk beneficiaries: ' + err.message)
    } finally {
      setIsBulkProcessing(false)
    }
  }

  // Transaction Import Handlers
  const handleTransactionFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return

    setImportFile(file)
    setIsImporting(true)
    const reader = new FileReader()

    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const rawData = XLSX.utils.sheet_to_json(ws, { defval: '' })

        if (rawData.length === 0) {
          toast.error('The uploaded file is empty.')
          setIsImporting(false)
          return
        }

        // We assume average amount for warning heuristic
        let totalAmount = 0
        let countAmounts = 0
        rawData.forEach(row => {
          const amt = parseFloat(row['Amount'] || row['transaction_amount'])
          if (!isNaN(amt)) {
            totalAmount += amt
            countAmounts++
          }
        })
        const avgAmount = countAmounts > 0 ? totalAmount / countAmounts : 0

        const previewData = rawData.map((row, index) => {
          const creditor_name = row['Creditor Name'] || row['creditor_name'] || row['Name'] || ''
          const transaction_amount = parseFloat(row['Amount'] || row['transaction_amount'] || 0)
          const creditor_account_number = row['Account Number'] || row['creditor_account_number'] || ''
          
          let status = 'valid'
          let errors = []

          if (!creditor_name) errors.push('Missing name')
          if (!transaction_amount || isNaN(transaction_amount) || transaction_amount <= 0) errors.push('Invalid amount')
          if (!creditor_account_number) errors.push('Missing account')

          if (errors.length > 0) {
            status = 'error'
          } else if (transaction_amount > avgAmount * 10 && avgAmount > 0) {
            status = 'warning'
            errors.push('Abnormal amount (>10x avg)')
          }

          return {
            id: index,
            batch_id: row['Batch ID'] || row['batch_id'] || `IMPORT-${new Date().toISOString().split('T')[0]}`,
            batch_settlement_date: row['Date'] || row['batch_settlement_date'] || new Date().toISOString(),
            transaction_id: row['Transaction ID'] || row['transaction_id'] || `TX-IMP-${Date.now()}-${index}`,
            transaction_amount,
            creditor_name,
            creditor_account_number,
            transaction_status: row['Status'] || row['transaction_status'] || 'Accepted',
            transaction_purpose: row['Purpose'] || row['transaction_purpose'] || 'Upload',
            status,
            errors
          }
        })

        const stats = {
          total: previewData.length,
          valid: previewData.filter(r => r.status === 'valid').length,
          warnings: previewData.filter(r => r.status === 'warning').length,
          errors: previewData.filter(r => r.status === 'error').length
        }

        setImportPreview(previewData)
        setImportStats(stats)

      } catch (err) {
        console.error(err)
        toast.error('Failed to parse file: ' + err.message)
      } finally {
        setIsImporting(false)
        e.target.value = ''
      }
    }
    reader.readAsBinaryString(file)
  }

  const handleImportCommit = async () => {
    const validRows = importPreview.filter(r => r.status !== 'error')
    if (validRows.length === 0) {
      toast.error('No valid rows to commit.')
      return
    }

    const cleanedRows = validRows.map(row => {
      const { id, status, errors, ...dbRow } = row
      return dbRow
    })

    setIsImporting(true)
    try {
      const res = await fetch('/api/bulk_import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: cleanedRows })
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to commit')

      toast.success(`Successfully imported ${result.inserted} new transactions. Skipped ${result.skipped} duplicates.`)
      
      // Reset state and switch view
      setImportFile(null)
      setImportPreview([])
      setImportStats({ total: 0, valid: 0, warnings: 0, errors: 0 })
      setActiveView('transactions')
      fetchDashboardData()
      
    } catch (err) {
      console.error(err)
      toast.error('Import failed: ' + err.message)
    } finally {
      setIsImporting(false)
    }
  }

  const handleOpenQuickAdd = (row) => {
    setQuickAddRow(row)
    setNewBenName(row.CreditorName || '')
    setNewBenAcc(row.CreditorAccountNumber || '')
    setNewBenEmpCode(row._originalEmployeeId || '')
    setNewBenBic(row.CreditorBank || '')
    setNewBenCategory('Operational')
    setShowQuickAddModal(true)
  }

  const handleQuickAddSubmit = async (e) => {
    e.preventDefault()
    if (!newBenName || !newBenAcc) return toast.error('Please fill out Name and Account.')
    
    setIsBulkProcessing(true)
    try {
      const benObj = {
        name: newBenName.trim(),
        account_number: newBenAcc.trim(),
        bank_bic: newBenBic?.trim() || null,
        category: newBenCategory,
        employee_code: newBenEmpCode?.trim() || null
      }

      const { data, error } = await supabase.from('beneficiaries').insert([benObj]).select().single()
      if (error) throw error
      
      toast.success(`Registered ${newBenName}!`)
      
      const updatedPreview = payoutPreview.map(r => {
        if (r.id === quickAddRow.id) {
           r._status = 'Matched'
           r.CreditorName = data.name
           r.CreditorAccountNumber = data.account_number
           r.CreditorBank = data.bank_bic || ''
        }
        return r
      })
      setPayoutPreview(updatedPreview)
      
      setPayoutStats(prev => ({
        ...prev,
        ready: prev.ready + 1,
        missing: prev.missing - 1
      }))

      setShowQuickAddModal(false)
      setQuickAddRow(null)
    } catch (error) {
      toast.error(error.message || 'Failed to quick add beneficiary.')
    } finally {
      setIsBulkProcessing(false)
    }
  }

  const fetchBeneficiaries = async () => {
    setIsBenLoading(true)
    try {
      const res = await fetch(`/api/beneficiaries?limit=150&search=${encodeURIComponent(benSearch)}&employeeCode=${encodeURIComponent(benEmployeeCodeSearch)}`)
      if (!res.ok) throw new Error('Could not pull beneficiaries.')
      const data = await res.json()
      setBeneficiaries(data.beneficiaries || [])
    } catch (err) {
      console.error(err)
    } finally {
      setIsBenLoading(false)
    }
  }

  useEffect(() => {
    if (activeView === 'beneficiaries') {
      fetchBeneficiaries()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  // Debounced search for Beneficiaries
  useEffect(() => {
    if (activeView === 'beneficiaries') {
      const delayDebounce = setTimeout(() => {
        fetchBeneficiaries()
      }, 350)
      return () => clearTimeout(delayDebounce)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benSearch, benEmployeeCodeSearch, activeView])

  // Handle adding new Beneficiary
  const handleAddBeneficiary = async (e) => {
    e.preventDefault()
    setBenFormError('')
    setBenFormSuccess('')

    if (!newBenName.trim() || !newBenAcc.trim()) {
      setBenFormError('Name and Account Number are required.')
      return
    }

    try {
      const res = await fetch('/api/beneficiaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newBenName,
          account_number: newBenAcc,
          bank_bic: newBenBic,
          category: newBenCategory
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to register beneficiary.')
      }

      toast.success(`Beneficiary "${newBenName}" registered successfully!`); setShowAddBen(false)
      setNewBenName('')
      setNewBenAcc('')
      setNewBenBic('')
      setNewBenCategory('Operational')
      setShowAddBen(false)
      fetchBeneficiaries()
    } catch (err) {
      setBenFormError(err.message)
    }
  }

  // View Beneficiary Details & History Drawer
  const handleViewBeneficiaryDetails = async (ben) => {
    setSelectedBen(ben)
    setIsHistoryLoading(true)
    setBenHistory([])
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('creditor_account_number', ben.account_number)
        .order('batch_settlement_date', { ascending: false })
        .limit(10)

      if (error) throw error
      setBenHistory(data || [])
    } catch (err) {
      console.error('Error fetching beneficiary history:', err)
    } finally {
      setIsHistoryLoading(false)
    }
  }

  // Export Specific Beneficiary's Payments Ledger
  const handleExportForBeneficiary = async (ben) => {
    setIsExporting(true)
    try {
      const { data: allRows, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('creditor_account_number', ben.account_number)
        .order('batch_settlement_date', { ascending: false })

      if (error) throw error

      if (!allRows || allRows.length === 0) {
        toast.error('No past transactions found to export for this specific account.')
        return
      }

      // Convert to a premium Excel-compliant HTML spreadsheet (handles Arabic & grids perfectly)
      let excelTemplate = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>NU Beneficiary Ledger</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; }
          th { background-color: #4f46e5; color: #ffffff; padding: 10px; border: 1px solid #cbd5e1; }
          td { padding: 8px; border: 1px solid #cbd5e1; }
          .number { mso-number-format: "\#,##0\.00"; text-align: right; }
          .text { mso-number-format: "\@"; }
        </style>
      </head>
      <body>
        <h2>Nile University Outbound Payout Ledger</h2>
        <p><b>Beneficiary:</b> ${ben.name}</p>
        <p><b>Account Number:</b> ${ben.account_number}</p>
        <p><b>SWIFT Code:</b> ${ben.bank_bic || 'CIBEEGCX (Default)'}</p>
        <br/>
        <table>
          <thead>
            <tr>
              <th>Batch ID</th>
              <th>Settlement Date</th>
              <th>Currency</th>
              <th>Transaction ID</th>
              <th>Transaction Amount (EGP)</th>
              <th>Debtor Name</th>
              <th>Transaction Purpose</th>
              <th>Transaction Status</th>
              <th>ISO Status Description</th>
              <th>ISO Rejection Reason</th>
              <th>Comment</th>
            </tr>
          </thead>
          <tbody>`

      allRows.forEach(row => {
        excelTemplate += `
            <tr>
              <td class="text">${row.batch_id || ''}</td>
              <td>${row.batch_settlement_date || ''}</td>
              <td>${row.batch_currency || ''}</td>
              <td class="text">${row.transaction_id || ''}</td>
              <td class="number">${row.transaction_amount || 0}</td>
              <td>${row.debtor_name || ''}</td>
              <td>${row.transaction_purpose || ''}</td>
              <td>${row.transaction_status || ''}</td>
              <td>${row.isostatus_description || ''}</td>
              <td>${row.transaction_isostatus_reason || ''}</td>
              <td>${row.comment || ''}</td>
            </tr>`
      })

      excelTemplate += `
          </tbody>
        </table>
      </body>
      </html>`

      const blob = new Blob([excelTemplate], { type: 'application/vnd.ms-excel;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `NU_Ledger_${ben.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xls`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

    } catch (err) {
      console.error(err)
      toast.error('Failed to export ledger. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  // Format currency
  const formatEGP = (val) => {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(val)
  }
  if (isInitialCheck) {
    return <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>Establishing secure connection...</div>
  }

  if (!session) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)', padding: '20px' }}>
        <Head>
          <title>Login - Nile Treasury</title>
        </Head>
        <div style={{ 
          background: 'var(--bg-card)', 
          padding: '3rem', 
          borderRadius: '24px', 
          width: '100%', 
          maxWidth: '480px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          border: '1px solid var(--border-color)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🏛️</div>
          <h1 style={{ color: 'var(--text-primary)', fontSize: '24px', margin: '15px 0 5px 0' }}>NU Treasury</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Secure Automated Clearing House</p>
          
          {authError && (
            <div style={{ background: 'var(--error-glow)', color: 'var(--error-color)', padding: '10px', borderRadius: '6px', fontSize: '13px', marginBottom: '20px', border: '1px solid var(--error-color)' }}>
              {authError}
            </div>
          )}
          
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input
              type="email"
              placeholder="Corporate Email"
              value={authEmail}
              onChange={(e) => setAuthEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                background: 'var(--input-bg)',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: '1rem'
              }}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                background: 'var(--input-bg)',
                color: 'var(--text-primary)',
                outline: 'none',
                fontSize: '1rem'
              }}
              required
            />
            <button type="submit" disabled={isAuthLoading} style={{ 
              marginTop: '1rem', 
              background: 'var(--accent-color)', 
              color: 'var(--text-primary)', 
              border: 'none', 
              padding: '14px', 
              borderRadius: '12px', 
              cursor: isAuthLoading ? 'wait' : 'pointer', 
              fontWeight: '600', 
              fontSize: '1rem', 
              transition: 'all 0.2s' 
            }}>
              {isAuthLoading ? 'Authenticating...' : 'Secure Sign In'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.appLayout}>
      <Head>
        <title>Nile University - Treasury Clearing Portal</title>
        <meta name="description" content="Secure ACH treasury and clearing log dashboard for Nile University" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js" strategy="lazyOnload" />

      {/* Hidden Receipt Component for PDF generation */}
      <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
        <TransactionReceipt transaction={receiptTx} ref={receiptRef} />
      </div>

      {/* Sidebar Overlay for Mobile */}
      <div 
        className={`${styles.sidebarOverlay} ${sidebarOpen ? styles.open : ''}`}
        onClick={() => setSidebarOpen(false)}
      ></div>

      {/* 🏛️ PREMIUM SIDEBAR NAVIGATION */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.open : ''}`}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarLogo}>🏛️</span>
          <div className={styles.sidebarLogoText}>NU Treasury</div>
        </div>

        <nav className={styles.sidebarNav}>
          <button 
            onClick={() => handleNavClick('dashboard')} 
            className={`${styles.navLink} ${activeView === 'dashboard' ? styles.active : ''}`}
          >
            <span>📊</span> Analytics
          </button>

          <button 
            onClick={() => handleNavClick('transactions')} 
            className={`${styles.navLink} ${activeView === 'transactions' ? styles.active : ''}`}
          >
            <span>🗃️</span> Transactions
          </button>
          
          <button 
            onClick={() => { handleNavClick('beneficiaries'); fetchBeneficiaries(); }} 
            className={`${styles.navLink} ${activeView === 'beneficiaries' ? styles.active : ''}`}
          >
            <span>👥</span> Beneficiaries
          </button>
          
          <button 
            onClick={() => handleNavClick('import')} 
            className={`${styles.navLink} ${activeView === 'import' ? styles.active : ''}`}
          >
            <span>📥</span> Transactions Upload
          </button>

          <button 
            onClick={() => handleNavClick('payouts')} 
            className={`${styles.navLink} ${activeView === 'payouts' ? styles.active : ''}`}
          >
            <span>📤</span> Batch Payments
          </button>
          
          <div style={{ marginTop: 'auto' }}>
            <button 
              onClick={toggleTheme} 
              className={styles.navLink}
              style={{ width: '100%', marginBottom: '10px' }}
            >
              <span>{theme === 'dark' ? '☀️' : '🌙'}</span> 
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
            <button 
              onClick={handleLogout} 
              className={styles.navLink}
              style={{ 
                color: '#f87171', 
                width: '100%', 
                textAlign: 'left', 
                marginTop: '20px',
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.1)',
                justifyContent: 'center',
                padding: '12px'
              }}
            >
              <span>🚪</span> Log Out
            </button>
          </div>
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar}>
              {session?.user?.email ? session.user.email.charAt(0).toUpperCase() : 'NU'}
            </div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <div className={styles.userName} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session?.user?.email ? session.user.email.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'NU Officer'}
              </div>
              <div className={styles.userRole}>{session?.user?.email || 'Treasury Team'}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 📊 MAIN CONTAINER INTERFACE */}
      <main className={styles.mainContent}>
        <button 
          className={styles.hamburgerBtn}
          onClick={() => setSidebarOpen(true)}
        >
          ☰
        </button>
        <div className={styles.container}>

          {/* Shared Filters for Dashboard and Transactions */}
          {(activeView === 'dashboard' || activeView === 'transactions') && (
            <section className={styles.filterSection} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '1.5rem' }}>
              <div className={styles.searchWrapper}>
                <span className={styles.searchIcon}>🔍</span>
                <input 
                  type="text" 
                  placeholder="Search Creditor, Batch..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              <div className={styles.searchWrapper}>
                <span className={styles.searchIcon}>💬</span>
                <input 
                  type="text" 
                  placeholder="Filter by Comment..." 
                  value={commentFilter}
                  onChange={(e) => setCommentFilter(e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              <div className={styles.searchWrapper}>
                <span className={styles.searchIcon}>🏦</span>
                <input 
                  type="text" 
                  placeholder="Bank Account..." 
                  value={bankAccountFilter}
                  onChange={(e) => setBankAccountFilter(e.target.value)}
                  className={styles.searchInput}
                />
              </div>

              <div>
                <select 
                  value={status} 
                  onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                  className={styles.selectInput}
                >
                  <option value="All">All Statuses</option>
                  <option value="Accepted">Accepted / Settled</option>
                  <option value="Rejected">Rejected</option>
                  <option value="Returned">Returned</option>
                </select>
              </div>

              <div>
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                  className={styles.dateInput}
                  title="Start Date"
                />
              </div>

              <div>
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                  className={styles.dateInput}
                  title="End Date"
                />
              </div>
            </section>
          )}

          {/* 1. DASHBOARD VIEW ARCHIVE */}
          {activeView === 'dashboard' && (
            <>
              <header className={styles.header}>
                <div className={styles.titleGroup}>
                  <h1>Treasury Analytics</h1>
                  <p className={styles.subtitle}>Executive overview of outbound ACH payments</p>
                </div>
              </header>

              {/* KPI Cards Grid */}
              <section className={styles.kpiGrid}>
                <div className={`${styles.kpiCard} ${styles.kpiAccent}`}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiTitle}>Total Transferred Volume</span>
                    <span className={styles.kpiIcon}>💰</span>
                  </div>
                  <div className={styles.kpiValue}>{formatEGP(stats.totalVolume)}</div>
                  <div className={styles.kpiTrend}>Total filtered EGP payments</div>
                </div>

                <div className={`${styles.kpiCard} ${styles.kpiSuccess}`}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiTitle}>Clearing Success Rate</span>
                    <span className={styles.kpiIcon}>🛡️</span>
                  </div>
                  <div className={styles.kpiValue}>{stats.successRate}%</div>
                  <div className={styles.kpiTrend}>
                    <span style={{ color: 'var(--success-color)' }}>{stats.acceptedCount.toLocaleString()}</span> settled successfully
                  </div>
                </div>

                <div className={`${styles.kpiCard} ${styles.kpiWarning}`}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiTitle}>Returned Transmissions</span>
                    <span className={styles.kpiIcon}>⚠️</span>
                  </div>
                  <div className={styles.kpiValue}>{stats.returnedCount.toLocaleString()}</div>
                  <div className={styles.kpiTrend}>Incorrect recipient details</div>
                </div>

                <div className={`${styles.kpiCard} ${styles.kpiError}`}>
                  <div className={styles.kpiHeader}>
                    <span className={styles.kpiTitle}>Rejected Transactions</span>
                    <span className={styles.kpiIcon}>❌</span>
                  </div>
                  <div className={styles.kpiValue}>{stats.rejectedCount.toLocaleString()}</div>
                  <div className={styles.kpiTrend}>Blocked by fraud checks</div>
                </div>
              </section>

              {/* Analytics Charts */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
                  <h3 style={{ marginBottom: '1rem', fontWeight: '600' }}>30-Day Cash Outflow (EGP)</h3>
                  <div style={{ width: '100%', height: '300px' }}>
                    <ResponsiveContainer>
                      <LineChart data={analyticsData.dailyOutflows} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                        <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={12} tickFormatter={(tick) => tick.substring(5)} />
                        <YAxis stroke="var(--text-secondary)" fontSize={12} tickFormatter={(tick) => `£${(tick/1000).toFixed(0)}k`} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                          formatter={(value) => [formatEGP(value), 'Amount']}
                          labelStyle={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}
                        />
                        <Line type="monotone" dataKey="amount" stroke="var(--accent-color)" strokeWidth={3} dot={{ r: 4, fill: '#1e293b', stroke: '#3b82f6', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#3b82f6' }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '1.5rem' }}>
                  <h3 style={{ marginBottom: '1rem', fontWeight: '600' }}>Top 5 Payees by Volume</h3>
                  <div style={{ width: '100%', height: '300px' }}>
                    <ResponsiveContainer>
                      <BarChart data={analyticsData.topVendors} layout="vertical" margin={{ top: 5, right: 30, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                        <XAxis type="number" stroke="var(--text-secondary)" fontSize={12} tickFormatter={(tick) => `£${(tick/1000).toFixed(0)}k`} />
                        <YAxis dataKey="name" type="category" stroke="var(--text-secondary)" fontSize={12} width={120} tick={{ fill: 'var(--text-secondary)' }} />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                          formatter={(value) => [formatEGP(value), 'Total Paid']}
                          labelStyle={{ display: 'none' }}
                          cursor={{ fill: 'var(--bg-hover)' }}
                        />
                        <Bar dataKey="value" fill="var(--success-color)" radius={[0, 4, 4, 0]} barSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 2. TRANSACTIONS ARCHIVE VIEW */}
          {activeView === 'transactions' && (
            <>
              <header className={styles.header}>
                <div className={styles.titleGroup}>
                  <h1>Transactions</h1>
                  <p className={styles.subtitle}>Treasury Outbound ACH Payments Database (2019 - 2026)</p>
                </div>
                <button 
                  onClick={handleExport} 
                  className={styles.exportBtn}
                  disabled={isExporting || isLoading || transactions.length === 0}
                >
                  {isExporting ? <>⏳ Exporting to Excel...</> : <>📥 Export to Excel</>}
                </button>
              </header>

              {/* Main Table Container */}
              <main className={styles.tableCard}>
                {isLoading ? (
                  <div className={styles.loaderWrapper}>
                    <div className={styles.spinner}></div>
                  </div>
                ) : dashboardError ? (
                  <div className={styles.noData}>
                    <div className={styles.noDataIcon}>🔌</div>
                    <div className={styles.noDataText}>{dashboardError}</div>
                    <div className={styles.noSubtext}>Check your connection credentials.</div>
                  </div>
                ) : transactions.length === 0 ? (
                  <div className={styles.noData}>
                    <div className={styles.noDataIcon}>📭</div>
                    <div className={styles.noDataText}>No Transactions Found</div>
                    <div className={styles.noSubtext}>Try clearing some filters.</div>
                  </div>
                ) : (
                  <>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>Date</th>
                            <th className={styles.th}>Creditor Name</th>
                            <th className={styles.th}>Creditor Account</th>
                            <th className={styles.th}>Transaction ID</th>
                            <th className={styles.th}>Status</th>
                            <th className={styles.th}>Comment</th>
                            <th className={styles.th} style={{ textAlign: 'right' }}>Amount</th>
                            <th className={styles.th} style={{ textAlign: 'center' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {transactions.map((tx) => (
                            <tr key={tx.id} className={styles.tr}>
                              <td className={styles.td}>
                                {tx.batch_settlement_date ? new Date(tx.batch_settlement_date).toLocaleDateString('en-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                              </td>
                              <td className={styles.td} style={{ fontWeight: '500' }}>{tx.creditor_name || 'N/A'}</td>
                              <td className={styles.td} style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                {tx.creditor_account_number || 'N/A'}
                              </td>
                              <td className={styles.td} style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                {tx.transaction_id || 'N/A'}
                              </td>
                              <td className={styles.td}>
                                <span className={`${styles.statusBadge} ${
                                  tx.transaction_status === 'Accepted' ? styles.statusAccepted :
                                  tx.transaction_status === 'Rejected' ? styles.statusRejected :
                                  styles.statusReturned
                                }`}>
                                  {tx.transaction_status || 'N/A'}
                                </span>
                              </td>
                              <td className={styles.td} style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                {tx.comment || '-'}
                              </td>
                              <td className={`${styles.td} ${styles.amount}`}>
                                {formatEGP(tx.transaction_amount)}
                              </td>
                              <td className={styles.td} style={{ textAlign: 'center' }}>
                                <button 
                                  onClick={() => handleGeneratePDF(tx)}
                                  style={{
                                    background: 'rgba(99, 102, 241, 0.15)',
                                    border: '1px solid rgba(99, 102, 241, 0.3)',
                                    color: '#818cf8',
                                    borderRadius: '6px',
                                    padding: '4px 8px',
                                    cursor: isGeneratingPDF ? 'wait' : 'pointer',
                                    fontSize: '0.8rem',
                                    transition: 'all 0.2s',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '5px',
                                    width: '100%'
                                  }}
                                  disabled={isGeneratingPDF}
                                  title="Download Advice Report PDF"
                                >
                                  {isGeneratingPDF && receiptTx?.id === tx.id ? '⏳' : '📄'}
                                  PDF
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination controls */}
                    <div className={styles.pagination}>
                      <div className={styles.paginationInfo}>
                        Showing <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{((pagination.currentPage - 1) * 25 + 1).toLocaleString()}</span> to{' '}
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                          {Math.min(pagination.currentPage * 25, pagination.totalRecords).toLocaleString()}
                        </span> of{' '}
                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{pagination.totalRecords.toLocaleString()}</span> entries
                      </div>
                      <div className={styles.paginationBtnGroup}>
                        <button 
                          className={styles.pageBtn}
                          disabled={pagination.currentPage <= 1}
                          onClick={() => setPage(prev => Math.max(prev - 1, 1))}
                        >
                          ◀ Previous
                        </button>
                        <button 
                          className={styles.pageBtn}
                          disabled={pagination.currentPage >= pagination.totalPages}
                          onClick={() => setPage(prev => Math.min(prev + 1, pagination.totalPages))}
                        >
                          Next ▶
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </main>
            </>
          )}

          {/* 2. BENEFICIARIES DIRECTORY VIEW */}
          {activeView === 'beneficiaries' && (
            <>
              <header className={styles.header}>
                <div className={styles.titleGroup}>
                  <h1>Beneficiaries</h1>
                  <p className={styles.subtitle}>Verified supplier, contractor, and operational receiving accounts</p>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button 
                    onClick={exportAllBeneficiaries}
                    className={styles.submitBtn}
                    style={{ margin: 0, padding: '0.75rem 1.25rem', width: 'auto', background: 'var(--bg-hover)', boxShadow: 'none', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    📥 Export All
                  </button>
                  <button 
                    onClick={downloadBulkRegistrationTemplate}
                    className={styles.submitBtn}
                    style={{ margin: 0, padding: '0.75rem 1.25rem', width: 'auto', background: 'var(--bg-hover)', boxShadow: 'none', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    📄 Template
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button 
                      className={styles.submitBtn}
                      style={{ margin: 0, padding: '0.75rem 1.25rem', width: 'auto', background: 'rgba(59, 130, 246, 0.1)', boxShadow: 'none', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#60a5fa' }}
                    >
                      {isBulkProcessing ? '⏳ Uploading...' : '📤 Bulk Upload'}
                    </button>
                    <input 
                      type="file" 
                      accept=".xlsx, .xls, .csv" 
                      onChange={handleBulkRegistrationUpload}
                      disabled={isBulkProcessing}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: isBulkProcessing ? 'not-allowed' : 'pointer' }}
                    />
                  </div>
                  <button 
                    onClick={() => setShowAddBen(!showAddBen)} 
                    className={styles.exportBtn}
                    style={{ padding: '0.75rem 1.25rem' }}
                  >
                    {showAddBen ? 'Close Registration' : '➕ Register Beneficiary'}
                  </button>
                </div>
              </header>

              {/* Add Beneficiary Form */}
              {showAddBen && (
                <div className={styles.formCard} style={{ marginBottom: '2.5rem', maxWidth: '100%' }}>
                  <h3 style={{ marginBottom: '1.5rem', fontWeight: '700' }}>Register New Outbound Beneficiary</h3>
                  
                  {benFormError && <div className={styles.errorBanner}>⚠️ {benFormError}</div>}
                  {benFormSuccess && <div className={styles.successBanner}>🛡️ {benFormSuccess}</div>}

                  <form onSubmit={handleAddBeneficiary} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                    <div className={styles.formGroup}>
                      <label className={styles.label}>Full Name / Corporation</label>
                      <input 
                        type="text" 
                        value={newBenName} 
                        onChange={(e) => setNewBenName(e.target.value)} 
                        className={styles.inputField}
                        placeholder="e.g. South Cairo Electricity Co."
                        required
                      />
                    </div>
                    
                    <div className={styles.formGroup}>
                      <label className={styles.label}>Bank Account Number (IBAN / Local)</label>
                      <input 
                        type="text" 
                        value={newBenAcc} 
                        onChange={(e) => setNewBenAcc(e.target.value)} 
                        className={styles.inputField}
                        placeholder="e.g. 001307050369..."
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label}>Bank BIC / Clearing Code</label>
                      <input 
                        type="text" 
                        value={newBenBic} 
                        onChange={(e) => setNewBenBic(e.target.value)} 
                        className={styles.inputField}
                        placeholder="e.g. CIBEEGCX"
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.label}>Category</label>
                      <select 
                        value={newBenCategory} 
                        onChange={(e) => setNewBenCategory(e.target.value)} 
                        className={styles.selectInput}
                      >
                        <option value="Operational">Operational Expenses</option>
                        <option value="Construction">Infrastructure & Construction</option>
                        <option value="Utilities">Utilities & Energy</option>
                        <option value="Insurance">Medical & Corporate Insurance</option>
                        <option value="Staff">Staff & Salaries</option>
                      </select>
                    </div>

                    <div style={{ gridColumn: 'span 2' }}>
                      <button type="submit" className={styles.submitBtn}>
                        Complete Registration
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Search Bar for Beneficiaries */}
              <section className={styles.filterSection} style={{ gridTemplateColumns: '1fr 150px' }}>
                <div className={styles.searchWrapper}>
                  <span className={styles.searchIcon}>🔍</span>
                  <input 
                    type="text" 
                    placeholder="Search Beneficiary Directory by name or account..." 
                    value={benSearch}
                    onChange={(e) => setBenSearch(e.target.value)}
                    className={styles.searchInput}
                  />
                </div>
                <div className={styles.searchWrapper}>
                  <span className={styles.searchIcon}>👤</span>
                  <input 
                    type="text" 
                    placeholder="Emp ID..." 
                    value={benEmployeeCodeSearch}
                    onChange={(e) => setBenEmployeeCodeSearch(e.target.value)}
                    className={styles.searchInput}
                  />
                </div>
              </section>

              {/* Directory Grid */}
              {isBenLoading ? (
                <div className={styles.loaderWrapper}>
                  <div className={styles.spinner}></div>
                </div>
              ) : beneficiaries.length === 0 ? (
                <div className={styles.noData}>
                  <div className={styles.noDataIcon}>👥</div>
                  <div className={styles.noDataText}>No Beneficiaries Found</div>
                  <div className={styles.noSubtext}>Register a new supplier or adjust search inputs.</div>
                </div>
              ) : (
                <div className={styles.beneficiaryGrid}>
                  {beneficiaries.map((ben) => (
                    <div 
                      key={ben.id} 
                      className={styles.beneficiaryCard}
                      onClick={() => handleViewBeneficiaryDetails(ben)}
                    >
                      <div className={styles.benInfo} style={{ position: 'relative' }}>
                        <div 
                          style={{ position: 'absolute', top: '0', right: '0' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input 
                            type="checkbox" 
                            style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
                            checked={selectedForPayout.some(b => b.id === ben.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedForPayout([...selectedForPayout, ben])
                                setPayoutFormData({ ...payoutFormData, [ben.id]: { amount: '', comment: '' } })
                              } else {
                                setSelectedForPayout(selectedForPayout.filter(b => b.id !== ben.id))
                              }
                            }}
                          />
                        </div>
                        <div className={styles.benAvatar}>
                          {ben.name ? ben.name.charAt(0).toUpperCase() : 'B'}
                        </div>
                        <h4 className={styles.benName}>{ben.name || 'N/A'}</h4>
                        <span className={styles.benCategory}>{ben.category || 'Operational'}</span>
                      </div>

                      <div className={styles.benDetails}>
                        <div className={styles.benLabel}>Account Number</div>
                        <div className={styles.benValue}>{ben.account_number || 'N/A'}</div>
                        {ben.employee_code && (
                          <>
                            <div className={styles.benLabel}>Employee Code</div>
                            <div className={styles.benValue} style={{ color: '#6366f1', fontWeight: '700' }}>#{ben.employee_code}</div>
                          </>
                        )}
                        <div className={styles.benLabel}>BIC / Routing</div>
                        <div className={styles.benValue} style={{ marginBottom: '0' }}>
                          {ben.bank_bic || 'CIBEEGCX (Default)'}
                        </div>
                      </div>

                      <div className={styles.benActionRow} onClick={(e) => e.stopPropagation()}>
                        <button 
                          className={styles.benPayBtn}
                          onClick={() => handleViewBeneficiaryDetails(ben)}
                          style={{ flex: '1', width: '100%' }}
                        >
                          View Profile & History
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selectedForPayout.length > 0 && (
                <div style={{
                  position: 'fixed',
                  bottom: '2rem',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  padding: '1rem 2rem',
                  borderRadius: '50px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1.5rem',
                  zIndex: 100
                }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{selectedForPayout.length} Selected</span>
                  <button 
                    className={styles.submitBtn} 
                    style={{ padding: '0.5rem 1.5rem', borderRadius: '50px', margin: 0 }}
                    onClick={() => setShowGroupPayoutModal(true)}
                  >
                    🚀 Group Payout
                  </button>
                  <button 
                    onClick={() => {
                      setSelectedForPayout([])
                      setPayoutFormData({})
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </>
          )}

        </div>

      {/* 3. BULK IMPORT VIEW */}
          {activeView === 'import' && (
            <>
              <header className={styles.header}>
                <div className={styles.titleGroup}>
                  <h1>Transactions Upload</h1>
                  <p className={styles.subtitle}>Upload ACH settlement reports securely</p>
                </div>
              </header>

              {!importFile ? (
                <div 
                  className={styles.tableCard} 
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', border: '2px dashed var(--border-color)', background: 'var(--bg-hover)', position: 'relative', cursor: 'pointer' }}
                  onClick={() => document.getElementById('transaction-upload-input').click()}
                >
                  <input
                    id="transaction-upload-input"
                    type="file"
                    accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                    onChange={handleTransactionFileUpload}
                    style={{ display: 'none' }}
                    disabled={isImporting}
                  />
                  <div style={{ fontSize: '3rem', margin: '1rem' }}>📤</div>
                  <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Drag & Drop Excel/CSV File</h3>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Supported formats: .xls, .xlsx, .csv</p>
                  <button 
                    className={styles.submitBtn} 
                    disabled={isImporting}
                    onClick={(e) => { e.stopPropagation(); document.getElementById('transaction-upload-input').click(); }}
                  >
                    {isImporting ? 'Processing...' : 'Select File to Upload'}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    <div className={styles.kpiCard}>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Total Rows</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{importStats.total}</div>
                    </div>
                    <div className={styles.kpiCard} style={{ borderBottom: '4px solid var(--success-color)' }}>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Valid</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--success-color)' }}>{importStats.valid}</div>
                    </div>
                    <div className={styles.kpiCard} style={{ borderBottom: '4px solid var(--warning-color)' }}>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Warnings</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--warning-color)' }}>{importStats.warnings}</div>
                    </div>
                    <div className={styles.kpiCard} style={{ borderBottom: '4px solid var(--error-color)' }}>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Errors</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--error-color)' }}>{importStats.errors}</div>
                    </div>
                  </div>

                  <div className={styles.tableCard}>
                    <div className={styles.tableHeader}>
                      <h2>Data Preview</h2>
                      <div style={{ display: 'flex', gap: '1rem' }}>
                        <button 
                          className={styles.submitBtn} 
                          style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', boxShadow: 'none' }}
                          onClick={() => { setImportFile(null); setImportPreview([]) }}
                          disabled={isImporting}
                        >
                          Cancel
                        </button>
                        <button 
                          className={styles.submitBtn} 
                          onClick={handleImportCommit}
                          disabled={importStats.valid === 0 || isImporting}
                        >
                          {isImporting ? 'Importing...' : 'Commit to Database'}
                        </button>
                      </div>
                    </div>
                    <div className={styles.tableWrapper}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>Status</th>
                            <th className={styles.th}>Creditor Name</th>
                            <th className={styles.th}>Account Number</th>
                            <th className={styles.th}>Amount</th>
                            <th className={styles.th}>Batch ID</th>
                            <th className={styles.th}>Issues</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.slice(0, 50).map((row, idx) => (
                            <tr key={idx} className={styles.tr}>
                              <td className={styles.td}>
                                {row.status === 'valid' && <span className={styles.statusBadge} style={{ background: 'var(--success-glow)', color: 'var(--success-color)' }}>Valid</span>}
                                {row.status === 'warning' && <span className={styles.statusBadge} style={{ background: 'var(--warning-glow)', color: 'var(--warning-color)' }}>Warning</span>}
                                {row.status === 'error' && <span className={styles.statusBadge} style={{ background: 'var(--error-glow)', color: 'var(--error-color)' }}>Error</span>}
                              </td>
                              <td className={styles.td} style={{ fontWeight: '500' }}>{row.creditor_name}</td>
                              <td className={styles.td}>{row.creditor_account_number}</td>
                              <td className={styles.td}>{formatEGP(row.transaction_amount)}</td>
                              <td className={styles.td}>{row.batch_id}</td>
                              <td className={styles.td} style={{ color: 'var(--error-color)', fontSize: '0.85rem' }}>
                                {row.errors.join(', ')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {importPreview.length > 50 && (
                        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}>
                          Showing first 50 rows of {importPreview.length}...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

      {/* 4. DETAIL HISTORY SLIDE-OUT DRAWER PANEL */}
      {selectedBen && (
        <div className={styles.drawerOverlay} onClick={() => setSelectedBen(null)}>
          <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            
            <div className={styles.drawerHeader}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                  {selectedBen.name}
                </h2>
                <span className={styles.benCategory}>{selectedBen.category || 'Operational'}</span>
              </div>
              <button className={styles.drawerClose} onClick={() => setSelectedBen(null)}>✕</button>
            </div>

            <div className={styles.drawerMeta}>
              <div className={styles.benLabel}>Clearing Account</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span className={styles.benValue} style={{ fontSize: '1rem', color: '#6366f1', marginBottom: 0, fontFamily: 'monospace' }}>
                  {selectedBen.account_number}
                </span>
                <button 
                  onClick={() => copyToClipboard(selectedBen.account_number, 'account')}
                  className={styles.copyBtn}
                >
                  {copiedKey === 'account' ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>

              {selectedBen.employee_code && (
                <>
                  <div className={styles.benLabel}>Employee Code</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span className={styles.benValue} style={{ fontSize: '1rem', color: '#6366f1', marginBottom: 0, fontWeight: '700' }}>
                      #{selectedBen.employee_code}
                    </span>
                    <button 
                      onClick={() => copyToClipboard(selectedBen.employee_code, 'empcode')}
                      className={styles.copyBtn}
                    >
                      {copiedKey === 'empcode' ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                </>
              )}

              <div className={styles.benLabel}>Bank Routing / BIC / SWIFT</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <span className={styles.benValue} style={{ marginBottom: 0, fontFamily: 'monospace' }}>
                  {selectedBen.bank_bic || 'CIBEEGCX'}
                </span>
                <button 
                  onClick={() => copyToClipboard(selectedBen.bank_bic || 'CIBEEGCX', 'bic')}
                  className={styles.copyBtn}
                >
                  {copiedKey === 'bic' ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button 
                  onClick={() => handleExportForBeneficiary(selectedBen)}
                  className={styles.submitBtn}
                  style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: 'var(--surface-color)' }}
                  disabled={isExporting}
                >
                  📥 Ledger
                </button>
                <button 
                  onClick={() => {
                    setPayoutFormData({ [selectedBen.id]: { amount: '', comment: '' } })
                    setShowSinglePayoutModal(true)
                  }}
                  className={styles.submitBtn}
                  style={{ flex: 2, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                >
                  ⚡ Quick Payout
                </button>
              </div>
            </div>

            <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Recent Payment Audits (Max 10)
            </h3>

            {isHistoryLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                <div className={styles.spinner} style={{ width: '30px', height: '30px' }}></div>
              </div>
            ) : benHistory.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
                No past transactions recorded for this specific account.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', flex: '1' }}>
                {benHistory.map((tx) => (
                  <div 
                    key={tx.id} 
                    style={{ 
                      background: 'var(--bg-hover)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '12px', 
                      padding: '1rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {tx.batch_settlement_date ? new Date(tx.batch_settlement_date).toLocaleDateString('en-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: '0.15rem' }}>
                        ID: {tx.transaction_id}
                      </div>
                      {tx.comment && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', fontStyle: 'italic' }}>
                          "{tx.comment}"
                        </div>
                      )}
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                        {formatEGP(tx.transaction_amount)}
                      </div>
                      <span 
                        className={`${styles.statusBadge}`}
                        style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', marginTop: '0.25rem', display: 'inline-block' }}
                      >
                        {tx.transaction_status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
        )}
        {/* ---------------------------------------------------------------- */}
        {/* BULK PAYOUTS VIEW */}
        {/* ---------------------------------------------------------------- */}
        {activeView === 'payouts' && (
          <div className={styles.dashboardContainer} style={{ animation: 'fadeIn 0.3s ease-out' }}>
            <div className={styles.header}>
              <div>
                <h1 className={styles.title}>Batch Payments</h1>
                <p className={styles.subtitle}>Upload simple payroll sheets to instantly generate fully compliant ACH forms.</p>
              </div>
            </div>

            <div className={styles.tableCard} style={{ display: 'flex', flexDirection: 'column', padding: '2rem', border: 'none', background: 'var(--bg-hover)', marginTop: '2rem' }}>
              <div style={{ display: 'flex', gap: '2rem', alignItems: 'stretch', flexWrap: 'wrap' }}>
                
                {/* Upload Zone */}
                <div style={{ flex: '1', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', margin: 0, fontWeight: '700' }}>Step 1: Upload Data</h3>
                    <button 
                      onClick={downloadPayoutTemplate}
                      style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold' }}
                    >
                      📥 Download Template
                    </button>
                  </div>
                  
                  <div 
                    style={{ 
                      position: 'relative',
                      padding: '3rem 2rem', 
                      background: 'rgba(59, 130, 246, 0.05)', 
                      border: '2px dashed rgba(59, 130, 246, 0.3)', 
                      borderRadius: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      flex: 1
                    }}
                    onClick={() => document.getElementById('payout-upload-input').click()}
                  >
                    <input 
                      id="payout-upload-input"
                      type="file" 
                      accept=".xlsx, .xls, .csv" 
                      onChange={handlePayoutFileUpload}
                      style={{ display: 'none' }} 
                    />
                    <div style={{ fontSize: '3rem', marginBottom: '1rem', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' }}>📄</div>
                    <div style={{ fontSize: '1.1rem', color: 'var(--text-primary)', fontWeight: 'bold', marginBottom: '0.5rem' }}>Drag & Drop your file here</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>or click to browse (.xlsx, .csv)</div>
                    <div style={{ marginTop: '1.5rem', background: 'var(--bg-hover)', padding: '0.75rem 1.25rem', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.1)' }}>
                      Required columns: <strong style={{ color: 'var(--text-primary)' }}>Employee ID</strong>, <strong style={{ color: 'var(--text-primary)' }}>Amount</strong>, <strong style={{ color: 'var(--text-primary)' }}>Comment</strong>
                    </div>
                  </div>
                </div>

                {/* Status & Export Zone */}
                <div style={{ flex: '1', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <h3 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', margin: 0, fontWeight: '700' }}>Step 2: Review & Export</h3>
                  
                  <div style={{ 
                    background: 'var(--bg-card)', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '16px', 
                    padding: '1.5rem',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.2)'
                  }}>
                    {isPayoutProcessing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                        <div className={styles.spinner} style={{ marginBottom: '1rem' }}></div>
                        <div style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>Matching Beneficiaries...</div>
                      </div>
                    ) : !payoutStats ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', textAlign: 'center' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.5 }}>🔍</div>
                        <div style={{ fontSize: '1.05rem' }}>Upload a file to see validation results.</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: 'var(--bg-hover)', borderRadius: '12px', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>Total Rows Scanned</span>
                          <span style={{ fontWeight: '800', color: 'var(--text-primary)', fontSize: '1.2rem' }}>{payoutStats.total}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '12px', alignItems: 'center' }}>
                          <span style={{ color: '#10b981', fontWeight: '600' }}>Ready for Payout</span>
                          <span style={{ fontWeight: '800', color: '#10b981', fontSize: '1.2rem' }}>{payoutStats.matched}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', background: payoutStats.missing > 0 ? 'rgba(239, 68, 68, 0.05)' : 'rgba(255,255,255,0.03)', border: payoutStats.missing > 0 ? '1px solid rgba(239, 68, 68, 0.2)' : 'none', borderRadius: '12px', alignItems: 'center' }}>
                          <span style={{ color: payoutStats.missing > 0 ? '#ef4444' : 'var(--text-secondary)', fontWeight: '600' }}>Missing/Errors</span>
                          <span style={{ fontWeight: '800', color: payoutStats.missing > 0 ? '#ef4444' : 'white', fontSize: '1.2rem' }}>{payoutStats.missing}</span>
                        </div>
                      </div>
                    )}

                    <button 
                      onClick={exportPayoutToExcel}
                      disabled={!payoutPreview.length}
                      className={styles.submitBtn}
                      style={{
                        marginTop: '1.5rem',
                        background: payoutPreview.length ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : '#334155',
                        boxShadow: payoutPreview.length ? '0 4px 15px rgba(16, 185, 129, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)' : 'none',
                        color: payoutPreview.length ? 'white' : '#94a3b8',
                        opacity: payoutPreview.length ? 1 : 0.5,
                        fontSize: '1.05rem',
                        padding: '1rem'
                      }}
                    >
                      <span style={{ marginRight: '0.5rem' }}>💾</span> Generate ACH Form
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* PREVIEW TABLE */}
            {payoutPreview.length > 0 && (
              <div className={styles.tableWrapper} style={{ marginTop: '20px' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Row</th>
                      <th className={styles.th}>Employee ID</th>
                      <th className={styles.th}>Creditor Name</th>
                      <th className={styles.th}>Account Number</th>
                      <th className={styles.th}>Bank Name</th>
                      <th className={styles.th}>Amount</th>
                      <th className={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutPreview.map((row) => (
                      <tr key={row._id} className={styles.tr}>
                        <td className={styles.td} style={{ color: 'var(--text-secondary)' }}>{row._id}</td>
                        <td className={styles.td} style={{ fontFamily: 'monospace' }}>{row._originalEmployeeId}</td>
                        <td className={styles.td} style={{ fontWeight: '500' }}>{row.CreditorName || '-'}</td>
                        <td className={styles.td} style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{row.CreditorAccountNumber || '-'}</td>
                        <td className={styles.td} style={{ color: 'var(--text-secondary)' }}>{row.CreditorBank || '-'}</td>
                        <td className={`${styles.td} ${styles.amount}`}>{formatEGP(row.TransactionAmount)}</td>
                        <td className={styles.td}>
                          {row._status === 'Matched' ? (
                            <span className={`${styles.statusBadge} ${styles.statusAccepted}`}>Matched</span>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span className={`${styles.statusBadge} ${styles.statusRejected}`}>Missing Details</span>
                              <button 
                                onClick={() => handleOpenQuickAdd(row)}
                                style={{ padding: '2px 8px', fontSize: '0.75rem', background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                Quick Register
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* QUICK PAYOUT MODAL */}
        {showSinglePayoutModal && selectedBen && (
          <div className={styles.drawerOverlay} style={{ zIndex: 1000 }}>
            <div className={styles.formCard} style={{ width: '400px', maxWidth: '90%' }}>
              <h3 style={{ marginBottom: '1.5rem', fontWeight: '700' }}>⚡ Quick Payout</h3>
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontWeight: 'bold' }}>{selectedBen.name}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{selectedBen.account_number}</div>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Amount (EGP)</label>
                <input 
                  type="number" 
                  className={styles.inputField} 
                  value={payoutFormData[selectedBen.id]?.amount || ''}
                  onChange={(e) => setPayoutFormData({
                    ...payoutFormData,
                    [selectedBen.id]: { ...payoutFormData[selectedBen.id], amount: e.target.value }
                  })}
                  placeholder="0.00"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.label}>Comment / Reference</label>
                <input 
                  type="text" 
                  className={styles.inputField} 
                  value={payoutFormData[selectedBen.id]?.comment || ''}
                  onChange={(e) => setPayoutFormData({
                    ...payoutFormData,
                    [selectedBen.id]: { ...payoutFormData[selectedBen.id], comment: e.target.value }
                  })}
                  placeholder="e.g. June Services"
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                <button className={styles.submitBtn} style={{ background: 'var(--surface-color)' }} onClick={() => setShowSinglePayoutModal(false)}>Cancel</button>
                <button className={styles.submitBtn} onClick={handleSingleQuickPayout}>💾 Download ACH</button>
              </div>
            </div>
          </div>
        )}

        {/* GROUP PAYOUT MODAL */}
        {showGroupPayoutModal && (
          <div className={styles.drawerOverlay} style={{ zIndex: 1000, overflowY: 'auto', padding: '2rem' }}>
            <div className={styles.formCard} style={{ width: '800px', maxWidth: '100%', margin: 'auto' }}>
              <h3 style={{ marginBottom: '1.5rem', fontWeight: '700' }}>🚀 Group Payout ({selectedForPayout.length} Vendors)</h3>
              
              <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: '1rem' }}>
                {selectedForPayout.map(ben => (
                  <div key={ben.id} style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ flex: 2 }}>
                      <div style={{ fontWeight: 'bold' }}>{ben.name}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{ben.account_number}</div>
                    </div>
                    <div className={styles.formGroup} style={{ flex: 1, marginBottom: 0 }}>
                      <label className={styles.label} style={{ fontSize: '0.75rem' }}>Amount</label>
                      <input 
                        type="number" 
                        className={styles.inputField} 
                        value={payoutFormData[ben.id]?.amount || ''}
                        onChange={(e) => setPayoutFormData({
                          ...payoutFormData,
                          [ben.id]: { ...payoutFormData[ben.id], amount: e.target.value }
                        })}
                        placeholder="0.00"
                        style={{ padding: '8px' }}
                      />
                    </div>
                    <div className={styles.formGroup} style={{ flex: 1.5, marginBottom: 0 }}>
                      <label className={styles.label} style={{ fontSize: '0.75rem' }}>Comment</label>
                      <input 
                        type="text" 
                        className={styles.inputField} 
                        value={payoutFormData[ben.id]?.comment || ''}
                        onChange={(e) => setPayoutFormData({
                          ...payoutFormData,
                          [ben.id]: { ...payoutFormData[ben.id], comment: e.target.value }
                        })}
                        placeholder="e.g. Monthly Fee"
                        style={{ padding: '8px' }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', justifyContent: 'flex-end' }}>
                <button className={styles.submitBtn} style={{ background: 'var(--surface-color)', flex: 0, padding: '10px 20px' }} onClick={() => setShowGroupPayoutModal(false)}>Cancel</button>
                <button className={styles.submitBtn} style={{ flex: 0, padding: '10px 20px', whiteSpace: 'nowrap' }} onClick={handleGroupQuickPayout}>🗜️ Export ZIP Archive</button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Upload Conflict Resolution Modal */}
        {showBulkConflictModal && (
          <div className={styles.drawerOverlay} style={{ zIndex: 1000, overflowY: 'auto', padding: '2rem' }} onClick={(e) => e.target === e.currentTarget && setShowBulkConflictModal(false)}>
            <div className={styles.formCard} style={{ width: '800px', maxWidth: '100%', margin: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: '800' }}>⚠️ Resolve Duplicate Accounts</h2>
                <button onClick={() => setShowBulkConflictModal(false)} className={styles.closeBtn}>×</button>
              </div>
              
              <div style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
                We found <strong>{bulkConflicts.length}</strong> account(s) that already exist in the directory. Please select whether to update their data or skip them.
              </div>

              <div style={{ maxHeight: '50vh', overflowY: 'auto', paddingRight: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {bulkConflicts.map((conflict, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-hover)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Uploaded Data</div>
                        <div style={{ fontWeight: 'bold' }}>{conflict.newRow.name}</div>
                        <div style={{ fontFamily: 'monospace', color: 'var(--accent-color)' }}>{conflict.newRow.account_number}</div>
                      </div>
                      <div style={{ flex: 1, borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Existing Data</div>
                        <div style={{ fontWeight: 'bold' }}>{conflict.existingRow.name}</div>
                        <div style={{ fontFamily: 'monospace', color: 'var(--accent-color)' }}>{conflict.existingRow.account_number}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input 
                          type="radio" 
                          name={`conflict-${idx}`} 
                          checked={conflict.action === 'skip'} 
                          onChange={() => {
                            const newConflicts = [...bulkConflicts];
                            newConflicts[idx].action = 'skip';
                            setBulkConflicts(newConflicts);
                          }}
                        /> 
                        Skip (Keep Existing)
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input 
                          type="radio" 
                          name={`conflict-${idx}`} 
                          checked={conflict.action === 'update'} 
                          onChange={() => {
                            const newConflicts = [...bulkConflicts];
                            newConflicts[idx].action = 'update';
                            setBulkConflicts(newConflicts);
                          }}
                        /> 
                        Update (Overwrite)
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', justifyContent: 'flex-end' }}>
                <button className={styles.submitBtn} style={{ background: 'var(--surface-color)', flex: 0, padding: '10px 20px', boxShadow: 'none' }} onClick={() => setShowBulkConflictModal(false)}>Cancel</button>
                <button 
                  className={styles.submitBtn} 
                  style={{ flex: 0, padding: '10px 20px', whiteSpace: 'nowrap' }} 
                  onClick={() => executeBulkInsert(bulkNewBens, bulkConflicts)}
                  disabled={isBulkProcessing}
                >
                  {isBulkProcessing ? 'Processing...' : 'Confirm & Import'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Quick Add Modal */}
        {showQuickAddModal && (
          <div className={styles.drawerOverlay} style={{ zIndex: 1100, overflowY: 'auto', padding: '2rem' }} onClick={(e) => e.target === e.currentTarget && setShowQuickAddModal(false)}>
            <div className={styles.formCard} style={{ width: '600px', maxWidth: '100%', margin: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: '800' }}>⚡ Quick Register Beneficiary</h2>
                <button onClick={() => setShowQuickAddModal(false)} className={styles.closeBtn}>×</button>
              </div>
              
              <form onSubmit={handleQuickAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>Beneficiary / Creditor Name *</label>
                  <input 
                    type="text" 
                    value={newBenName} 
                    onChange={(e) => setNewBenName(e.target.value)} 
                    className={styles.inputField}
                    placeholder="e.g. John Doe"
                    required 
                  />
                </div>
                
                <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>Account Number / IBAN *</label>
                  <input 
                    type="text" 
                    value={newBenAcc} 
                    onChange={(e) => setNewBenAcc(e.target.value)} 
                    className={styles.inputField}
                    placeholder="e.g. 100069899654"
                    required 
                  />
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                  <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                    <label className={styles.label}>Employee Code (Optional)</label>
                    <input 
                      type="text" 
                      value={newBenEmpCode} 
                      onChange={(e) => setNewBenEmpCode(e.target.value)} 
                      className={styles.inputField}
                      placeholder="e.g. EMP-123"
                    />
                  </div>
                  <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                    <label className={styles.label}>Bank BIC (Optional)</label>
                    <input 
                      type="text" 
                      value={newBenBic} 
                      onChange={(e) => setNewBenBic(e.target.value)} 
                      className={styles.inputField}
                      placeholder="e.g. CIBEEGCX"
                    />
                  </div>
                </div>

                <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                  <label className={styles.label}>Category *</label>
                  <select 
                    value={newBenCategory} 
                    onChange={(e) => setNewBenCategory(e.target.value)} 
                    className={styles.selectInput}
                  >
                    <option value="Operational">Operational Expenses</option>
                    <option value="Construction">Infrastructure & Construction</option>
                    <option value="Utilities">Utilities & Energy</option>
                    <option value="Insurance">Medical & Corporate Insurance</option>
                    <option value="Staff">Staff & Salaries</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                  <button type="button" className={styles.submitBtn} style={{ background: 'var(--surface-color)', flex: 0, padding: '10px 20px', boxShadow: 'none' }} onClick={() => setShowQuickAddModal(false)}>Cancel</button>
                  <button type="submit" className={styles.submitBtn} style={{ flex: 0, padding: '10px 20px', whiteSpace: 'nowrap' }} disabled={isBulkProcessing}>
                    {isBulkProcessing ? 'Registering...' : 'Register & Resolve'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
// Trigger Vercel Refresh

/* Vercel bundle update */