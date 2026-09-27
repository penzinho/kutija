-- Voting tests. Run against the linked project:
--   pnpm dlx supabase db query --linked -f supabase/tests/voting.sql
--
-- Every test is a DO block that ends by raising the 'NM000' sentinel, which its own
-- exception handler catches: all changes the test made are rolled back, whatever the
-- client does with transactions. A failed ASSERT is not caught and aborts the run.
-- Tests clear duels/favorites/tokens inside their block for a clean slate, so they take
-- table locks while running: fine before launch, avoid during live voting.

-- Elo math: equal ratings move by K/2; an upset moves by K * (1 - expected).
do $$
declare
  s uuid := gen_random_uuid();
  r jsonb;
  t uuid;
begin
  delete from public.duels; delete from public.pair_tokens;
  update public.entries set elo = 1500, duels = 0, wins = 0;

  r := public.get_pair(s, 'ip-elo');
  assert r->>'ok' = 'true', format('elo: get_pair failed: %s', r);
  r := public.vote_duel((r->>'token')::uuid, (r->>'a')::int, s, 'ip-elo');
  assert r->>'ok' = 'true', format('elo: vote failed: %s', r);
  assert (select elo from public.entries where id = (r->>'winner')::int) = 1516, 'elo: winner should be 1516';
  assert (select elo from public.entries where id = (r->>'loser')::int) = 1484, 'elo: loser should be 1484';
  assert (select duels = 1 and wins = 1 from public.entries where id = (r->>'winner')::int), 'elo: winner counters';
  assert (select duels = 1 and wins = 0 from public.entries where id = (r->>'loser')::int), 'elo: loser counters';

  -- 1400 beats 1600: expected 0.240253, delta 24.3119
  update public.entries set elo = 1600 where id = 1;
  update public.entries set elo = 1400 where id = 2;
  insert into public.pair_tokens (session_id, a, b) values (s, 1, 2) returning token into t;
  update public.duels set created_at = now() - interval '2 seconds' where session_id = s;
  r := public.vote_duel(t, 2, s, 'ip-elo');
  assert r->>'ok' = 'true', format('elo: upset vote failed: %s', r);
  assert abs((select elo from public.entries where id = 2) - 1424.3119) < 0.001, 'elo: upset winner';
  assert abs((select elo from public.entries where id = 1) - 1575.6881) < 0.001, 'elo: upset loser';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Tokens: replayed, foreign session, expired, winner outside the pair.
do $$
declare
  s uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  r jsonb;
  t uuid;
begin
  delete from public.duels; delete from public.pair_tokens;

  insert into public.pair_tokens (session_id, a, b) values (s, 1, 2) returning token into t;
  r := public.vote_duel(t, 1, other, 'ip-tok');
  assert r->>'code' = 'wrong_session', format('token: expected wrong_session, got %s', r);
  r := public.vote_duel(t, 3, s, 'ip-tok');
  assert r->>'code' = 'invalid_entry', format('token: expected invalid_entry, got %s', r);
  -- neither rejection spent the token
  r := public.vote_duel(t, 1, s, 'ip-tok');
  assert r->>'ok' = 'true', format('token: vote failed: %s', r);
  r := public.vote_duel(t, 1, s, 'ip-tok');
  assert r->>'code' = 'invalid_token', format('token: replay should be invalid_token, got %s', r);
  r := public.vote_duel(gen_random_uuid(), 1, s, 'ip-tok');
  assert r->>'code' = 'invalid_token', format('token: unknown should be invalid_token, got %s', r);

  insert into public.pair_tokens (session_id, a, b, expires_at) values (s, 3, 4, now() - interval '1 second')
  returning token into t;
  r := public.vote_duel(t, 3, s, 'ip-tok');
  assert r->>'code' = 'expired_token', format('token: expected expired_token, got %s', r);
  assert not exists (select 1 from public.pair_tokens where token = t), 'token: expired token should be deleted';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Rate limits: 1 duel per 1.5 s, 50 per session per day, 150 per ip_hash per day,
-- 3 voting sessions per ip_hash per day.
do $$
declare
  s uuid := gen_random_uuid();
  r jsonb;
  t uuid;
