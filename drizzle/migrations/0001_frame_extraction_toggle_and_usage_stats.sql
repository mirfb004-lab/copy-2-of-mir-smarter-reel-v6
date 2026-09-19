-- 1) Per-campaign toggle for browser frame extraction (Loop Learner)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS frame_extraction_enabled boolean NOT NULL DEFAULT true;

-- 2) Usage & Activity stats RPC (was missing, so the page showed no numbers)
CREATE OR REPLACE FUNCTION public.usage_db_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  uid uuid := auth.uid();
  result jsonb;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT jsonb_build_object(
    'database_bytes', (SELECT pg_database_size(current_database())),
    'tables', COALESCE((
      SELECT jsonb_agg(t) FROM (
        SELECT c.relname AS "table",
               pg_total_relation_size(c.oid) AS total_bytes,
               GREATEST(c.reltuples, 0)::bigint AS estimated_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 20
      ) t
    ), '[]'::jsonb),
    'storage', COALESCE((
      SELECT jsonb_agg(s) FROM (
        SELECT b.name AS bucket,
               COUNT(o.id)::bigint AS objects,
               COALESCE(SUM((o.metadata->>'size')::bigint), 0)::bigint AS bytes
        FROM storage.buckets b
        LEFT JOIN storage.objects o ON o.bucket_id = b.id
        GROUP BY b.name
      ) s
    ), '[]'::jsonb),
    'frames', (
      SELECT jsonb_build_object(
        'items_with_frames', COUNT(*) FILTER (WHERE q.ai_frames IS NOT NULL),
        'frame_bytes', COALESCE(SUM(octet_length(q.ai_frames::text)) FILTER (WHERE q.ai_frames IS NOT NULL), 0),
        'stale_done_items', COUNT(*) FILTER (WHERE q.ai_frames IS NOT NULL AND q.status IN ('done','skipped')),
        'stale_done_bytes', COALESCE(SUM(octet_length(q.ai_frames::text)) FILTER (WHERE q.ai_frames IS NOT NULL AND q.status IN ('done','skipped')), 0)
      )
      FROM public.video_queue q WHERE q.user_id = uid
    ),
    'logs', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'older_than_30d', COUNT(*) FILTER (WHERE created_at < now() - interval '30 days')
      ) FROM public.logs WHERE user_id = uid
    ),
    'my_rows', jsonb_build_object(
      'campaigns', (SELECT COUNT(*) FROM public.campaigns WHERE user_id = uid),
      'channels', (SELECT COUNT(*) FROM public.channels WHERE user_id = uid),
      'queued videos', (SELECT COUNT(*) FROM public.video_queue WHERE user_id = uid),
      'runs', (SELECT COUNT(*) FROM public.runs WHERE user_id = uid),
      'captions', (SELECT COUNT(*) FROM public.captions WHERE user_id = uid),
      'published posts', (SELECT COUNT(*) FROM public.published_posts WHERE user_id = uid),
      'memory insights', (SELECT COUNT(*) FROM public.memory_insights WHERE user_id = uid),
      'sheet rows', (SELECT COUNT(*) FROM public.sheet_mode_rows r JOIN public.sheet_mode_sheets s ON s.id = r.sheet_id WHERE s.user_id = uid)
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.usage_db_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.usage_db_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.usage_db_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.usage_db_stats() TO service_role;