-- Daily rank snapshot for the 24h delta (D10). pg_cron is available on the free tier.
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 22:00 UTC is midnight in Zagreb in summer, 23:00 in winter. Re-scheduling with the
-- same name replaces the job.
select cron.schedule('snapshot-ranks', '0 22 * * *', 'select public.snapshot_ranks()');
