-- Run this in Supabase SQL Editor to update the Analytics logic to support the new filters
-- First DROP the old function, then CREATE the new one

DROP FUNCTION IF EXISTS get_transaction_dashboard_stats(text, text, text, text);
DROP FUNCTION IF EXISTS get_transaction_dashboard_stats(text, text, text, text, text, text);
DROP FUNCTION IF EXISTS get_transaction_dashboard_stats(text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION get_transaction_dashboard_stats(
  search_term text default '',
  status_filter text default 'All',
  start_date text default '',
  end_date text default '',
  comment_filter text default '',
  bank_account_filter text default '',
  source_bank_filter text default 'All'
)
RETURNS json AS $$
DECLARE
  total_sum numeric;
  total_cnt bigint;
  accepted_cnt bigint;
  rejected_cnt bigint;
  returned_cnt bigint;
  query_filter text := '';
BEGIN
  -- Build the filter string dynamically
  IF search_term <> '' THEN
    query_filter := query_filter || ' AND (creditor_name ILIKE ' || quote_literal('%' || search_term || '%') || 
                              ' OR batch_id ILIKE ' || quote_literal('%' || search_term || '%') || 
                              ' OR transaction_id ILIKE ' || quote_literal('%' || search_term || '%') || ')';
  END IF;
  
  IF status_filter <> 'All' THEN
    query_filter := query_filter || ' AND transaction_status = ' || quote_literal(status_filter);
  END IF;
  
  IF start_date <> '' THEN
    query_filter := query_filter || ' AND batch_settlement_date >= ' || quote_literal(start_date) || '::date';
  END IF;
  
  IF end_date <> '' THEN
    query_filter := query_filter || ' AND batch_settlement_date <= ' || quote_literal(end_date) || '::date';
  END IF;

  IF comment_filter <> '' THEN
    query_filter := query_filter || ' AND comment ILIKE ' || quote_literal('%' || comment_filter || '%');
  END IF;

  IF bank_account_filter <> '' THEN
    query_filter := query_filter || ' AND (creditor_account_number ILIKE ' || quote_literal('%' || bank_account_filter || '%') || 
                                    ' OR debtor_account_number ILIKE ' || quote_literal('%' || bank_account_filter || '%') || ')';
  END IF;

  IF source_bank_filter = 'Banque Misr' THEN
    query_filter := query_filter || ' AND batch_purpose = ' || quote_literal('Banque Misr');
  ELSIF source_bank_filter = 'CIB' THEN
    query_filter := query_filter || ' AND COALESCE(batch_purpose, '''') <> ' || quote_literal('Banque Misr');
  END IF;

  -- Run sum and counts
  EXECUTE 'SELECT COALESCE(SUM(transaction_amount), 0), COUNT(*) FROM transactions WHERE 1=1' || query_filter 
    INTO total_sum, total_cnt;
    
  EXECUTE 'SELECT COUNT(*) FROM transactions WHERE transaction_status = ''Accepted''' || query_filter 
    INTO accepted_cnt;
    
  EXECUTE 'SELECT COUNT(*) FROM transactions WHERE transaction_status = ''Rejected''' || query_filter 
    INTO rejected_cnt;
    
  EXECUTE 'SELECT COUNT(*) FROM transactions WHERE transaction_status = ''Returned''' || query_filter 
    INTO returned_cnt;

  RETURN json_build_object(
    'totalVolume', total_sum,
    'totalCount', total_cnt,
    'acceptedCount', accepted_cnt,
    'rejectedCount', rejected_cnt,
    'returnedCount', returned_cnt
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
