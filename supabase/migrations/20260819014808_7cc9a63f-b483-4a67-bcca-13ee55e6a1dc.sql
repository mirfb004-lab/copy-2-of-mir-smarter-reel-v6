CREATE OR REPLACE FUNCTION public.claim_schedule_slot(_schedule_id uuid, _now timestamp with time zone, _next_run_at timestamp with time zone)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE claimed boolean;
BEGIN
  UPDATE public.schedules
     SET next_run_at = _next_run_at,
         last_run_at = _now,
         updated_at = now()
   WHERE id = _schedule_id
     AND active = true
     AND paused = false
     AND next_run_at IS NOT NULL
     AND next_run_at <= _now
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_schedule_slot(uuid, timestamptz, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_schedule_slot(uuid, timestamptz, timestamptz) TO service_role;