-- Tighter daily limits after the first day of abuse (5500 duels from ~150 visitors).
--
--   * 100 duels per session per day (was 300)
--   * 200 duels per ip_hash per day (was 1000)
--   * at most 5 sessions per ip_hash may vote per day: a 6th fresh anonymous session
--     on the same ip_hash gets daily_limit, so clearing storage no longer resets the cap.
--     Sessions that already voted today on that ip_hash keep voting up to their own limit.
--
-- All three return daily_limit with retry_after until midnight in Zagreb, which the
-- client already handles. Only this helper changes; get_pair and vote_duel call it.

create or replace function private.check_daily_limits(p_session uuid, p_ip_hash text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_since constant timestamptz := private.day_start();
begin
  if (select count(*) from public.duels where session_id = p_session and created_at >= v_since) >= 100
     or (select count(*) from public.duels where ip_hash = p_ip_hash and created_at >= v_since) >= 200
     or (not exists (
           select 1 from public.duels
           where ip_hash = p_ip_hash and session_id = p_session and created_at >= v_since)
         and (select count(distinct session_id) from public.duels
              where ip_hash = p_ip_hash and created_at >= v_since) >= 5) then
    return private.error('daily_limit', private.seconds_until_tomorrow());
  end if;
  return null;
end;
$$;
