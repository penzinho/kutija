-- Balance duels: after moderation excluded suspicious sessions, some entries sit far
-- below the rest in duel count (e.g. 96 vs ~190). Push the ones behind until everyone is
-- roughly level, then keep pairing near-evenly.
--
--   * A: order by duels + random() * 20. An entry more than 20 duels behind always comes
--     before the rest; within a 20-duel band the order is random. The old weight
--     (1 + duels - min) only boosted the single lowest entry.
--   * B: still among the 14 nearest by Elo, but the one with the fewest duels (same
--     20-duel random band) instead of a uniform pick, so the laggards catch up from both
--     sides of a pair.
--   * Per-session caps (4 pairs per entry per day, no repeated pair) are unchanged, so a
--     session still can't farm one entry.

create or replace function private.pick_partner(p_session uuid, p_a int) returns int
language sql volatile set search_path = '' as $$
  select near.id from (
    select e.id, e.duels
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
  order by near.duels + random() * 20
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
    -- A: fewest duels first; entries within 20 duels of each other come up in random order.
    for v_a in
      select id from public.entries
      where eligible and private.entry_load(p_session, id) < 4
      order by duels + random() * 20
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
