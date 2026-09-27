-- No repeated pairs: a skipped pair's token stays open only until newer tokens push it
-- out (4 kept), after which the same pair could be issued again. With B now picked by
-- fewest duels (20260927130000) a skip could keep bringing back the same pair. Count
-- today's issued pairs (public.pair_issues) instead of open tokens:
--
--   * an entry's daily load is the larger of its issued pairs and its duels + open tokens
--     (the second covers duels from before pair_issues existed), so skipped pairs count
--     toward the 4-per-entry cap too;
--   * pick_partner never returns a pair already issued to this session today.

create or replace function private.entry_load(p_session uuid, p_entry int) returns int
language sql stable set search_path = '' as $$
  select greatest(
    (select count(*) from public.pair_issues
     where session_id = p_session and created_at >= private.day_start()
       and p_entry in (a, b)),
    (select count(*) from public.duels
     where session_id = p_session and created_at >= private.day_start()
       and p_entry in (winner_id, loser_id))
    + (select count(*) from public.pair_tokens
       where session_id = p_session and expires_at >= now() and p_entry in (a, b))
  )::int
$$;

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
      and not exists (
        select 1 from public.pair_issues i
        where i.session_id = p_session and i.created_at >= private.day_start()
          and least(i.a, i.b) = least(p_a, e.id)
          and greatest(i.a, i.b) = greatest(p_a, e.id))
    order by abs(e.elo - (select elo from public.entries where id = p_a))
    limit 14
  ) as near
  order by near.duels + random() * 20
  limit 1
$$;
