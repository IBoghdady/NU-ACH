-- Run this in Supabase SQL Editor to update the Analytics logic to support the new filters

create or replace function get_transaction_dashboard_stats(
  search_term text default '',
  status_filter text default 'All',
  start_date text default '',
  end_date text default '',
  comment_filter text default '',
  bank_account_filter text default '',
  source_bank_filter text default 'All'
)
returns json as $body
declare
  total_sum numeric;
  total_cnt bigint;
  accepted_cnt bigint;
  rejected_cnt bigint;
  returned_cnt bigint;
  query_filter text := '';
begin
  -- Build the filter string dynamically
  if search_term <> '' then
    query_filter := query_filter || ' and (creditor_name ilike ' || quote_literal('%' || search_term || '%') || 
                              ' or batch_id ilike ' || quote_literal('%' || search_term || '%') || 
                              ' or transaction_id ilike ' || quote_literal('%' || search_term || '%') || ')';
  end if;
  
  if status_filter <> 'All' then
    query_filter := query_filter || ' and transaction_status = ' || quote_literal(status_filter);
  end if;
  
  if start_date <> '' then
    query_filter := query_filter || ' and batch_settlement_date >= ' || quote_literal(start_date)::date;
  end if;
  
  if end_date <> '' then
    query_filter := query_filter || ' and batch_settlement_date <= ' || quote_literal(end_date)::date;
  end if;

  if comment_filter <> '' then
    query_filter := query_filter || ' and comment ilike ' || quote_literal('%' || comment_filter || '%');
  end if;

  if bank_account_filter <> '' then
    query_filter := query_filter || ' and (creditor_account_number ilike ' || quote_literal('%' || bank_account_filter || '%') || 
                                    ' or debtor_account_number ilike ' || quote_literal('%' || bank_account_filter || '%') || ')';
  end if;

  if source_bank_filter = 'Banque Misr' then
    query_filter := query_filter || ' and batch_purpose = ' || quote_literal('Banque Misr');
  elsif source_bank_filter = 'CIB' then
    query_filter := query_filter || ' and coalesce(batch_purpose, '''') <> ' || quote_literal('Banque Misr');
  end if;

  -- Run sum and counts
  execute 'select coalesce(sum(transaction_amount), 0), count(*) from transactions where 1=1' || query_filter 
    into total_sum, total_cnt;
    
  execute 'select count(*) from transactions where transaction_status = ''Accepted''' || query_filter 
    into accepted_cnt;
    
  execute 'select count(*) from transactions where transaction_status = ''Rejected''' || query_filter 
    into rejected_cnt;
    
  execute 'select count(*) from transactions where transaction_status = ''Returned''' || query_filter 
    into returned_cnt;

  return json_build_object(
    'totalVolume', total_sum,
    'totalCount', total_cnt,
    'acceptedCount', accepted_cnt,
    'rejectedCount', rejected_cnt,
    'returnedCount', returned_cnt
  );
end;
$body language plpgsql security definer;
