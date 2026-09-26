-- Narodni Maksimir: voting schema.
--
-- Access model:
--   * Clients (anon / authenticated) may only SELECT the `leaderboard` and `stats` views.
--   * Every write goes through the SECURITY DEFINER functions in `public`, which only
--     service_role (the `vote` Edge Function) may execute. The Edge Function passes the
--     verified session id (anonymous auth user id) and the salted ip_hash.
--   * Helpers live in `private`, which is not exposed through the API.
--
-- Functions return jsonb: { ok: true, ... } or { ok: false, code, retry_after? }.
-- Error codes: rate_limited, daily_limit, invalid_token, expired_token, wrong_session,
-- invalid_entry, already_judged, no_pair. retry_after is in whole seconds.

create schema private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.entries (
  id int primary key check (id between 1 and 88),
  -- false for entries the jury did not accept (56, 87, 88): never paired, never ranked.
  eligible boolean not null default true,
  elo double precision not null default 1500,
  duels int not null default 0,
  wins int not null default 0
);

insert into public.entries (id, eligible)
select i, i not in (56, 87, 88) from generate_series(1, 88) as i;

create table public.duels (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  ip_hash text not null,
  winner_id int not null references public.entries,
  loser_id int not null references public.entries,
  -- set by moderation; excluded duels drop out after recompute_elo()
  excluded boolean not null default false,
  created_at timestamptz not null default now(),
  check (winner_id <> loser_id)
);

-- A session judges each pair at most once, in either order.
create unique index duels_session_pair_key
  on public.duels (session_id, least(winner_id, loser_id), greatest(winner_id, loser_id));
create index duels_session_created_idx on public.duels (session_id, created_at);
create index duels_ip_created_idx on public.duels (ip_hash, created_at);
create index duels_created_idx on public.duels (created_at);

create table public.favorites (
  session_id uuid primary key,
  entry_id int not null references public.entries,
  ip_hash text not null,
  excluded boolean not null default false,
  updated_at timestamptz not null default now()
);

create index favorites_entry_idx on public.favorites (entry_id);
create index favorites_ip_updated_idx on public.favorites (ip_hash, updated_at);

-- Votes only count for pairs the server handed out.
create table public.pair_tokens (
  token uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  a int not null references public.entries,
  b int not null references public.entries,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create index pair_tokens_session_idx on public.pair_tokens (session_id);
create index pair_tokens_expires_idx on public.pair_tokens (expires_at);

-- Daily rank snapshot for the 24h delta (D10).
create table public.rank_snapshots (
  taken_on date not null,
  entry_id int not null references public.entries,
  rank int not null,
  primary key (taken_on, entry_id)
);

alter table public.entries enable row level security;
alter table public.duels enable row level security;
alter table public.favorites enable row level security;
alter table public.pair_tokens enable row level security;
alter table public.rank_snapshots enable row level security;

-- No policies: RLS denies everything. Revoke the Supabase default grants as well.
revoke all on public.entries, public.duels, public.favorites, public.pair_tokens, public.rank_snapshots
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (private)
-- ---------------------------------------------------------------------------

-- Daily limits reset at midnight in Zagreb.
create function private.day_start() returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc('day', now() at time zone 'Europe/Zagreb') at time zone 'Europe/Zagreb'
$$;

create function private.seconds_until_tomorrow() returns int
language sql stable set search_path = '' as $$
  select ceil(extract(epoch from
    ((date_trunc('day', now() at time zone 'Europe/Zagreb') + interval '1 day') at time zone 'Europe/Zagreb') - now()
  ))::int
$$;

create function private.error(p_code text, p_retry_after int default null) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('ok', false, 'code', p_code, 'retry_after', p_retry_after))
$$;

