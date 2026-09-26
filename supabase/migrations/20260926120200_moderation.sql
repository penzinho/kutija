-- Moderation helpers (step 9): mark every duel and favorite recorded by a session or an
-- ip_hash as excluded, so recompute_elo() can replay Elo without them. Detection queries
-- and the procedure live in scripts/flag-suspicious.sql; this migration only adds the
-- mutation. Both live in `private` (not exposed through the API) and are callable only
-- by the database owner, same as the other `private` helpers.

create function private.flag_session(p_session uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_duels int;
  v_favorites int;
begin
  update public.duels set excluded = true where session_id = p_session and not excluded;
  get diagnostics v_duels = row_count;
  update public.favorites set excluded = true where session_id = p_session and not excluded;
  get diagnostics v_favorites = row_count;
  return jsonb_build_object('session_id', p_session, 'duels_excluded', v_duels, 'favorites_excluded', v_favorites);
end;
$$;

create function private.flag_ip(p_ip_hash text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_duels int;
  v_favorites int;
begin
  update public.duels set excluded = true where ip_hash = p_ip_hash and not excluded;
  get diagnostics v_duels = row_count;
  update public.favorites set excluded = true where ip_hash = p_ip_hash and not excluded;
  get diagnostics v_favorites = row_count;
  return jsonb_build_object('ip_hash', p_ip_hash, 'duels_excluded', v_duels, 'favorites_excluded', v_favorites);
end;
$$;
