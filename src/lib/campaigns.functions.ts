import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("campaigns")
      .select("id,name,description,objective,custom_objective,status,share_learning,publish_mode,custom_scheduled_at,publish_delay_minutes, use_sample_captions,sample_caption_mode,channel_mode,cloudinary_transform_enabled,cloudinary_transform,cloudinary_transform_mode,frame_sampling_seconds,created_at,updated_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const upsertSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().optional().nullable(),
  objective: z.string().min(1),
  custom_objective: z.string().optional().nullable(),
  share_learning: z.boolean().optional(),
  publish_mode: z.enum(["addToQueue", "shareNow", "customScheduled"]).optional(),
  custom_scheduled_at: z.string().nullable().optional(),
  publish_delay_minutes: z.number().int().min(1).max(10080).nullable().optional(),
  use_sample_captions: z.boolean().optional(),
  sample_caption_mode: z.enum(["style_reference", "learning_seed"]).optional(),
  channel_mode: z.enum(["single", "multi"]).optional(),
  cloudinary_transform_enabled: z.boolean().optional(),
  cloudinary_transform: z.string().max(1000).optional(),
  cloudinary_transform_mode: z.enum(["replace", "stack"]).optional(),
  frame_sampling_seconds: z.number().int().min(1).max(120).optional(),

});

export const upsertCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const publishFields = {
      publish_mode: data.publish_mode ?? "addToQueue",
      custom_scheduled_at: data.custom_scheduled_at ?? null,
      publish_delay_minutes: data.publish_delay_minutes ?? null,
    };
    if (data.id) {
      const { error } = await context.supabase.from("campaigns").update({
        name: data.name, description: data.description ?? null,
        objective: data.objective, custom_objective: data.custom_objective ?? null,
        share_learning: data.share_learning ?? false,
        ...(data.use_sample_captions === undefined ? {} : { use_sample_captions: data.use_sample_captions }),
        ...(data.sample_caption_mode === undefined ? {} : { sample_caption_mode: data.sample_caption_mode }),
        ...(data.channel_mode === undefined ? {} : { channel_mode: data.channel_mode }),
        ...(data.cloudinary_transform_enabled === undefined ? {} : { cloudinary_transform_enabled: data.cloudinary_transform_enabled }),
        ...(data.cloudinary_transform === undefined ? {} : { cloudinary_transform: data.cloudinary_transform }),
        ...(data.cloudinary_transform_mode === undefined ? {} : { cloudinary_transform_mode: data.cloudinary_transform_mode }),
        ...(data.frame_sampling_seconds === undefined ? {} : { frame_sampling_seconds: data.frame_sampling_seconds }),
        ...publishFields,
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase.from("campaigns").insert({
      user_id: context.userId, name: data.name, description: data.description ?? null,
      objective: data.objective, custom_objective: data.custom_objective ?? null,
      share_learning: data.share_learning ?? false,
      channel_mode: data.channel_mode ?? "single",
      cloudinary_transform_enabled: data.cloudinary_transform_enabled ?? false,
      cloudinary_transform: data.cloudinary_transform ?? "",
      cloudinary_transform_mode: data.cloudinary_transform_mode ?? "replace",
      frame_sampling_seconds: data.frame_sampling_seconds ?? 10,
      ...publishFields,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateCampaignPublishing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    publish_mode: z.enum(["addToQueue", "shareNow", "customScheduled"]),
    custom_scheduled_at: z.string().nullable().optional(),
    publish_delay_minutes: z.number().int().min(1).max(10080).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("campaigns").update({
      publish_mode: data.publish_mode,
      custom_scheduled_at: data.custom_scheduled_at ?? null,
      publish_delay_minutes: data.publish_delay_minutes ?? null,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const updateCampaignCloudinaryTransform = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    cloudinary_transform_enabled: z.boolean(),
    cloudinary_transform: z.string().max(1000),
    cloudinary_transform_mode: z.enum(["replace", "stack"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("campaigns").update({
      cloudinary_transform_enabled: data.cloudinary_transform_enabled,
      cloudinary_transform: data.cloudinary_transform,
      cloudinary_transform_mode: data.cloudinary_transform_mode,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    status: z.enum(["active", "paused", "stopped"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("campaigns")
      .update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    // Also pause/resume all schedules attached to this campaign.
    await context.supabase.from("schedules")
      .update({ paused: data.status !== "active" })
      .eq("campaign_id", data.id);
    return { ok: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { purgeCampaignEverything } = await import("./campaign-maintenance.server");
    await purgeCampaignEverything(context.supabase, data.id);
    const { error } = await context.supabase.from("campaigns").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Reset a single campaign's room without touching any other campaign.
export const resetCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    clear_queue: z.boolean().optional(),
    clear_runs: z.boolean().optional(),
    clear_memory: z.boolean().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { resetCampaignData } = await import("./campaign-maintenance.server");
    await resetCampaignData(context.supabase, data.id, {
      clearQueue: data.clear_queue ?? false,
      clearRuns: data.clear_runs ?? true,
      clearMemory: data.clear_memory ?? false,
    });
    return { ok: true };
  });

