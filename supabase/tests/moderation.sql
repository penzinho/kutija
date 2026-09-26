-- Moderation tests. Run against the linked project:
--   pnpm dlx supabase db query --linked -f supabase/tests/moderation.sql
--
-- Same DO-block-with-rollback convention as supabase/tests/voting.sql: each block ends
-- by raising the 'NM000' sentinel, caught by its own handler, which rolls back whatever
-- the block did.

-- Single-entry bias: a session that always votes the same winner is flagged by the
-- detection query, private.flag_session() excludes its rows, and recompute_elo() undoes
-- its effect on the winner's Elo.
do $$
declare
  abuser uuid := gen_random_uuid();
  clean uuid := gen_random_uuid();
  r jsonb;
  flagged int;
begin
  delete from public.duels; delete from public.favorites; delete from public.rank_snapshots;
  update public.entries set elo = 1500, duels = 0, wins = 0;

  -- abuser: entry 50 "wins" against 19 different opponents, unanimously
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select abuser, 'ip-mod-bias', 50, e.id, now() - interval '1 minute'
  from public.entries e where e.eligible and e.id <> 50 limit 19;

  -- clean session: a normal spread of winners, entry 50 never involved
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select clean, 'ip-mod-clean', e.id, e.id + 1, now() - interval '1 minute'
  from public.entries e where e.eligible and e.id < 20;

  -- the bias query (scripts/flag-suspicious.sql, part 1) should flag the abuser only
  with per_winner as (
    select session_id, winner_id, count(*) as wins
    from public.duels where not excluded group by session_id, winner_id
  ), totals as (
    select session_id, sum(wins) as total from per_winner group by session_id
  )
  select count(*) into flagged from per_winner p join totals t using (session_id)
  where t.total >= 10 and p.wins::numeric / t.total > 0.9 and p.session_id = abuser;
  assert flagged = 1, 'moderation: bias query should flag the abuser';

  with per_winner as (
    select session_id, winner_id, count(*) as wins
    from public.duels where not excluded group by session_id, winner_id
  ), totals as (
    select session_id, sum(wins) as total from per_winner group by session_id
  )
  select count(*) into flagged from per_winner p join totals t using (session_id)
  where t.total >= 10 and p.wins::numeric / t.total > 0.9 and p.session_id = clean;
  assert flagged = 0, 'moderation: bias query should not flag the clean session';

  r := private.flag_session(abuser);
  assert (r->>'duels_excluded')::int = 19, format('moderation: expected 19 duels excluded, got %s', r);
  assert (r->>'favorites_excluded')::int = 0, format('moderation: expected 0 favorites excluded, got %s', r);
  assert (select bool_and(excluded) from public.duels where session_id = abuser), 'moderation: abuser duels excluded';
  assert (select bool_and(not excluded) from public.duels where session_id = clean), 'moderation: clean duels untouched';

  -- calling it again touches nothing (idempotent)
  r := private.flag_session(abuser);
  assert (r->>'duels_excluded')::int = 0, format('moderation: re-flagging should exclude nothing more, got %s', r);

  perform public.recompute_elo();
  assert (select elo = 1500 and duels = 0 and wins = 0 from public.entries where id = 50),
    'moderation: entry 50 untouched once the abuser is excluded';
  assert not exists (select 1 from public.leaderboard where id = 50 and elo <> 1500), 'moderation: leaderboard reflects it';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Too many sessions on one IP: the detection query flags it, and private.flag_ip()
-- excludes every one of those sessions' duels in one call.
do $$
declare
  ip text := 'ip-mod-many';
  r jsonb;
  sessions int;
begin
  delete from public.duels where ip_hash = ip;

  -- 25 distinct sessions from the same ip_hash, one duel each
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select gen_random_uuid(), ip, 1, 2, now() - interval '1 minute' from generate_series(1, 25);

  select count(distinct session_id) into sessions
  from public.duels where ip_hash = ip and not excluded
  having count(distinct session_id) > 20;
  assert sessions = 25, format('moderation: too-many-sessions query should flag %s, found %s', ip, sessions);

  r := private.flag_ip(ip);
  assert (r->>'duels_excluded')::int = 25, format('moderation: expected 25 duels excluded, got %s', r);
  assert (select bool_and(excluded) from public.duels where ip_hash = ip), 'moderation: all sessions on the ip excluded';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Bursts: a session voting far faster than a real visitor is surfaced by the rate query.
do $$
declare
  bursty uuid := gen_random_uuid();
  flagged int;
begin
  delete from public.duels where session_id = bursty;

  -- 25 duels one second apart: 62.5/min, well past the 20/min threshold
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select bursty, 'ip-mod-burst', 1, i + 2, now() - (25 - i) * interval '1 second'
  from generate_series(1, 25) as i;

  select count(*) into flagged from (
    select session_id
    from public.duels where not excluded and session_id = bursty
    group by session_id
    having count(*) >= 20
       and count(*) / greatest(extract(epoch from max(created_at) - min(created_at)) / 60, 0.01) > 20
  ) as bursts;
  assert flagged = 1, 'moderation: burst query should flag the bursty session';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

select 'moderation tests: all passed' as result;
