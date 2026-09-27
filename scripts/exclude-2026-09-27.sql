-- Moderation pass of 27 Sep 2026: exclude the sessions that pinned one entry
-- (`/dvoboj?a=id`, reloaded) or fished for it, and replay Elo without them.
-- Run once, after migration 20260927120000_fair_pairs.sql:
--
--   pnpm dlx supabase db query --linked -f scripts/exclude-2026-09-27.sql
--
-- Each session matched 'bias' and/or 'pinned' in private.suspicious (entry, duels with
-- it / session-day duels, wins):
--   159ffa67  71: 12/12 + 38/38, won all       f5780034  71: 20/20, won all
--   5f3e4a08  71: 19/30, won all               8c8637f7  71: 58/300, won all
--   81d1a2f4  71: 19/201, won 18               58c95157  32: 60/60, won all
--   ebb65747  32: 15/16, won 15                597192bd  69: 35/35, won all
--   f3d6566e  47: 40/110, won all              12728b08  44: 25/63, won all
--   b9ad2ca4  44: 11/11, won all
-- 1246 duels in all. Nothing is deleted; flag_session() only sets excluded = true.

select private.flag_session(s::uuid)
from unnest(array[
  '159ffa67-2e0a-43cc-8d9b-310941307b6e',
  'f5780034-5781-48a6-a789-9d9e1d5ff064',
  '5f3e4a08-a426-4785-874d-dd68c7053c92',
  '8c8637f7-36af-43df-9cbf-428ac7b8be26',
  '81d1a2f4-78c1-4512-921d-70ec76cc0004',
  '58c95157-cec4-451f-8c14-53d89d13124c',
  'ebb65747-5493-408d-96b2-f36c1714e391',
  '597192bd-0f43-41ce-b3e6-0d10e881ce16',
  'f3d6566e-26e3-4786-b892-2a2532cdd3b9',
  '12728b08-6374-4f0d-be61-9c5b915c1587',
  'b9ad2ca4-b409-438b-8b3f-a368d48ec4b1'
]) as s;

-- Replay after the flags are committed; only this statement's row is printed.
select public.recompute_elo() as replayed,
       (select count(*) from public.duels where excluded) as excluded_duels;
