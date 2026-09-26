-- Limits tightened again: at most 3 sessions per ip_hash may vote per day, 50 duels
-- each. The 150 per ip_hash cap is what 3 x 50 allows; it stays as a backstop because
-- two fresh sessions voting at the same instant can both pass the session count.

create or replace function private.check_daily_limits(p_session uuid, p_ip_hash text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_since constant timestamptz := private.day_start();
begin
  if (select count(*) from public.duels where session_id = p_session and created_at >= v_since) >= 50
     or (select count(*) from public.duels where ip_hash = p_ip_hash and created_at >= v_since) >= 150
     or (not exists (
           select 1 from public.duels
           where ip_hash = p_ip_hash and session_id = p_session and created_at >= v_since)
         and (select count(distinct session_id) from public.duels
              where ip_hash = p_ip_hash and created_at >= v_since) >= 3) then
    return private.error('daily_limit', private.seconds_until_tomorrow());
  end if;
  return null;
end;
$$;
