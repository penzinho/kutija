-- Fair pairs: after the pinned-duel abuse of 26–27 Sep, a session can no longer choose
-- what it votes on.
--
--   * Pin (`/dvoboj?a=id`) is honoured only for an entry this session has not seen yet
--     today (no duel, no open token). Otherwise get_pair ignores it and returns a normal
--     pair with `pinned: false`, so reloading the link no longer pins again.
--   * Each entry can appear in at most 4 of a session's pairs per day (duels + open
--     tokens). Skipping pairs until a chosen entry shows up gains at most 4 votes.
--   * Every issued pair is logged (public.pair_issues); at most 100 pairs per session and
--     300 per ip_hash per day, which bounds skip-fishing and scripted pair requests.
--   * get_pair takes the per-session lock, so parallel requests can't race the caps.
--   * Favorites: at most 3 sessions per ip_hash per day (was 5), same as duels.
--   * private.suspicious gets a 'pinned' reason: in one session-day an entry is in 10+
--     duels, at least 3x what random pairing gives, and wins (or loses) 90%+ of them.

create table public.pair_issues (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  ip_hash text not null,
  a int not null,
  b int not null,
  pinned boolean not null,
  created_at timestamptz not null default now()
);
create index pair_issues_session_created_idx on public.pair_issues (session_id, created_at);
create index pair_issues_ip_created_idx on public.pair_issues (ip_hash, created_at);
alter table public.pair_issues enable row level security;
revoke all on public.pair_issues from anon, authenticated;

-- How many of today's pairs (judged, or held by an open token) entry p_entry is in.
create function private.entry_load(p_session uuid, p_entry int) returns int
language sql stable set search_path = '' as $$
  select (
    (select count(*) from public.duels
     where session_id = p_session and created_at >= private.day_start()
       and p_entry in (winner_id, loser_id))
    + (select count(*) from public.pair_tokens
       where session_id = p_session and expires_at >= now() and p_entry in (a, b))
  )::int
$$;

-- B for a given A: as before (random among the 14 nearest by Elo, no judged or held
-- pair), and now also skipping entries at the per-session daily cap.
create or replace function private.pick_partner(p_session uuid, p_a int) returns int
language sql volatile set search_path = '' as $$
  select near.id from (
    select e.id
    from public.entries e
    where e.eligible
      and e.id <> p_a
      and private.entry_load(p_session, e.id) < 4
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

create or replace function public.get_pair(p_session uuid, p_ip_hash text, p_pin int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit jsonb;
  v_a int;
  v_b int;
  v_pinned boolean := false;
  v_token public.pair_tokens;
begin
  -- Serialize with this session's votes and other pair requests, so the caps hold.
  perform pg_advisory_xact_lock(hashtextextended(p_session::text, 0));

  -- Only the daily limits: the client prefetches the next pair right after voting.
  v_limit := private.check_daily_limits(p_session, p_ip_hash);
  if v_limit is not null then
    return v_limit;
  end if;
  if (select count(*) from public.pair_issues
      where session_id = p_session and created_at >= private.day_start()) >= 100
     or (select count(*) from public.pair_issues
         where ip_hash = p_ip_hash and created_at >= private.day_start()) >= 300 then
    return private.error('daily_limit', private.seconds_until_tomorrow());
  end if;

  -- Drop expired tokens and keep at most 4 open ones (current + prefetched + slack).
  delete from public.pair_tokens where session_id = p_session and expires_at < now();
  delete from public.pair_tokens where token in (
    select token from public.pair_tokens where session_id = p_session order by expires_at desc offset 4);

  if p_pin is not null then
    if not exists (select 1 from public.entries where id = p_pin and eligible) then
      return private.error('invalid_entry');
    end if;
    -- A pin only counts for an entry this session hasn't met yet today.
    if private.entry_load(p_session, p_pin) = 0 then
      v_b := private.pick_partner(p_session, p_pin);
      if v_b is not null then
        v_a := p_pin;
        v_pinned := true;
      end if;
    end if;
  end if;

  if v_b is null then
    -- A: weighted random sample (Efraimidis–Spirakis) with weight 1 / (1 + duels above
    -- the minimum), so the least-seen entries come up most often.
    for v_a in
      select id from public.entries
      where eligible and private.entry_load(p_session, id) < 4
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
  insert into public.pair_issues (session_id, ip_hash, a, b, pinned)
  values (p_session, p_ip_hash, v_a, v_b, v_pinned);

  return jsonb_build_object('ok', true, 'token', v_token.token, 'a', v_token.a, 'b', v_token.b,
    'expires_at', v_token.expires_at, 'pinned', v_pinned);
end;
$$;

create or replace function public.set_favorite(p_entry int, p_session uuid, p_ip_hash text) returns jsonb
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
      where ip_hash = p_ip_hash and updated_at >= private.day_start() and session_id <> p_session) >= 3 then
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

-- Same columns as before, plus the 'pinned' reason at the end.
create or replace view private.suspicious as
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
), session_days as (
  -- each duel once per side, bucketed by Zagreb day
  select d.session_id, (d.created_at at time zone 'Europe/Zagreb')::date as day, s.entry_id, s.won,
    count(*) over (partition by d.session_id, (d.created_at at time zone 'Europe/Zagreb')::date) / 2 as day_duels
  from public.duels d
  cross join lateral (values (d.winner_id, true), (d.loser_id, false)) as s(entry_id, won)
  where not d.excluded
), entry_days as (
  select session_id, day, entry_id, count(*) as k, count(*) filter (where won) as wins, max(day_duels) as day_duels
  from session_days
  group by session_id, day, entry_id
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
having count(distinct session_id) > 20
union all
-- 4. Pinned: on one day an entry is in 10+ of the session's duels, 3x or more what random
-- pairing gives (2 of 85 entries per duel), and it wins or loses 90%+ of them.
select 'pinned', session_id, null, day_duels::int,
  format('%s: entry %s in %s of %s duels, wins %s', day, entry_id, k, day_duels, wins)
from entry_days
where k >= 10 and k >= 3 * 2 * day_duels / 85.0
  and (wins::numeric / k >= 0.9 or wins::numeric / k <= 0.1);