begin
  delete from public.duels; delete from public.pair_tokens;

  insert into public.pair_tokens (session_id, a, b) values (s, 1, 2) returning token into t;
  r := public.vote_duel(t, 1, s, 'ip-rate');
  assert r->>'ok' = 'true', format('rate: first vote failed: %s', r);
  insert into public.pair_tokens (session_id, a, b) values (s, 3, 4) returning token into t;
  r := public.vote_duel(t, 3, s, 'ip-rate');
  assert r->>'code' = 'rate_limited', format('rate: expected rate_limited, got %s', r);
  assert (r->>'retry_after')::int between 1 and 2, format('rate: retry_after %s', r);
  -- the token survives the rejection and works once the pause is over
  update public.duels set created_at = now() - interval '2 seconds' where session_id = s;
  r := public.vote_duel(t, 3, s, 'ip-rate');
  assert r->>'ok' = 'true', format('rate: vote after pause failed: %s', r);

  -- session: 49 duels today still vote, 50 don't
  delete from public.duels;
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select s, 'ip-rate', p.a, p.b, now() - interval '2 seconds'
  from (select a.id as a, b.id as b from public.entries a join public.entries b on a.id < b.id
        order by a.id, b.id limit 49) as p;
  r := public.get_pair(s, 'ip-rate');
  assert r->>'ok' = 'true', format('rate: 49 duels should still get a pair, got %s', r);
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  values (s, 'ip-rate', 80, 82, now() - interval '2 seconds');
  r := public.get_pair(s, 'ip-rate');
  assert r->>'code' = 'daily_limit', format('rate: get_pair should hit the session daily_limit, got %s', r);
  insert into public.pair_tokens (session_id, a, b) values (s, 80, 81) returning token into t;
  r := public.vote_duel(t, 80, s, 'ip-rate');
  assert r->>'code' = 'daily_limit', format('rate: vote should hit the session daily_limit, got %s', r);
  assert (r->>'retry_after')::int between 1 and 90000, format('rate: daily retry_after %s', r);

  -- ip_hash: 150 duels today stop every session on it, each under its own limit
  -- (5 sessions: only possible if fresh sessions race past the session count)
  delete from public.duels;
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select ('00000000-0000-0000-0000-00000000000' || (p.i % 5))::uuid, 'ip-busy', p.a, p.b,
    now() - interval '2 seconds'
  from (select a.id as a, b.id as b, row_number() over (order by a.id, b.id) as i
        from public.entries a join public.entries b on a.id < b.id
        order by a.id, b.id limit 149) as p;
  r := public.get_pair('00000000-0000-0000-0000-000000000001', 'ip-busy');
  assert r->>'ok' = 'true', format('rate: 149 duels on an ip should still get a pair, got %s', r);
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  values ('00000000-0000-0000-0000-000000000001', 'ip-busy', 80, 82, now() - interval '2 seconds');
  r := public.get_pair('00000000-0000-0000-0000-000000000001', 'ip-busy');
  assert r->>'code' = 'daily_limit', format('rate: expected ip daily_limit, got %s', r);
  r := public.get_pair(gen_random_uuid(), 'ip-quiet');
  assert r->>'ok' = 'true', format('rate: another ip should still get a pair: %s', r);

  -- sessions: 3 sessions voted on an ip_hash today; a 4th can't, the 3 still can
  delete from public.duels;
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select ('00000000-0000-0000-0000-00000000000' || i)::uuid, 'ip-shared', 1, 2, now() - interval '2 seconds'
  from generate_series(1, 2) as i;
  r := public.get_pair(gen_random_uuid(), 'ip-shared');
  assert r->>'ok' = 'true', format('rate: a 3rd session should get a pair, got %s', r);
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  values ('00000000-0000-0000-0000-000000000003', 'ip-shared', 1, 2, now() - interval '2 seconds');
  r := public.get_pair(gen_random_uuid(), 'ip-shared');
  assert r->>'code' = 'daily_limit', format('rate: a 4th session should hit daily_limit, got %s', r);
  r := public.get_pair('00000000-0000-0000-0000-000000000002', 'ip-shared');
  assert r->>'ok' = 'true', format('rate: a session that already voted keeps voting, got %s', r);
  -- yesterday's sessions don't count
  update public.duels set created_at = private.day_start() - interval '1 hour' where ip_hash = 'ip-shared';
  r := public.get_pair(gen_random_uuid(), 'ip-shared');
  assert r->>'ok' = 'true', format('rate: yesterday''s sessions should not count, got %s', r);

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Duplicate pairs: never re-issued, and rejected if voted anyway.
do $$
declare
  s uuid := gen_random_uuid();
  r jsonb;
  t uuid;
  i int;
