-- Moderation tests. Run against the linked project:
--   pnpm dlx supabase db query --linked -f supabase/tests/moderation.sql
--
-- Same DO-block-with-rollback convention as supabase/tests/voting.sql: each block ends
-- by raising the 'NM000' sentinel, caught by its own handler, which rolls back whatever
-- the block did.

-- Bias: an abusive session lifts entry 50 to the top of the leaderboard; it shows up in
-- private.suspicious, flag_session() excludes it, and after recompute_elo() entry 50 is
-- back where it started.
do $$
declare
  abuser uuid := gen_random_uuid();
  clean uuid := gen_random_uuid();
  r jsonb;
begin
  delete from public.duels; delete from public.favorites; delete from public.rank_snapshots;
  update public.entries set elo = 1500, duels = 0, wins = 0;

  -- abuser: entry 50 wins against 19 different opponents, 10 s apart (not a burst)
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select abuser, 'ip-mod-bias', 50, o.id, now() - o.n * interval '10 seconds'
  from (select id, row_number() over (order by id) as n from public.entries where eligible and id <> 50 limit 19) as o;
  insert into public.favorites (session_id, entry_id, ip_hash) values (abuser, 50, 'ip-mod-bias');

  -- clean session: a normal spread of winners, entry 50 never involved
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select clean, 'ip-mod-clean', id, id + 1, now() - id * interval '10 seconds'
  from public.entries where eligible and id < 20;

  perform public.recompute_elo();
  assert (select rank = 1 and favorites = 1 from public.leaderboard where id = 50),
    'moderation: before flagging, the abuser puts entry 50 first with a favorite';

  assert exists (select 1 from private.suspicious where reason = 'bias' and session_id = abuser),
    'moderation: abuser listed as bias';
  assert exists (select 1 from private.suspicious where reason = 'bias' and ip_hash = 'ip-mod-bias'),
    'moderation: abuser ip listed as bias';
  assert not exists (select 1 from private.suspicious where session_id = clean or ip_hash = 'ip-mod-clean'),
    'moderation: clean session not listed';

  r := private.flag_session(abuser);
  assert (r->>'duels_excluded')::int = 19 and (r->>'favorites_excluded')::int = 1,
    format('moderation: expected 19 duels and 1 favorite excluded, got %s', r);
  assert (select bool_and(not excluded) from public.duels where session_id = clean), 'moderation: clean duels untouched';
  r := private.flag_session(abuser);
  assert (r->>'duels_excluded')::int = 0, format('moderation: re-flagging should exclude nothing more, got %s', r);
  assert not exists (select 1 from private.suspicious where session_id = abuser or ip_hash = 'ip-mod-bias'),
    'moderation: flagged rows drop out of the list';

  perform public.recompute_elo();
  assert (select elo = 1500 and duels = 0 and favorites = 0 and rank > 1 from public.leaderboard where id = 50),
    'moderation: after recompute, entry 50 has no trace of the abuser';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Too many sessions on one ip_hash: listed, and flag_ip() excludes them all at once.
do $$
declare
  ip text := 'ip-mod-many';
  r jsonb;
begin
  delete from public.duels;

  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select gen_random_uuid(), ip, 1 + i % 2, 2 - i % 2, now() - i * interval '1 minute' from generate_series(1, 25) as i;
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select gen_random_uuid(), 'ip-mod-few', 1, 2, now() from generate_series(1, 20);

  assert exists (select 1 from private.suspicious where reason = 'sessions' and ip_hash = ip and detail = '25 sessions'),
    'moderation: 25 sessions on one ip listed';
  assert not exists (select 1 from private.suspicious where reason = 'sessions' and ip_hash = 'ip-mod-few'),
    'moderation: 20 sessions on one ip is not listed';

  r := private.flag_ip(ip);
  assert (r->>'duels_excluded')::int = 25, format('moderation: expected 25 duels excluded, got %s', r);
  assert not exists (select 1 from private.suspicious where ip_hash = ip), 'moderation: flagged ip drops out';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Bursts: 25 duels one second apart are listed even inside a long, otherwise slow
-- session; 25 duels ten seconds apart are not.
do $$
declare
  bursty uuid := gen_random_uuid();
  slow uuid := gen_random_uuid();
begin
  delete from public.duels;

  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select bursty, 'ip-mod-burst', 1, i + 2, now() - (25 - i) * interval '1 second' from generate_series(1, 25) as i;
  -- plus 25 slow duels over the previous 10 hours, which would dilute a whole-session average
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select bursty, 'ip-mod-burst', 1, i + 29, now() - i * interval '24 minutes' from generate_series(1, 25) as i;

  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select slow, 'ip-mod-slow', 2, i + 2, now() - i * interval '10 seconds' from generate_series(1, 25) as i;

  assert exists (select 1 from private.suspicious where reason = 'burst' and session_id = bursty and duels = 50),
    'moderation: burst inside a long session listed';
  assert not exists (select 1 from private.suspicious where reason = 'burst' and session_id = slow),
    'moderation: one duel per 10 s is not a burst';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Pinned: an entry that is in 12 of a session's 40 duels and wins them all is listed,
-- even though the session's winners are otherwise spread out; an entry in 12 of 40 that
-- wins about half is not.
do $$
declare
  pinner uuid := gen_random_uuid();
  mixed uuid := gen_random_uuid();
begin
  delete from public.duels;

  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select pinner, 'ip-mod-pin', 71, i + 1, now() - i * interval '10 seconds' from generate_series(1, 12) as i;
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select pinner, 'ip-mod-pin', i + 20, i + 50, now() - (i + 12) * interval '10 seconds' from generate_series(1, 28) as i;

  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select mixed, 'ip-mod-mixed', case when i % 2 = 0 then 71 else i + 1 end, case when i % 2 = 0 then i + 1 else 71 end,
    now() - i * interval '10 seconds' from generate_series(1, 12) as i;
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select mixed, 'ip-mod-mixed', i + 20, i + 50, now() - (i + 12) * interval '10 seconds' from generate_series(1, 28) as i;

  assert exists (select 1 from private.suspicious where reason = 'pinned' and session_id = pinner and duels = 40),
    'moderation: pinned session listed';
  assert not exists (select 1 from private.suspicious where session_id = pinner and reason = 'bias'),
    'moderation: pinned session is not a plain bias case';
  assert not exists (select 1 from private.suspicious where session_id = mixed),
    'moderation: an often-seen entry with mixed results is not listed';

  perform private.flag_session(pinner);
  assert not exists (select 1 from private.suspicious where session_id = pinner), 'moderation: flagged pinner drops out';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Detection and flagging stay out of the API.
do $$
begin
  assert not has_table_privilege('anon', 'private.suspicious', 'select'), 'perm: anon can read private.suspicious';
  assert not has_function_privilege('anon', 'private.flag_session(uuid)', 'execute')
    or not has_schema_privilege('anon', 'private', 'usage'), 'perm: anon can flag sessions';
  assert not has_schema_privilege('authenticated', 'private', 'usage'), 'perm: authenticated can use private';
end $$;

select 'moderation tests: all passed' as result;
