import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Loop Learner only: queue items still missing browser-extracted AI frames.
export const listQueueItemsNeedingFrames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaign_id: z.string().uuid().nullable().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("video_queue")
      .select("id,cloudinary_url,campaign_id")
      .eq("user_id", context.userId)
      .in("status", ["pending", "failed"])
      .is("ai_frames", null)
      .order("position", { ascending: true })
      .limit(10);
    if (data?.campaign_id) q = q.eq("campaign_id", data.campaign_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveQueueItemFrames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    frames: z.array(z.string().min(1).max(2_000_000)).max(16),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("video_queue")
      .update({ ai_frames: data.frames as never, ai_frames_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, frames: data.frames.length };
  });

export const updateCampaignFrameSampling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    frame_sampling_seconds: z.number().int().min(1).max(120),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("campaigns")
      .update({ frame_sampling_seconds: data.frame_sampling_seconds })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