begin
  delete from public.duels; delete from public.pair_tokens;

  -- s has judged 1 against every eligible entry except 2 (yesterday, so the 50/day
  -- limit doesn't get in the way; judged pairs are avoided whatever the day)
  insert into public.duels (session_id, ip_hash, winner_id, loser_id, created_at)
  select s, 'ip-dup', 1, id, private.day_start() - interval '1 hour'
  from public.entries where eligible and id not in (1, 2);

  r := public.get_pair(s, 'ip-dup', 1);
  assert r->>'ok' = 'true', format('dup: pinned get_pair failed: %s', r);
  assert least((r->>'a')::int, (r->>'b')::int) = 1 and greatest((r->>'a')::int, (r->>'b')::int) = 2,
    format('dup: only 1 vs 2 is left, got %s', r);
  assert r->>'pinned' = 'true', format('dup: first pin should be honoured, got %s', r);
  -- 1 vs 2 is now held by an open token, and 1 was already shown today: the pin is
  -- ignored and a normal pair comes back
  r := public.get_pair(s, 'ip-dup', 1);
  assert r->>'ok' = 'true' and r->>'pinned' = 'false', format('dup: second pin should fall back, got %s', r);

  -- a hand-made token for a judged pair (either order) is rejected
  insert into public.pair_tokens (session_id, a, b) values (s, 5, 1) returning token into t;
  r := public.vote_duel(t, 5, s, 'ip-dup');
  assert r->>'code' = 'already_judged', format('dup: expected already_judged, got %s', r);

  -- unpinned pairs for a busy session never repeat a judged pair
  for i in 1..30 loop
    r := public.get_pair(s, 'ip-dup');
    assert r->>'ok' = 'true', format('dup: get_pair failed: %s', r);
    assert not exists (
      select 1 from public.duels d where d.session_id = s
        and least(d.winner_id, d.loser_id) = least((r->>'a')::int, (r->>'b')::int)
        and greatest(d.winner_id, d.loser_id) = greatest((r->>'a')::int, (r->>'b')::int)),
      format('dup: judged pair re-issued: %s', r);
  end loop;

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Fair pairs: a pin works once per entry per session-day, an entry is in at most 4 of a
-- session's pairs per day, and at most 100 pairs per session / 300 per ip_hash are issued.
do $$
declare
  s uuid := gen_random_uuid();
  r jsonb;
  t uuid;
  i int;
  seen int;
begin
  delete from public.duels; delete from public.pair_tokens; delete from public.pair_issues;

  -- the pinned-reload attack: pin 71, vote 71, repeat
  r := public.get_pair(s, 'ip-fair', 71);
  assert r->>'ok' = 'true' and r->>'pinned' = 'true' and 71 in ((r->>'a')::int, (r->>'b')::int),
    format('fair: first pin should be honoured, got %s', r);
  r := public.vote_duel((r->>'token')::uuid, 71, s, 'ip-fair');
  assert r->>'ok' = 'true', format('fair: vote failed: %s', r);
  for i in 1..20 loop
    r := public.get_pair(s, 'ip-fair', 71);
    assert r->>'ok' = 'true' and r->>'pinned' = 'false', format('fair: pin %s should be ignored, got %s', i, r);
    if 71 in ((r->>'a')::int, (r->>'b')::int) then
      update public.duels set created_at = now() - interval '2 seconds' where session_id = s;
      r := public.vote_duel((r->>'token')::uuid, 71, s, 'ip-fair');
      assert r->>'ok' = 'true', format('fair: vote failed: %s', r);
    end if;
  end loop;
  assert private.entry_load(s, 71) <= 4, format('fair: 71 in %s pairs today', private.entry_load(s, 71));

  -- skip-fishing: whatever is requested, no entry goes past 4 pairs in a day
  delete from public.duels; delete from public.pair_tokens; delete from public.pair_issues;
  s := gen_random_uuid();
  for i in 1..99 loop
    r := public.get_pair(s, 'ip-fish');
    assert r->>'ok' = 'true', format('fair: pair %s failed: %s', i, r);
    -- vote for the lower id every time, as if fishing for it
    update public.duels set created_at = now() - interval '2 seconds' where session_id = s;
    if (select count(*) from public.duels where session_id = s) < 49 then
      perform public.vote_duel((r->>'token')::uuid, least((r->>'a')::int, (r->>'b')::int), s, 'ip-fish');
    end if;
  end loop;
  select max(n) into seen from (
    select count(*) as n from public.duels d cross join lateral (values (d.winner_id), (d.loser_id)) as v(e)
    where d.session_id = s group by v.e) as x;
  assert seen <= 4, format('fair: an entry was in %s judged duels', seen);

  -- issuance cap: the 100th pair still comes, the 101st doesn't
  r := public.get_pair(s, 'ip-fish');
  assert r->>'ok' = 'true', format('fair: 100th pair should be issued, got %s', r);
  r := public.get_pair(s, 'ip-fish');
  assert r->>'code' = 'daily_limit', format('fair: 101st pair should hit daily_limit, got %s', r);

  -- ip_hash cap: 300 pairs issued on an ip stop even a fresh session
  insert into public.pair_issues (session_id, ip_hash, a, b, pinned)
  select gen_random_uuid(), 'ip-issued', 1, 2, false from generate_series(1, 300);
  r := public.get_pair(gen_random_uuid(), 'ip-issued');
  assert r->>'code' = 'daily_limit', format('fair: ip issuance cap, got %s', r);
  -- yesterday's issues don't count
  update public.pair_issues set created_at = private.day_start() - interval '1 hour' where ip_hash = 'ip-issued';
  r := public.get_pair(gen_random_uuid(), 'ip-issued');
  assert r->>'ok' = 'true', format('fair: yesterday''s issues should not count, got %s', r);

  -- pair_issues is not readable from the API
  assert not has_table_privilege('anon', 'public.pair_issues', 'select'), 'fair: anon can read pair_issues';
  assert not has_table_privilege('authenticated', 'public.pair_issues', 'select'), 'fair: authenticated can read pair_issues';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Excluded entries (56, 87, 88) are never paired, even when they have the fewest duels.
do $$
declare
  r jsonb;
  i int;
begin
  delete from public.duels; delete from public.pair_tokens;
  update public.entries set duels = case when eligible then 100 else 0 end;

  for i in 1..300 loop
    r := public.get_pair(gen_random_uuid(), 'ip-excl');
    assert r->>'ok' = 'true', format('excluded: get_pair failed: %s', r);
    assert (r->>'a')::int not in (56, 87, 88) and (r->>'b')::int not in (56, 87, 88),
      format('excluded: entry paired: %s', r);
    assert r->>'a' <> r->>'b', format('excluded: self pair: %s', r);
  end loop;

  r := public.get_pair(gen_random_uuid(), 'ip-excl-pin', 56);
  assert r->>'code' = 'invalid_entry', format('excluded: pin 56 should be invalid_entry, got %s', r);
  r := public.set_favorite(87, gen_random_uuid(), 'ip-excl-pin');
  assert r->>'code' = 'invalid_entry', format('excluded: favorite 87 should be invalid_entry, got %s', r);

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Favorites: one per session, 3 sessions per ip_hash per day, changing your own is free.
do $$
declare
  s uuid := gen_random_uuid();
  r jsonb;
  i int;
begin
  delete from public.favorites;

  r := public.set_favorite(16, s, 'ip-fav');
  assert r->>'ok' = 'true', format('fav: set failed: %s', r);
  r := public.set_favorite(62, s, 'ip-fav');
  assert r->>'ok' = 'true', format('fav: change failed: %s', r);
  assert (select count(*) from public.favorites where session_id = s) = 1, 'fav: one row per session';
  assert (select entry_id from public.favorites where session_id = s) = 62, 'fav: changed entry';

  for i in 1..2 loop
    r := public.set_favorite(16, gen_random_uuid(), 'ip-fav');
    assert r->>'ok' = 'true', format('fav: session %s of 3 failed: %s', i + 1, r);
  end loop;
  r := public.set_favorite(16, gen_random_uuid(), 'ip-fav');
  assert r->>'code' = 'daily_limit', format('fav: 4th session should hit daily_limit, got %s', r);
  r := public.set_favorite(37, s, 'ip-fav');
  assert r->>'ok' = 'true', format('fav: own change after the limit failed: %s', r);

  r := public.set_favorite(null, s, 'ip-fav');
  assert r->>'ok' = 'true' and not exists (select 1 from public.favorites where session_id = s), 'fav: clear';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- recompute_elo drops excluded duels; leaderboard, stats and snapshots.
do $$
declare
  n int;
begin
  delete from public.duels; delete from public.favorites; delete from public.rank_snapshots;
  update public.entries set elo = 1500, duels = 0, wins = 0;

  insert into public.duels (session_id, ip_hash, winner_id, loser_id, excluded) values
    (gen_random_uuid(), 'ip-rc', 1, 2, true),
    (gen_random_uuid(), 'ip-rc', 3, 1, false);
  insert into public.favorites (session_id, entry_id, ip_hash, excluded) values
    (gen_random_uuid(), 3, 'ip-rc', false),
    (gen_random_uuid(), 3, 'ip-rc', true);

  n := public.recompute_elo();
  assert n = 1, format('recompute: replayed %s duels, expected 1', n);
  assert (select elo from public.entries where id = 3) = 1516, 'recompute: 3 should be 1516';
  assert (select elo from public.entries where id = 1) = 1484, 'recompute: 1 should be 1484';
  assert (select elo = 1500 and duels = 0 from public.entries where id = 2), 'recompute: 2 untouched';

  assert (select count(*) from public.leaderboard) = 85, 'leaderboard: 85 eligible rows';
  assert not exists (select 1 from public.leaderboard where id in (56, 87, 88)), 'leaderboard: excluded rows';
  assert (select array_agg(rank order by rank) from public.leaderboard) = (select array_agg(i) from generate_series(1, 85) i),
    'leaderboard: ranks 1..85';
  assert (select rank = 1 and favorites = 1 and rank_24h is null from public.leaderboard where id = 3),
    'leaderboard: entry 3 first, 1 favorite, no snapshot yet';
  assert (select rank from public.leaderboard where id = 1) = 85, 'leaderboard: entry 1 last';
  assert (select total_duels from public.stats) = 1, 'stats: total_duels';
  assert (select voters_today from public.stats) = 2, 'stats: voters_today';

  perform public.snapshot_ranks();
  assert (select count(*) from public.rank_snapshots) = 85, 'snapshot: 85 rows';
  assert (select rank_24h from public.leaderboard where id = 3) = 1, 'snapshot: rank_24h';

  raise exception using errcode = 'NM000';
exception when sqlstate 'NM000' then null;
end $$;

-- Permissions: clients read only the views and call nothing.
do $$
declare
  fn text;
  tbl text;
begin
  foreach tbl in array array['entries', 'duels', 'favorites', 'pair_tokens', 'rank_snapshots'] loop
    assert not has_table_privilege('anon', 'public.' || tbl, 'select'), format('perm: anon can read %s', tbl);
    assert not has_table_privilege('authenticated', 'public.' || tbl, 'insert'), format('perm: authenticated can write %s', tbl);
  end loop;
  assert has_table_privilege('anon', 'public.leaderboard', 'select'), 'perm: anon cannot read leaderboard';
  assert has_table_privilege('anon', 'public.stats', 'select'), 'perm: anon cannot read stats';
  assert not has_table_privilege('anon', 'public.leaderboard', 'insert'), 'perm: anon can write leaderboard';

  foreach fn in array array['public.get_pair(uuid,text,int)', 'public.vote_duel(uuid,int,uuid,text)',
    'public.set_favorite(int,uuid,text)', 'public.recompute_elo()', 'public.snapshot_ranks()'] loop
    assert not has_function_privilege('anon', fn, 'execute'), format('perm: anon can execute %s', fn);
    assert not has_function_privilege('authenticated', fn, 'execute'), format('perm: authenticated can execute %s', fn);
  end loop;
  assert has_function_privilege('service_role', 'public.vote_duel(uuid,int,uuid,text)', 'execute'),
    'perm: service_role cannot vote';
end $$;

select 'voting tests: all passed' as result;
