-- Moderation: find suspicious sessions/IP hashes and exclude their votes.
--
-- Run the detection queries below, decide what's actually abuse, then flag it by hand:
--   pnpm dlx supabase db query --linked -f scripts/flag-suspicious.sql
--
-- The helpers (private.flag_session, private.flag_ip; defined in
-- supabase/migrations/20260926120200_moderation.sql) only set excluded = true; nothing
-- is deleted and Elo doesn't change until you replay it:
--   select public.recompute_elo();
-- Run recompute_elo() once, after flagging everything you found in this pass.

-- ---------------------------------------------------------------------------
-- 1. One entry wins almost every vote a session casts (voting for a favorite, not
--    judging pairs). 10+ duels, one winner_id in more than 90% of them.
-- ---------------------------------------------------------------------------

with per_winner as (
  select session_id, winner_id, count(*) as wins
  from public.duels
  where not excluded
  group by session_id, winner_id
), totals as (
  select session_id, sum(wins) as total from per_winner group by session_id
)
select p.session_id, t.total as total_duels, p.winner_id as top_entry, p.wins as top_entry_wins,
       round(p.wins::numeric / t.total, 3) as top_entry_share
from per_winner p
join totals t using (session_id)
where t.total >= 10 and p.wins::numeric / t.total > 0.9
order by t.total desc;

-- Same bias, aggregated by ip_hash: catches the pattern spread across a handful of
-- sessions from the same visitor.
with per_winner as (
  select ip_hash, winner_id, count(*) as wins
  from public.duels
  where not excluded
  group by ip_hash, winner_id
), totals as (
  select ip_hash, sum(wins) as total from per_winner group by ip_hash
)
select p.ip_hash, t.total as total_duels, p.winner_id as top_entry, p.wins as top_entry_wins,
       round(p.wins::numeric / t.total, 3) as top_entry_share
from per_winner p
join totals t using (ip_hash)
where t.total >= 10 and p.wins::numeric / t.total > 0.9
order by t.total desc;

-- ---------------------------------------------------------------------------
-- 2. Bursts: far more duels than someone actually looking at both entries could
--    sustain. 20+ duels averaging faster than one every 3 seconds (the server caps a
--    session at one every 1.5 s, so this is a session running close to that cap for a
--    long stretch).
-- ---------------------------------------------------------------------------

select
  session_id,
  count(*) as total_duels,
  min(created_at) as first_duel,
  max(created_at) as last_duel,
  round(count(*) / greatest(extract(epoch from max(created_at) - min(created_at)) / 60, 0.01), 1) as duels_per_minute
from public.duels
where not excluded
group by session_id
having count(*) >= 20
   and count(*) / greatest(extract(epoch from max(created_at) - min(created_at)) / 60, 0.01) > 20
order by duels_per_minute desc;

-- ---------------------------------------------------------------------------
-- 3. Too many sessions from one IP: a visitor cycling through anonymous sessions to
--    dodge the 300-duels-per-session daily limit (the ip_hash limit is a looser
--    1000/day, so this pattern can otherwise slip through).
-- ---------------------------------------------------------------------------

select ip_hash, count(distinct session_id) as sessions, count(*) as total_duels
from public.duels
where not excluded
group by ip_hash
having count(distinct session_id) > 20
order by sessions desc;

-- ---------------------------------------------------------------------------
-- Flagging: review the rows above, then exclude what's actually abuse.
--
--   select private.flag_session('<session_id>');   -- excludes its duels and favorite
--   select private.flag_ip('<ip_hash>');            -- excludes every session on that IP
--
-- Both are idempotent (already-excluded rows are left alone) and return the counts they
-- touched. When you're done flagging for this pass:
--
--   select public.recompute_elo();
-- ---------------------------------------------------------------------------