-- 300 duels per session and 1000 per ip_hash per day.
create function private.check_daily_limits(p_session uuid, p_ip_hash text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_since constant timestamptz := private.day_start();
begin
  if (select count(*) from public.duels where session_id = p_session and created_at >= v_since) >= 300
     or (select count(*) from public.duels where ip_hash = p_ip_hash and created_at >= v_since) >= 1000 then
    return private.error('daily_limit', private.seconds_until_tomorrow());
  end if;
  return null;
end;
$$;

-- Daily limits plus at most one duel per 1.5 s per session.
create function private.check_duel_limits(p_session uuid, p_ip_hash text) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_last timestamptz;
begin
  select max(created_at) into v_last from public.duels where session_id = p_session;
  if v_last is not null and now() < v_last + interval '1.5 seconds' then
    return private.error('rate_limited',
      greatest(1, ceil(extract(epoch from v_last + interval '1.5 seconds' - now())))::int);
  end if;
  return private.check_daily_limits(p_session, p_ip_hash);
end;
$$;

-- Elo update, K = 32. The caller must hold row locks on both entries.
create function private.apply_duel(p_winner int, p_loser int) returns double precision
language plpgsql set search_path = '' as $$
declare
  v_winner_elo double precision;
  v_loser_elo double precision;
  v_delta double precision;
begin
  select elo into v_winner_elo from public.entries where id = p_winner;
  select elo into v_loser_elo from public.entries where id = p_loser;
  -- winner gains K * (1 - expected score); the loser loses the same amount
  v_delta := 32 * (1 - 1 / (1 + power(10, (v_loser_elo - v_winner_elo) / 400)));
  update public.entries set elo = elo + v_delta, duels = duels + 1, wins = wins + 1 where id = p_winner;
  update public.entries set elo = elo - v_delta, duels = duels + 1 where id = p_loser;
  return v_delta;
end;
$$;

-- B for a given A (D6): random among the 14 nearest by Elo, skipping pairs this
-- session already judged or currently holds a token for.
create function private.pick_partner(p_session uuid, p_a int) returns int
language sql volatile set search_path = '' as $$
  select near.id from (
    select e.id
    from public.entries e
    where e.eligible
      and e.id <> p_a
      and not exists (
        select 1 from public.duels d
        where d.session_id = p_session
          and least(d.winner_id, d.loser_id) = least(p_a, e.id)
          and greatest(d.winner_id, d.loser_id) = greatest(p_a, e.id))
      and not exists (
        select 1 from public.pair_tokens t
        where t.session_id = p_session
          and least(t.a, t.b) = least(p_a, e.id)
          and greatest(t.a, t.b) = greatest(p_a, e.id))
    order by abs(e.elo - (select elo from public.entries where id = p_a))
    limit 14
  ) as near
  order by random()
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- API (service_role only)
-- ---------------------------------------------------------------------------

-- Issues a pair token. p_pin fixes one side (/dvoboj?a=id).
create function public.get_pair(p_session uuid, p_ip_hash text, p_pin int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit jsonb;
  v_a int;
  v_b int;
  v_token public.pair_tokens;
begin
  -- Only the daily limits: the client prefetches the next pair right after voting.
  v_limit := private.check_daily_limits(p_session, p_ip_hash);
  if v_limit is not null then
    return v_limit;
  end if;

  -- Drop expired tokens and keep at most 4 open ones (current + prefetched + slack).
  delete from public.pair_tokens where session_id = p_session and expires_at < now();
  delete from public.pair_tokens where token in (
    select token from public.pair_tokens where session_id = p_session order by expires_at desc offset 4);

  if p_pin is not null then
    if not exists (select 1 from public.entries where id = p_pin and eligible) then
      return private.error('invalid_entry');
    end if;
    v_a := p_pin;
    v_b := private.pick_partner(p_session, v_a);
  else
    -- A: weighted random sample (Efraimidis–Spirakis) with weight 1 / (1 + duels above
    -- the minimum), so the least-seen entries come up most often.
    for v_a in
      select id from public.entries
      where eligible
      order by power(random(), 1 + duels - min(duels) over ()) desc
      limit 10
    loop
      v_b := private.pick_partner(p_session, v_a);
      exit when v_b is not null;
    end loop;
  end if;

  if v_b is null then
    return private.error('no_pair');
  end if;

  -- Random sides, so the pinned or least-seen entry is not always on the left.
  if random() < 0.5 then
    select v_b, v_a into v_a, v_b;
  end if;

  insert into public.pair_tokens (session_id, a, b)
  values (p_session, v_a, v_b)
  returning * into v_token;

  return jsonb_build_object('ok', true, 'token', v_token.token, 'a', v_token.a, 'b', v_token.b,
    'expires_at', v_token.expires_at);
end;
$$;

create function public.vote_duel(p_token uuid, p_winner int, p_session uuid, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_token public.pair_tokens;
  v_loser int;
  v_limit jsonb;
  v_delta double precision;
begin
  -- Serialize votes per session so the rate limits can't be raced.
  perform pg_advisory_xact_lock(hashtextextended(p_session::text, 0));

  select * into v_token from public.pair_tokens where token = p_token;
  if not found then
    return private.error('invalid_token');
  end if;
  if v_token.session_id <> p_session then
    return private.error('wrong_session');
  end if;
  if v_token.expires_at < now() then
    delete from public.pair_tokens where token = p_token;
    return private.error('expired_token');
  end if;
  if p_winner is null or p_winner not in (v_token.a, v_token.b) then
    return private.error('invalid_entry');
  end if;

  -- Checked before the token is spent, so the client can retry after the countdown.
  v_limit := private.check_duel_limits(p_session, p_ip_hash);
  if v_limit is not null then
    return v_limit;
  end if;

  delete from public.pair_tokens where token = p_token;
  v_loser := case when p_winner = v_token.a then v_token.b else v_token.a end;

  -- Lock both entries in id order to avoid deadlocks between concurrent votes.
  perform 1 from public.entries where id in (v_token.a, v_token.b) order by id for update;
  if (select count(*) from public.entries where id in (v_token.a, v_token.b) and eligible) <> 2 then
    return private.error('invalid_entry');
  end if;

  begin
    insert into public.duels (session_id, ip_hash, winner_id, loser_id)
    values (p_session, p_ip_hash, p_winner, v_loser);
  exception when unique_violation then
    return private.error('already_judged');
  end;

  v_delta := private.apply_duel(p_winner, v_loser);
  return jsonb_build_object('ok', true, 'winner', p_winner, 'loser', v_loser, 'delta', round(v_delta::numeric, 2));
end;
$$;

-- One favorite per session; p_entry null clears it. At most 5 sessions per ip_hash
-- may set a favorite per day; a session changing its own favorite doesn't count again.
create function public.set_favorite(p_entry int, p_session uuid, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session::text, 0));

  if p_entry is null then
    delete from public.favorites where session_id = p_session;
    return jsonb_build_object('ok', true, 'entry', null);
  end if;

  if not exists (select 1 from public.entries where id = p_entry and eligible) then
    return private.error('invalid_entry');
  end if;

  if (select count(*) from public.favorites
      where ip_hash = p_ip_hash and updated_at >= private.day_start() and session_id <> p_session) >= 5 then
    return private.error('daily_limit', private.seconds_until_tomorrow());
  end if;

  -- A flagged session stays excluded when it changes its favorite.
  insert into public.favorites (session_id, entry_id, ip_hash)
  values (p_session, p_entry, p_ip_hash)
  on conflict (session_id) do update
    set entry_id = excluded.entry_id, ip_hash = excluded.ip_hash, updated_at = now();

  return jsonb_build_object('ok', true, 'entry', p_entry);
end;
$$;

-- Replays all non-excluded duels in order (after moderation). Returns the number replayed.
create function public.recompute_elo() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_duel record;
  v_count int := 0;
begin
  -- Blocks concurrent votes (they take row locks on entries) until the replay commits.
  lock table public.entries in exclusive mode;
  update public.entries set elo = 1500, duels = 0, wins = 0;
  for v_duel in select winner_id, loser_id from public.duels where not excluded order by id loop
    perform private.apply_duel(v_duel.winner_id, v_duel.loser_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Views (the only thing clients can read)
-- ---------------------------------------------------------------------------

-- These run with the owner's rights (not security_invoker) on purpose: they expose
-- aggregates of tables that clients cannot read directly.
create view public.leaderboard as
with ranked as (
  select id, elo, duels, wins, row_number() over (order by elo desc, wins desc, id) as rank
  from public.entries
  where eligible
)
select
  r.id,
  round(r.elo)::int as elo,
  r.rank::int as rank,
  s.rank as rank_24h,
  r.duels,
  r.wins,
  (select count(*) from public.favorites f where f.entry_id = r.id and not f.excluded)::int as favorites
from ranked r
left join public.rank_snapshots s
  on s.entry_id = r.id and s.taken_on = (select max(taken_on) from public.rank_snapshots)
order by r.rank;

create view public.stats as
select
  -- every duel counts for two entries
  (select coalesce(sum(duels), 0) / 2 from public.entries)::bigint as total_duels,
  (select count(distinct session_id) from public.duels
   where created_at >= date_trunc('day', now() at time zone 'Europe/Zagreb') at time zone 'Europe/Zagreb'
  )::int as voters_today;

-- Daily job (see the cron migration): snapshot ranks and drop expired tokens.
create function public.snapshot_ranks() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rank_snapshots (taken_on, entry_id, rank)
  select (now() at time zone 'Europe/Zagreb')::date, id, rank from public.leaderboard
  on conflict (taken_on, entry_id) do update set rank = excluded.rank;
  delete from public.rank_snapshots where taken_on < (now() at time zone 'Europe/Zagreb')::date - 30;
  delete from public.pair_tokens where expires_at < now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.leaderboard, public.stats from anon, authenticated;
grant select on public.leaderboard, public.stats to anon, authenticated;

revoke execute on function
  public.get_pair(uuid, text, int),
  public.vote_duel(uuid, int, uuid, text),
  public.set_favorite(int, uuid, text),
  public.recompute_elo(),
  public.snapshot_ranks()
from public, anon, authenticated;

grant execute on function
  public.get_pair(uuid, text, int),
  public.vote_duel(uuid, int, uuid, text),
  public.set_favorite(int, uuid, text)
to service_role;
