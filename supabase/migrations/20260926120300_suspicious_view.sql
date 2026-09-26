-- Detection for moderation (step 9), read by scripts/flag-suspicious.sql and the tests.
-- One result set because `supabase db query` prints only the last statement's rows.
-- Rows with a session_id go to private.flag_session(), ip-only rows to private.flag_ip().
-- ip_hash rotates daily (daily salt), so every ip_hash row covers a single day.

create view private.suspicious as
with session_wins as (
  select session_id, winner_id, count(*) as wins, sum(count(*)) over (partition by session_id) as total
  from public.duels where not excluded
  group by session_id, winner_id
), ip_wins as (
  select ip_hash, winner_id, count(*) as wins, sum(count(*)) over (partition by ip_hash) as total
  from public.duels where not excluded
  group by ip_hash, winner_id
), windows as (
  -- duels in the 60 s up to and including each duel
  select session_id, count(*) over (
    partition by session_id order by created_at range between interval '60 seconds' preceding and current row) as n
  from public.duels where not excluded
)
-- 1. One entry wins more than 90% of 10+ duels.
select 'bias' as reason, session_id, null::text as ip_hash, total::int as duels,
  format('entry %s wins %s/%s', winner_id, wins, total) as detail
from session_wins
where total >= 10 and wins::numeric / total > 0.9
union all
select 'bias', null, ip_hash, total::int, format('entry %s wins %s/%s', winner_id, wins, total)
from ip_wins
where total >= 10 and wins::numeric / total > 0.9
union all
-- 2. Burst: 20+ duels within 60 s (3 s each or faster; the server cap is 1.5 s).
select 'burst', w.session_id, null, (select count(*)::int from public.duels d where d.session_id = w.session_id and not d.excluded),
  format('%s duels in 60 s', max(w.n))
from windows w
group by w.session_id
having max(w.n) >= 20
union all
-- 3. More than 20 sessions on one ip_hash: cycling sessions past the 300/session limit.
select 'sessions', null, ip_hash, count(*)::int, format('%s sessions', count(distinct session_id))
from public.duels where not excluded
group by ip_hash
having count(distinct session_id) > 20;
