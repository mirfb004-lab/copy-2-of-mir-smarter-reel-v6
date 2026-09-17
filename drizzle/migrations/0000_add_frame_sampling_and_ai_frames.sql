ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS frame_sampling_seconds integer NOT NULL DEFAULT 10;
ALTER TABLE public.video_queue ADD COLUMN IF NOT EXISTS ai_frames jsonb;
ALTER TABLE public.video_queue ADD COLUMN IF NOT EXISTS ai_frames_at timestamptz;