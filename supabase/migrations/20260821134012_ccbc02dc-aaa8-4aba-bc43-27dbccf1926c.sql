-- Helper: next daily run time honoring the owner's saved timezone
CREATE OR REPLACE FUNCTION public.compute_next_daily_run_at(_times text[], _tz text, _now timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  tz text := coalesce(nullif(_tz, ''), 'UTC');
  local_now timestamp;
  t text;
  candidate timestamp;
  first_time time;
BEGIN
  IF _times IS NULL OR array_length(_times, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    local_now := _now AT TIME ZONE tz;
  EXCEPTION WHEN others THEN
    tz := 'UTC';
    local_now := _now AT TIME ZONE tz;
  END;
  FOREACH t IN ARRAY (SELECT array_agg(x ORDER BY x) FROM unnest(_times) AS x)
  LOOP
    BEGIN
      candidate := date_trunc('day', local_now) + t::time;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF candidate > local_now THEN
      RETURN candidate AT TIME ZONE tz;
    END IF;
  END LOOP;
  SELECT min(x::time) INTO first_time FROM unnest(_times) AS x;
  IF first_time IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (date_trunc('day', local_now) + interval '1 day' + first_time) AT TIME ZONE tz;
END;
$$;

-- 1. Loop schedules: atomic claim + next_run_at advancement (timezone aware for daily_times)
CREATE OR REPLACE FUNCTION public.claim_schedule_slot(_schedule_id uuid, _now timestamp with time zone, _next_run_at timestamp with time zone)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE claimed boolean;
BEGIN
  UPDATE public.schedules s
     SET next_run_at = CASE
           WHEN s.mode = 'daily_times' THEN coalesce(
             public.compute_next_daily_run_at(
               s.daily_times,
               (SELECT p.timezone FROM public.profiles p WHERE p.id = s.user_id),
               _now
             ), _next_run_at)
           WHEN s.mode = 'interval' AND s.interval_hours IS NOT NULL AND s.interval_hours > 0
             THEN _now + make_interval(secs => (s.interval_hours * 3600)::int)
           WHEN s.mode = 'manual' THEN NULL
           ELSE _next_run_at
         END,
         last_run_at = _now,
         updated_at = now()
   WHERE s.id = _schedule_id
     AND s.active = true
     AND s.paused = false
     AND s.next_run_at IS NOT NULL
     AND s.next_run_at <= _now
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END;
$$;

-- 2/3. Formula schedules: claim AND advance next_run_at in the same statement, timezone aware
CREATE OR REPLACE FUNCTION public.claim_recurring_schedule_slot(_schedule_id uuid, _slot_key text, _run_id uuid, _now timestamp with time zone DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE claimed boolean;
BEGIN
  UPDATE public.recurring_schedules r
     SET last_claimed_slot = _slot_key,
         last_run_id = _run_id,
         last_run_at = _now,
         next_run_at = CASE
           WHEN r.scheduler_mode = 'manual' THEN NULL
           WHEN r.scheduler_mode = 'daily_times' THEN public.compute_next_daily_run_at(
             (SELECT array_agg(v::text) FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(r.daily_times) = 'array' THEN r.daily_times ELSE '[]'::jsonb END
              ) AS v),
             (SELECT p.timezone FROM public.profiles p WHERE p.id = r.user_id),
             _now
           )
           ELSE _now + make_interval(secs => (coalesce(r.interval_hours, 24) * 3600)::int)
         END,
         updated_at = _now
   WHERE r.id = _schedule_id
     AND r.is_active = true
     AND (r.last_claimed_slot IS DISTINCT FROM _slot_key OR r.last_run_id = _run_id)
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END;
$$;