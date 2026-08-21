UPDATE public.runs
   SET status = 'stale',
       error = coalesce(error, 'Recovered: run never finished (no heartbeat).'),
       finished_at = coalesce(finished_at, now())
 WHERE status IN ('analyzing','generating','publishing')
   AND started_at < now() - interval '15 minutes'
   AND (heartbeat_at IS NULL OR heartbeat_at < now() - interval '15 minutes');

UPDATE public.channels c
   SET active_run_id = NULL, lock_expires_at = NULL
 WHERE c.active_run_id IS NOT NULL
   AND (c.lock_expires_at IS NULL
        OR c.lock_expires_at < now()
        OR EXISTS (SELECT 1 FROM public.runs r
                    WHERE r.id = c.active_run_id
                      AND r.status IN ('complete','failed','stale')));