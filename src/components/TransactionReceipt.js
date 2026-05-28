import React, { forwardRef } from 'react';

// Format amount safely
const formatAmt = (amt) => {
  if (amt == null) return '';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amt);
};

const FieldsetWrapper = ({ title, children, style }) => (
  <div style={{ 
    position: 'relative', 
    border: '1px solid #000', 
    borderRadius: '4px', 
    padding: '12px 10px 8px 10px', 
    marginBottom: '20px',
    marginTop: '15px',
    ...style
  }}>
    <div style={{ 
      position: 'absolute', 
      top: '-11px', 
      left: '15px', 
      background: '#fff', 
      padding: '0 5px' 
    }}>
      <div style={{ 
        border: '1px solid #000', 
        borderRadius: '15px', 
        padding: '2px 15px', 
        fontSize: '11px', 
        fontWeight: 'bold',
        backgroundColor: '#f9f9f9'
      }}>
        {title}
      </div>
    </div>
    {children}
  </div>
);

const TransactionReceipt = forwardRef(({ transaction }, ref) => {
  if (!transaction) return null;

  return (
    <div 
      ref={ref}
      style={{
        padding: '30px 40px',
        width: '800px',
        minHeight: '1120px',
        backgroundColor: '#ffffff',
        color: '#000000',
        fontFamily: 'Arial, sans-serif',
        fontSize: '11px',
        boxSizing: 'border-box'
      }}
    >
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '25px' }}>
        <div style={{ width: '220px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* Red swoosh approximation */}
            <div style={{ width: '25px', height: '25px', backgroundColor: '#e51a2e', borderRadius: '50% 0 50% 50%', marginRight: '5px' }}></div>
            <div style={{ fontSize: '26px', fontWeight: '900', color: '#e51a2e', letterSpacing: '1px', fontFamily: 'Impact, sans-serif' }}>EG-ACH</div>
          </div>
          <div style={{ fontSize: '10px', color: '#000', marginTop: '2px', fontWeight: 'bold' }}>Automated Clearing House</div>
          <div style={{ fontSize: '10px', color: '#000' }}>Operated by EBC</div>
          <div style={{ borderBottom: '1px solid #e51a2e', width: '160px', marginTop: '4px' }}></div>
        </div>
        <div style={{ textAlign: 'center', flex: 1, marginTop: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>EG-ACH Direct Credit</h2>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold', marginTop: '4px' }}>Transaction Advice Report</h2>
        </div>
        <div style={{ width: '220px' }}></div>
      </div>

      {/* BATCH INFORMATION */}
      <FieldsetWrapper title="Batch Information">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr style={{ backgroundColor: '#eaeaea' }}>
              <td style={{ padding: '6px 8px', width: '15%', fontWeight: 'bold' }}>Batch ID:</td>
              <td style={{ padding: '6px 8px', width: '35%' }}>{transaction.batch_id || ''}</td>
              <td style={{ padding: '6px 8px', width: '15%', fontWeight: 'bold' }}>Purpose:</td>
              <td style={{ padding: '6px 8px', width: '35%' }} dir="rtl">{transaction.batch_purpose || ''}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>Settlement Date:</td>
              <td style={{ padding: '6px 8px' }}>{transaction.batch_settlement_date || ''}</td>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>Currency:</td>
              <td style={{ padding: '6px 8px' }}>{transaction.batch_currency || 'EGP'}</td>
            </tr>
            <tr style={{ backgroundColor: '#eaeaea' }}>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>Sending Date:</td>
              <td colSpan="3" style={{ padding: '6px 8px' }}>{transaction.created_at ? new Date(transaction.created_at).toISOString().replace('T', ' ').slice(0, 19) : ''}</td>
            </tr>
          </tbody>
        </table>
      </FieldsetWrapper>

      {/* PAYMENT INFORMATION */}
      <FieldsetWrapper title="Payment Information">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr style={{ backgroundColor: '#eaeaea' }}>
              <td style={{ padding: '6px 8px', width: '20%', fontWeight: 'bold' }}>Transaction ID:</td>
              <td style={{ padding: '6px 8px', width: '80%' }}>{transaction.transaction_id || ''}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>End To End ID:</td>
              <td style={{ padding: '6px 8px' }}>{transaction.end_to_end_identifier || transaction.transaction_id || ''}</td>
            </tr>
            <tr style={{ backgroundColor: '#eaeaea' }}>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>Instruction ID:</td>
              <td style={{ padding: '6px 8px' }}>{transaction.instruction_identification || '1'}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>Amount:</td>
              <td style={{ padding: '6px 8px' }}>{formatAmt(transaction.transaction_amount)}</td>
            </tr>
            <tr style={{ backgroundColor: '#eaeaea' }}>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>Purpose:</td>
              <td style={{ padding: '6px 8px' }} dir="rtl">{transaction.transaction_purpose || ''}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>Status:</td>
              <td style={{ padding: '6px 8px' }}>{transaction.transaction_status || ''} {transaction.isostatus_description ? `, ${transaction.isostatus_description}` : ''}</td>
            </tr>
            <tr style={{ backgroundColor: '#eaeaea' }}>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>Reason:</td>
              <td style={{ padding: '6px 8px' }}>{transaction.transaction_isostatus_reason || ''}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>Remittance Information:</td>
              <td style={{ padding: '6px 8px' }} dir="rtl">{transaction.comment || ''}</td>
            </tr>
          </tbody>
        </table>
      </FieldsetWrapper>

      {/* DEBTOR & CREDITOR INFO */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        
        {/* Debtor */}
        <div style={{ width: '49%' }}>
          <FieldsetWrapper title="Debtor Information" style={{ height: '180px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ backgroundColor: '#eaeaea' }}>
                  <td style={{ padding: '5px 8px', width: '35%', fontWeight: 'bold' }}>Bank Name:</td>
                  <td style={{ padding: '5px 8px', width: '65%' }}>Commercial International Bank</td>
                </tr>
                <tr>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Branch Name:</td>
                  <td style={{ padding: '5px 8px' }}></td>
                </tr>
                <tr style={{ backgroundColor: '#eaeaea' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Branch BIC:</td>
                  <td style={{ padding: '5px 8px' }}>{transaction.debtor_party_bic || ''}</td>
                </tr>
                <tr>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Name:</td>
                  <td style={{ padding: '5px 8px' }}>{transaction.debtor_name || 'NILE UNIVERSITY'}</td>
                </tr>
                <tr style={{ backgroundColor: '#eaeaea' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Acc. Type:</td>
                  <td style={{ padding: '5px 8px' }}></td>
                </tr>
                <tr>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Acc. No.:</td>
                  <td style={{ padding: '5px 8px' }}>{transaction.debtor_account_number || ''}</td>
                </tr>
                <tr style={{ backgroundColor: '#eaeaea' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>National ID:</td>
                  <td style={{ padding: '5px 8px' }}></td>
                </tr>
              </tbody>
            </table>
          </FieldsetWrapper>
        </div>

        {/* Creditor */}
        <div style={{ width: '49%' }}>
          <FieldsetWrapper title="Creditor Information" style={{ height: '180px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ backgroundColor: '#eaeaea' }}>
                  <td style={{ padding: '5px 8px', width: '35%', fontWeight: 'bold' }}>Bank Name:</td>
                  <td style={{ padding: '5px 8px', width: '65%' }}></td>
                </tr>
                <tr>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Branch Name:</td>
                  <td style={{ padding: '5px 8px' }}></td>
                </tr>
                <tr style={{ backgroundColor: '#eaeaea' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Branch BIC:</td>
                  <td style={{ padding: '5px 8px' }}>{transaction.creditor_party_bic || ''}</td>
                </tr>
                <tr>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Name:</td>
                  <td style={{ padding: '5px 8px' }} dir="rtl">{transaction.creditor_name || ''}</td>
                </tr>
                <tr style={{ backgroundColor: '#eaeaea' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Acc. Type:</td>
                  <td style={{ padding: '5px 8px' }}></td>
                </tr>
                <tr>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>Acc. No.:</td>
                  <td style={{ padding: '5px 8px' }}>{transaction.creditor_account_number || ''}</td>
                </tr>
                <tr style={{ backgroundColor: '#eaeaea' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 'bold' }}>National ID:</td>
                  <td style={{ padding: '5px 8px' }}></td>
                </tr>
              </tbody>
            </table>
          </FieldsetWrapper>
        </div>
      </div>

      {/* DEBTOR & CREDITOR ADDRESS */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        
        {/* Debtor Address */}
        <div style={{ width: '49%' }}>
          <FieldsetWrapper title="Debtor Address" style={{ padding: '0', height: '120px' }}>
            <div style={{ padding: '10px', height: '100%', backgroundColor: '#eaeaea', borderRadius: '4px' }}>
              EG ,
            </div>
          </FieldsetWrapper>
        </div>

        {/* Creditor Address */}
        <div style={{ width: '49%' }}>
          <FieldsetWrapper title="Creditor Address" style={{ padding: '0', height: '120px' }}>
            <div style={{ padding: '10px', height: '100%', backgroundColor: '#eaeaea', borderRadius: '4px' }}>
              EG ,
            </div>
          </FieldsetWrapper>
        </div>

      </div>

      {/* FOOTER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#555', marginTop: '10px' }}>
        <div>{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
        <div>Page 1 of 1</div>
      </div>

    </div>
  );
});

TransactionReceipt.displayName = 'TransactionReceipt';
export default TransactionReceipt;
