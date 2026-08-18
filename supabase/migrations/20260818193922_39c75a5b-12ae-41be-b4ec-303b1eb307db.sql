CREATE TABLE public.formula_run_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.runs(id) ON DELETE CASCADE,
  recurring_schedule_id uuid NOT NULL REFERENCES public.recurring_schedules(id) ON DELETE CASCADE,
  buffer_post_id text NOT NULL,
  post_type text NOT NULL DEFAULT 'other',
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics_updated_at timestamptz,
  last_synced_at timestamptz,
  sync_status text NOT NULL DEFAULT 'pending',
  sync_attempts integer NOT NULL DEFAULT 0,
  next_sync_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX formula_run_insights_post_uidx ON public.formula_run_insights (recurring_schedule_id, buffer_post_id);
CREATE INDEX formula_run_insights_due_idx ON public.formula_run_insights (next_sync_due_at) WHERE post_type = 'story' AND sync_status <> 'synced';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.formula_run_insights TO authenticated;
GRANT ALL ON public.formula_run_insights TO service_role;

ALTER TABLE public.formula_run_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their formula insights"
ON public.formula_run_insights
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.recurring_schedules s WHERE s.id = formula_run_insights.recurring_schedule_id AND s.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.recurring_schedules s WHERE s.id = formula_run_insights.recurring_schedule_id AND s.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.claim_formula_insight_sync(_insight_id uuid, _now timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE claimed boolean;
BEGIN
  UPDATE public.formula_run_insights
     SET sync_attempts = sync_attempts + 1,
         next_sync_due_at = _now + interval '10 minutes'
   WHERE id = _insight_id
     AND post_type = 'story'
     AND sync_status <> 'synced'
     AND next_sync_due_at IS NOT NULL
     AND next_sync_due_at <= _now
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END;
$$;