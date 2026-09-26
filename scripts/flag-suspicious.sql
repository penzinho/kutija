-- Moderation: list suspicious sessions/IP hashes (logic: private.suspicious in
-- supabase/migrations/20260926120300_suspicious_view.sql).
--
--   pnpm dlx supabase db query --linked -f scripts/flag-suspicious.sql
--
-- reason = bias (one entry wins >90% of 10+ duels), burst (20+ duels within 60 s),
-- sessions (>20 sessions on one ip_hash). Review the rows, then flag what's abuse:
--
--   select private.flag_session('<session_id>');   -- rows with a session_id
--   select private.flag_ip('<ip_hash>');            -- ip-only rows; covers every session on it
--
-- Both only set excluded = true (nothing is deleted), are idempotent, and return the
-- counts they touched. Elo doesn't change until you replay it, once per pass:
--
--   select public.recompute_elo();
--
-- Excluded rows drop out of this list, so re-running it after flagging shows what's left.

select * from private.suspicious order by reason, duels desc;
