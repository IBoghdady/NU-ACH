import { useState, useEffect } from 'react'
import Head from 'next/head'
import styles from '../styles/Home.module.css'
import { supabase } from '../lib/supabaseClient'

export default function Home() {
  // Filter States
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)

  // Data States
  const [transactions, setTransactions] = useState([])
  const [pagination, setPagination] = useState({ totalRecords: 0, currentPage: 1, totalPages: 1 })
  const [stats, setStats] = useState({ totalVolume: 0, totalCount: 0, acceptedCount: 0, rejectedCount: 0, returnedCount: 0, successRate: '100.00' })
  
  // UX States
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Fetch data
  const fetchData = async () => {
    setIsLoading(true)
    setErrorMessage('')
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: '25',
        search: search,
        status: status,
        startDate: startDate,
        endDate: endDate
      })

      const res = await fetch(`/api/transactions?${queryParams.toString()}`)
      if (!res.ok) {
        throw new Error('Failed to retrieve transactions.')
      }

      const data = await res.json()
      setTransactions(data.transactions || [])
      setPagination(data.pagination || { totalRecords: 0, currentPage: 1, totalPages: 1 })
      setStats(data.stats || { totalVolume: 0, totalCount: 0, acceptedCount: 0, rejectedCount: 0, returnedCount: 0, successRate: '100.00' })
    } catch (err) {
      console.error(err)
      setErrorMessage('Could not load transactions. Please check your Supabase connection.')
    } finally {
      setIsLoading(false)
    }
  }

  // Reload data when filters or page change
  useEffect(() => {
    fetchData()
  }, [page, status, startDate, endDate])

  // Debounced search trigger
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setPage(1)
      fetchData()
    }, 400)

    return () => clearTimeout(delayDebounceFn)
  }, [search])

  // Export to Excel Function
  const handleExport = async () => {
    setIsExporting(true)
    try {
      let allRows = []
      let from = 0
      let to = 999
      let hasMore = true

      // Fetch all matching rows in batches of 1,000 to bypass PostgREST's 1,000-row limit!
      while (hasMore) {
        let query = supabase.from('transactions').select('*')

        if (search.trim()) {
          const term = `%${search.trim()}%`
          query = query.or(`creditor_name.ilike.${term},batch_id.ilike.${term},transaction_id.ilike.${term}`)
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

        // Fetch paginated chunk sorted by date
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

      // Convert to a premium Excel-compliant HTML spreadsheet (handles Arabic & grids perfectly)
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

      // Generate file download link
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

  // Format currency
  const formatEGP = (val) => {
    return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP' }).format(val)
  }

  return (
    <div className={styles.container}>
      <Head>
        <title>Nile University Transactions Portal</title>
        <meta name="description" content="Secure ACH treasury and clearing log dashboard for Nile University" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Nile University Transactions</h1>
          <p className={styles.subtitle}>Treasury ACH Outbound Payments Archive (2019 - 2026)</p>
        </div>
        <button 
          onClick={handleExport} 
          className={styles.exportBtn}
          disabled={isExporting || isLoading || transactions.length === 0}
        >
          {isExporting ? (
            <>⏳ Exporting...</>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Export filtered data
            </>
          )}
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
          <div className={styles.kpiTrend}>Active filtered currency volume</div>
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
          <div className={styles.kpiTrend}>Unclaimed or incorrect recipient details</div>
        </div>

        <div className={`${styles.kpiCard} ${styles.kpiError}`}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiTitle}>Rejected Transactions</span>
            <span className={styles.kpiIcon}>🚫</span>
          </div>
          <div className={styles.kpiValue}>{stats.rejectedCount.toLocaleString()}</div>
          <div className={styles.kpiTrend}>Failed validations or invalid balances</div>
        </div>
      </section>

      {/* Search & Filters Controls */}
      <section className={styles.filterSection}>
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}>🔍</span>
          <input 
            type="text" 
            placeholder="Search Creditor, Batch, or Tx ID..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
            placeholder="Start Settlement Date"
            className={styles.dateInput}
            title="Start Settlement Date"
          />
        </div>

        <div>
          <input 
            type="date" 
            value={endDate} 
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            placeholder="End Settlement Date"
            className={styles.dateInput}
            title="End Settlement Date"
          />
        </div>
      </section>

      {/* Main Table Container */}
      <main className={styles.tableCard}>
        {isLoading ? (
          <div className={styles.loaderWrapper}>
            <div className={styles.spinner}></div>
          </div>
        ) : errorMessage ? (
          <div className={styles.noData}>
            <div className={styles.noDataIcon}>🔌</div>
            <div className={styles.noDataText}>{errorMessage}</div>
            <div className={styles.noSubtext}>Ensure your Supabase project is active and credentials are set.</div>
          </div>
        ) : transactions.length === 0 ? (
          <div className={styles.noData}>
            <div className={styles.noDataIcon}>📭</div>
            <div className={styles.noDataText}>No Transactions Found</div>
            <div className={styles.noSubtext}>Try adjusting your search filters or date ranges.</div>
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
    </div>
  )
}
