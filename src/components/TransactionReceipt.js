import React, { forwardRef } from 'react';

// Format amount safely
const formatAmt = (amt) => {
  if (amt == null) return '';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amt);
};

const TransactionReceipt = forwardRef(({ transaction }, ref) => {
  if (!transaction) return null;

  return (
    <div 
      ref={ref}
      style={{
        padding: '20px 40px',
        width: '800px', // A4 width approx (800px)
        minHeight: '1120px',
        backgroundColor: '#ffffff',
        color: '#000000',
        fontFamily: 'Arial, sans-serif',
        fontSize: '11px',
        boxSizing: 'border-box'
      }}
    >
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ width: '200px' }}>
          {/* Logo placeholder - using text to mimic */}
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#e51a2e', letterSpacing: '2px' }}>EG-ACH</div>
          <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>Automated Clearing House</div>
          <div style={{ fontSize: '9px', color: '#555' }}>Operated by EBC</div>
          <div style={{ borderBottom: '1px solid #e51a2e', width: '150px', marginTop: '4px' }}></div>
        </div>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>EG-ACH Direct Credit</h2>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>Transaction Advice Report</h2>
        </div>
        <div style={{ width: '200px' }}></div>
      </div>

      {/* BATCH INFORMATION */}
      <div style={{ marginBottom: '15px' }}>
        <div style={{
          display: 'inline-block',
          border: '1px solid #000',
          borderRadius: '15px',
          padding: '2px 10px',
          fontSize: '11px',
          fontWeight: 'bold',
          marginBottom: '-10px',
          backgroundColor: '#fff',
          position: 'relative',
          zIndex: 1,
          marginLeft: '15px'
        }}>Batch Information</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', marginTop: '0px' }}>
          <tbody>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <td style={{ padding: '6px 10px', width: '15%', fontWeight: 'bold', border: 'none' }}>Batch ID:</td>
              <td style={{ padding: '6px 10px', width: '35%', border: 'none' }}>{transaction.batch_id || ''}</td>
              <td style={{ padding: '6px 10px', width: '15%', fontWeight: 'bold', border: 'none' }}>Purpose:</td>
              <td style={{ padding: '6px 10px', width: '35%', border: 'none' }} dir="rtl">{transaction.batch_purpose || ''}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Settlement Date:</td>
              <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.batch_settlement_date || ''}</td>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Currency:</td>
              <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.batch_currency || 'EGP'}</td>
            </tr>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Sending Date:</td>
              <td colSpan="3" style={{ padding: '6px 10px', border: 'none' }}>{transaction.created_at ? new Date(transaction.created_at).toISOString().replace('T', ' ').slice(0, 19) : ''}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* PAYMENT INFORMATION */}
      <div style={{ marginBottom: '15px' }}>
        <div style={{
          display: 'inline-block',
          border: '1px solid #000',
          borderRadius: '15px',
          padding: '2px 10px',
          fontSize: '11px',
          fontWeight: 'bold',
          marginBottom: '-10px',
          backgroundColor: '#fff',
          position: 'relative',
          zIndex: 1,
          marginLeft: '15px'
        }}>Payment Information</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000' }}>
          <tbody>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <td style={{ padding: '6px 10px', width: '20%', fontWeight: 'bold', border: 'none' }}>Transaction ID:</td>
              <td style={{ padding: '6px 10px', width: '80%', border: 'none' }}>{transaction.transaction_id || ''}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>End To End ID:</td>
              <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.end_to_end_identifier || transaction.transaction_id || ''}</td>
            </tr>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Instruction ID:</td>
              <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.instruction_identification || '1'}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Amount:</td>
              <td style={{ padding: '6px 10px', border: 'none' }}>{formatAmt(transaction.transaction_amount)}</td>
            </tr>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Purpose:</td>
              <td style={{ padding: '6px 10px', border: 'none' }} dir="rtl">{transaction.transaction_purpose || ''}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Status:</td>
              <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.transaction_status || ''} {transaction.isostatus_description ? `, ${transaction.isostatus_description}` : ''}</td>
            </tr>
            <tr style={{ backgroundColor: '#f2f2f2' }}>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Reason:</td>
              <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.transaction_isostatus_reason || ''}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Remittance Information:</td>
              <td style={{ padding: '6px 10px', border: 'none' }} dir="rtl">{transaction.comment || ''}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* DEBTOR & CREDITOR INFO */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
        
        {/* Debtor */}
        <div style={{ width: '48%' }}>
          <div style={{
            display: 'inline-block',
            border: '1px solid #000',
            borderRadius: '15px',
            padding: '2px 10px',
            fontSize: '11px',
            fontWeight: 'bold',
            marginBottom: '-10px',
            backgroundColor: '#fff',
            position: 'relative',
            zIndex: 1,
            marginLeft: '15px'
          }}>Debtor Information</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000' }}>
            <tbody>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <td style={{ padding: '6px 10px', width: '30%', fontWeight: 'bold', border: 'none' }}>Bank Name:</td>
                <td style={{ padding: '6px 10px', width: '70%', border: 'none' }}>Commercial International Bank</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Branch Name:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}></td>
              </tr>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Branch BIC:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.debtor_party_bic || ''}</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Name:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.debtor_name || 'NILE UNIVERSITY'}</td>
              </tr>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Acc. Type:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}></td>
              </tr>
              <tr>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Acc. No.:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.debtor_account_number || ''}</td>
              </tr>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>National ID:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Creditor */}
        <div style={{ width: '48%' }}>
          <div style={{
            display: 'inline-block',
            border: '1px solid #000',
            borderRadius: '15px',
            padding: '2px 10px',
            fontSize: '11px',
            fontWeight: 'bold',
            marginBottom: '-10px',
            backgroundColor: '#fff',
            position: 'relative',
            zIndex: 1,
            marginLeft: '15px'
          }}>Creditor Information</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000' }}>
            <tbody>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <td style={{ padding: '6px 10px', width: '30%', fontWeight: 'bold', border: 'none' }}>Bank Name:</td>
                <td style={{ padding: '6px 10px', width: '70%', border: 'none' }}></td>
              </tr>
              <tr>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Branch Name:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}></td>
              </tr>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Branch BIC:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.creditor_party_bic || ''}</td>
              </tr>
              <tr>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Name:</td>
                <td style={{ padding: '6px 10px', border: 'none' }} dir="rtl">{transaction.creditor_name || ''}</td>
              </tr>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Acc. Type:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}></td>
              </tr>
              <tr>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>Acc. No.:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}>{transaction.creditor_account_number || ''}</td>
              </tr>
              <tr style={{ backgroundColor: '#f2f2f2' }}>
                <td style={{ padding: '6px 10px', fontWeight: 'bold', border: 'none' }}>National ID:</td>
                <td style={{ padding: '6px 10px', border: 'none' }}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* DEBTOR & CREDITOR ADDRESS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
        
        {/* Debtor Address */}
        <div style={{ width: '48%' }}>
          <div style={{
            display: 'inline-block',
            border: '1px solid #000',
            borderRadius: '15px',
            padding: '2px 10px',
            fontSize: '11px',
            fontWeight: 'bold',
            marginBottom: '-10px',
            backgroundColor: '#fff',
            position: 'relative',
            zIndex: 1,
            marginLeft: '15px'
          }}>Debtor Address</div>
          <div style={{ border: '1px solid #000', padding: '10px', height: '100px', backgroundColor: '#f2f2f2' }}>
            EG ,
          </div>
        </div>

        {/* Creditor Address */}
        <div style={{ width: '48%' }}>
          <div style={{
            display: 'inline-block',
            border: '1px solid #000',
            borderRadius: '15px',
            padding: '2px 10px',
            fontSize: '11px',
            fontWeight: 'bold',
            marginBottom: '-10px',
            backgroundColor: '#fff',
            position: 'relative',
            zIndex: 1,
            marginLeft: '15px'
          }}>Creditor Address</div>
          <div style={{ border: '1px solid #000', padding: '10px', height: '100px', backgroundColor: '#f2f2f2' }}>
            EG ,
          </div>
        </div>

      </div>

      {/* FOOTER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#555' }}>
        <div>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
        <div>Page 1 of 1</div>
      </div>

    </div>
  );
});

TransactionReceipt.displayName = 'TransactionReceipt';
export default TransactionReceipt;
