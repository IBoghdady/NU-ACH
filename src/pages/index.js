import { useState, useEffect } from 'react'
import Head from 'next/head'
import styles from '../styles/Home.module.css'
import { supabase } from '../lib/supabaseClient'

export default function Home() {
  // Navigation State (Active View)
  const [activeView, setActiveView] = useState('dashboard') // 'dashboard' | 'beneficiaries'

  // Clipboard Copied State
  const [copiedKey, setCopiedKey] = useState('')

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

  // Fetch Dashboard Transactions
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

  // Reload dashboard on filter changes
  useEffect(() => {
    if (activeView === 'dashboard') {
      fetchDashboardData()
    }
  }, [page, status, startDate, endDate, activeView])

  // Debounced search trigger for Dashboard
  useEffect(() => {
    if (activeView === 'dashboard') {
      const delayDebounce = setTimeout(() => {
        setPage(1)
        fetchDashboardData()
      }, 400)
      return () => clearTimeout(delayDebounce)
    }
  }, [search, commentFilter, bankAccountFilter])

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
        alert('No data matches the current filters to export!')
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
      alert('Failed to export to Excel. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  // ----------------------------------------------------------------
  // BENEFICIARIES DIRECTORY STATES & ACTIONS
  // ----------------------------------------------------------------
  const [beneficiaries, setBeneficiaries] = useState([])
  const [benSearch, setBenSearch] = useState('')
  const [isBenLoading, setIsBenLoading] = useState(false)
  const [showAddBen, setShowAddBen] = useState(false)
  const [selectedBen, setSelectedBen] = useState(null)
  const [benHistory, setBenHistory] = useState([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  
  // New Beneficiary Form State
  const [newBenName, setNewBenName] = useState('')
  const [newBenAcc, setNewBenAcc] = useState('')
  const [newBenBic, setNewBenBic] = useState('')
  const [newBenCategory, setNewBenCategory] = useState('Operational')
  const [benFormSuccess, setBenFormSuccess] = useState('')
  const [benFormError, setBenFormError] = useState('')

  const fetchBeneficiaries = async () => {
    setIsBenLoading(true)
    try {
      const res = await fetch(`/api/beneficiaries?limit=150&search=${encodeURIComponent(benSearch)}`)
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
  }, [activeView])

  // Debounced search for Beneficiaries
  useEffect(() => {
    if (activeView === 'beneficiaries') {
      const delayDebounce = setTimeout(() => {
        fetchBeneficiaries()
      }, 350)
      return () => clearTimeout(delayDebounce)
    }
  }, [benSearch])

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

      setBenFormSuccess(`Beneficiary "${newBenName}" registered successfully!`)
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
        alert('No past transactions found to export for this specific account.')
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
      alert('Failed to export ledger. Please try again.')
    } finally {
      setIsExporting(false)
    }
  }

  // Format currency
  const formatEGP = (val) => {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(val)
  }

  return (
    <div className={styles.appLayout}>
      <Head>
        <title>Nile University - Treasury Clearing Portal</title>
        <meta name="description" content="Secure ACH treasury and clearing log dashboard for Nile University" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* 🏛️ PREMIUM SIDEBAR NAVIGATION */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarLogo}>🏛️</span>
          <div className={styles.sidebarLogoText}>Nile Treasury</div>
        </div>

        <nav className={styles.sidebarNav}>
          <button 
            onClick={() => setActiveView('dashboard')} 
            className={`${styles.navLink} ${activeView === 'dashboard' ? styles.active : ''}`}
          >
            <span>📊</span> Dashboard Archive
          </button>
          
          <button 
            onClick={() => { setActiveView('beneficiaries'); fetchBeneficiaries(); }} 
            className={`${styles.navLink} ${activeView === 'beneficiaries' ? styles.active : ''}`}
          >
            <span>👥</span> Beneficiary Directory
          </button>
          
          <button 
            onClick={() => setActiveView('import')} 
            className={`${styles.navLink} ${activeView === 'import' ? styles.active : ''}`}
          >
            <span>📤</span> Bulk Import
          </button>
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar}>NU</div>
            <div>
              <div className={styles.userName}>Nile University</div>
              <div className={styles.userRole}>Treasury Officer</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 📊 MAIN CONTAINER INTERFACE */}
      <main className={styles.mainContent}>
        <div className={styles.container}>

          {/* 1. DASHBOARD VIEW ARCHIVE */}
          {activeView === 'dashboard' && (
            <>
              <header className={styles.header}>
                <div className={styles.titleGroup}>
                  <h1>Transactions Archive</h1>
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
                    <span className={styles.kpiIcon}>🚫</span>
                  </div>
                  <div className={styles.kpiValue}>{stats.rejectedCount.toLocaleString()}</div>
                  <div className={styles.kpiTrend}>Validation errors / failed balances</div>
                </div>
              </section>

              {/* Search & Filters Controls */}
              <section className={styles.filterSection} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
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
                            <th className={styles.th} style={{ textAlign: 'right' }}>Amount</th>
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
                              <td className={`${styles.td} ${styles.amount}`}>
                                {formatEGP(tx.transaction_amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination controls */}
                    <div className={styles.pagination}>
                      <div className={styles.paginationInfo}>
                        Showing <span style={{ fontWeight: '600', color: 'white' }}>{((pagination.currentPage - 1) * 25 + 1).toLocaleString()}</span> to{' '}
                        <span style={{ fontWeight: '600', color: 'white' }}>
                          {Math.min(pagination.currentPage * 25, pagination.totalRecords).toLocaleString()}
                        </span> of{' '}
                        <span style={{ fontWeight: '600', color: 'white' }}>{pagination.totalRecords.toLocaleString()}</span> entries
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
                  <h1>Beneficiary Directory</h1>
                  <p className={styles.subtitle}>Verified supplier, contractor, and operational receiving accounts</p>
                </div>
                <button 
                  onClick={() => setShowAddBen(!showAddBen)} 
                  className={styles.exportBtn}
                >
                  {showAddBen ? 'Close Registration' : '➕ Register Beneficiary'}
                </button>
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
              <section className={styles.filterSection} style={{ gridTemplateColumns: '1fr' }}>
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
                      <div className={styles.benInfo}>
                        <div className={styles.benAvatar}>
                          {ben.name ? ben.name.charAt(0).toUpperCase() : 'B'}
                        </div>
                        <h4 className={styles.benName}>{ben.name || 'N/A'}</h4>
                        <span className={styles.benCategory}>{ben.category || 'Operational'}</span>
                      </div>

                      <div className={styles.benDetails}>
                        <div className={styles.benLabel}>Account Number</div>
                        <div className={styles.benValue}>{ben.account_number || 'N/A'}</div>
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
            </>
          )}

        </div>
      </main>

      {/* 3. BULK IMPORT VIEW */}
          {activeView === 'import' && (
            <>
              <header className={styles.header}>
                <div className={styles.titleGroup}>
                  <h1>Bulk Import Transactions</h1>
                  <p className={styles.subtitle}>Upload ACH settlement reports securely</p>
                </div>
              </header>
              <div className={styles.tableCard} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', border: '2px dashed var(--border-color)', background: 'rgba(255,255,255,0.01)' }}>
                <div style={{ fontSize: '3rem', margin: '1rem' }}>📤</div>
                <h3 style={{ marginBottom: '0.5rem', color: 'white' }}>Drag & Drop Excel/CSV File</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Supported formats: .xls, .xlsx, .csv</p>
                <button className={styles.submitBtn} onClick={() => alert('Backend parsing logic is required for Excel files. Currently data is loaded via the python bulk-uploader.')}>
                  Select File to Upload
                </button>
              </div>
            </>
          )}

      {/* 4. DETAIL HISTORY SLIDE-OUT DRAWER PANEL */}
      {selectedBen && (
        <div className={styles.drawerOverlay} onClick={() => setSelectedBen(null)}>
          <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            
            <div className={styles.drawerHeader}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'white', lineHeight: '1.4' }}>
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
              
              <button 
                onClick={() => handleExportForBeneficiary(selectedBen)}
                className={styles.submitBtn}
                style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                disabled={isExporting}
              >
                📥 {isExporting ? 'Exporting Ledger...' : 'Export Payout Ledger to Excel'}
              </button>
            </div>

            <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '1rem', color: 'white' }}>
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
                      background: 'rgba(255,255,255,0.02)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '12px', 
                      padding: '1rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'white' }}>
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
                      <div style={{ fontWeight: '700', fontSize: '0.9rem', color: 'white', fontFamily: 'monospace' }}>
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

    </div>
  )
}
