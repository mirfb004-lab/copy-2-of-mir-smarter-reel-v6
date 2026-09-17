import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runReelFormulaSchedule } from "./reel-formula.server";

const platform = z.enum(["instagram", "tiktok"]);
const postType = z.enum(["reel", "story", "video"]);
const publishMode = z.enum(["shareNow", "addToQueue", "customScheduled"]);
function validatePublishMode(value: { publish_mode: string; custom_schedule_offset_minutes: number | null; custom_schedule_at: string | null }, ctx: z.RefinementCtx) {
  if (value.publish_mode === "customScheduled" && value.custom_schedule_offset_minutes == null && value.custom_schedule_at == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["custom_schedule_at"], message: "Custom scheduling requires a relative offset or specific time" });
  }
}
const scheduleInput = z.object({
  campaign_id: z.string().uuid().nullable().optional(),
  channel_id: z.string().uuid(),
  platform,
  post_type: postType,
  mode: z.enum(["single", "multiple"]).default("single"),
  media_url: z.string().url().max(2000).optional().default(""),
  caption: z.string().max(4000).default(""),
  items: z.array(z.object({ media_url: z.string().url().max(2000), caption: z.string().max(4000).default("") })).max(50).default([]),
  share_to_feed: z.boolean().default(true),
  thumbnail_timestamp: z.number().min(0).max(86400).default(0),
  privacy_level: z.enum(["PUBLIC", "MUTUAL_FOLLOWS", "SELF_ONLY"]).nullable().optional(),
  allow_comments: z.boolean().default(true),
  allow_duet: z.boolean().default(false),
  allow_stitch: z.boolean().default(false),
  interval_hours: z.number().int().min(1).max(8760),
  publish_mode: publishMode.default("shareNow"),
  custom_schedule_offset_minutes: z.number().int().min(0).max(60 * 24 * 30).nullable().default(null),
  custom_schedule_at: z.string().datetime().nullable().default(null),
  scheduler_mode: z.enum(["every_x_hours", "daily_times", "manual"]).default("every_x_hours"),
  daily_times: z.preprocess((value) => Array.isArray(value) ? value.map((time) => String(time).trim()).filter(Boolean) : value, z.array(z.string()).default([])),
  start_at: z.string().datetime().nullable().optional(),
  cloudinary_transform_enabled: z.boolean().default(false),
  cloudinary_transform: z.string().max(1000).default(""),
  cloudinary_transform_mode: z.enum(["replace", "stack"]).default("replace"),
}).superRefine((value, ctx) => {
  if (value.scheduler_mode === "daily_times") {
    if (value.daily_times.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["daily_times"], message: "At least one daily UTC time is required" });
    } else {
      for (const [index, time] of value.daily_times.entries()) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["daily_times", index], message: "Invalid daily UTC time" });
        }
      }
    }
  }
  validatePublishMode(value, ctx);
});

function initialFormulaNextRun(mode: string, dailyTimes: string[], intervalHours: number, startAt: string | null | undefined) {
  if (mode === "manual") return null;
  if (mode === "every_x_hours") return startAt ?? new Date().toISOString();
  const now = new Date();
  for (const time of [...dailyTimes].sort()) {
    const [hour, minute] = time.split(":").map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue;
    const candidate = new Date(now);
    candidate.setUTCHours(hour, minute, 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  const [hour, minute] = (dailyTimes[0] ?? "00:00").split(":").map(Number);
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(hour || 0, minute || 0, 0, 0);
  return tomorrow.toISOString();
}

async function assertOwner(sb: any, userId: string, campaignId: string | null | undefined, channelId: string, expectedPlatform: string) {
  const [{ data: channel, error: channelError }, campaignResult] = await Promise.all([
    sb.from("channels").select("id,platform,active").eq("id", channelId).eq("user_id", userId).maybeSingle(),
    campaignId ? sb.from("campaigns").select("id").eq("id", campaignId).eq("user_id", userId).maybeSingle() : Promise.resolve({ data: { id: null }, error: null }),
  ]);
  if (channelError) throw new Error(channelError.message);
  if (!channel) throw new Error("Connected channel not found");
  if (!channel.active) throw new Error("Selected channel is inactive");
  if (String(channel.platform).toLowerCase() !== expectedPlatform) throw new Error("Selected channel platform does not match the form");
  if (campaignResult.error) throw new Error(campaignResult.error.message);
  if (campaignId && !campaignResult.data) throw new Error("Campaign not found");
}

export const listRecurringSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("recurring_schedules")
      .select("*,channels(name,platform),campaigns(name)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const activateRecurringSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => scheduleInput.parse(d))
  .handler(async ({ data, context }) => {
    const normalizedPlatform = data.platform.toLowerCase();
    const normalizedPostType = data.post_type === "reel" || data.post_type === "video" ? data.post_type : "story";
    if (normalizedPlatform === "instagram" && !["reel", "story"].includes(normalizedPostType)) throw new Error("Instagram supports Reel or Story only");
    if (normalizedPlatform === "tiktok" && !["video", "story"].includes(normalizedPostType)) throw new Error("TikTok supports Video or Story only");
    if (normalizedPlatform === "instagram" && normalizedPostType === "story") data.caption = "";
    await assertOwner(context.supabase, context.userId, data.campaign_id, data.channel_id, normalizedPlatform);
    if (data.mode === "multiple" && !data.items.length) throw new Error("Multiple mode requires at least one item");
    const firstItem = data.mode === "multiple" ? data.items[0] : null;
    const nextRun = initialFormulaNextRun(data.scheduler_mode, data.daily_times, data.interval_hours, data.start_at);
    const { data: row, error } = await context.supabase.from("recurring_schedules").insert({
      user_id: context.userId,
      campaign_id: data.campaign_id ?? null,
      channel_id: data.channel_id,
      platform: normalizedPlatform,
      post_type: normalizedPostType,
      mode: data.mode,
      scheduler_mode: data.scheduler_mode,
      daily_times: data.daily_times,
      media_url: firstItem?.media_url ?? data.media_url,
      caption: firstItem?.caption ?? data.caption,
      share_to_feed: normalizedPlatform === "instagram" && normalizedPostType === "reel" ? data.share_to_feed : false,
      thumbnail_timestamp: data.thumbnail_timestamp,
      privacy_level: normalizedPlatform === "tiktok" ? (data.privacy_level ?? "PUBLIC") : null,
      allow_comments: data.allow_comments,
      allow_duet: normalizedPlatform === "tiktok" ? data.allow_duet : false,
      allow_stitch: normalizedPlatform === "tiktok" ? data.allow_stitch : false,
      interval_hours: data.interval_hours,
      publish_mode: data.publish_mode,
      custom_schedule_offset_minutes: data.custom_schedule_offset_minutes,
      custom_schedule_at: data.custom_schedule_at,
      start_at: data.start_at ?? null,
      next_run_at: nextRun,
      cloudinary_transform_enabled: data.cloudinary_transform_enabled,
      cloudinary_transform: data.cloudinary_transform,
      cloudinary_transform_mode: data.cloudinary_transform_mode,
      is_active: true,
    }).select("*").single();
    if (error) throw new Error(error.message);
    if (data.mode === "multiple") {
      const { error: itemError } = await context.supabase.from("recurring_schedule_items").insert(data.items.map((item, index) => ({ schedule_id: row.id, position: index + 1, media_url: item.media_url, caption: item.caption })));
      if (itemError) throw new Error(itemError.message);
    }
    return row;
  });

const formulaEditSchema = z.object({
  id: z.string().uuid(),
  channel_id: z.string().uuid(),
  platform,
  post_type: postType,
  media_url: z.string().url().max(2000),
  caption: z.string().max(4000),
  thumbnail_timestamp: z.number().min(0).max(86400),
  privacy_level: z.enum(["PUBLIC", "MUTUAL_FOLLOWS", "SELF_ONLY"]).nullable(),
  share_to_feed: z.boolean(),
  allow_comments: z.boolean(),
  allow_duet: z.boolean(),
  allow_stitch: z.boolean(),
  interval_hours: z.number().int().min(1).max(8760),
  publish_mode: publishMode,
  custom_schedule_offset_minutes: z.number().int().min(0).max(60 * 24 * 30).nullable(),
  custom_schedule_at: z.string().datetime().nullable(),
  scheduler_mode: z.enum(["every_x_hours", "daily_times", "manual"]),
  daily_times: z.preprocess((value) => Array.isArray(value) ? value.map((time) => String(time).trim()).filter(Boolean) : value, z.array(z.string())),
  start_at: z.string().datetime().nullable(),
  cloudinary_transform_enabled: z.boolean(),
  cloudinary_transform: z.string().max(1000),
  cloudinary_transform_mode: z.enum(["replace", "stack"]),
}).superRefine((value, ctx) => {
  if (value.scheduler_mode === "daily_times") {
    if (value.daily_times.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["daily_times"], message: "At least one daily UTC time is required" });
    } else {
      for (const [index, time] of value.daily_times.entries()) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["daily_times", index], message: "Invalid daily UTC time" });
        }
      }
    }
  }
  validatePublishMode(value, ctx);
});

export const updateRecurringSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => formulaEditSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: schedule, error: scheduleError } = await context.supabase.from("recurring_schedules").select("id,mode").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (scheduleError) throw new Error(scheduleError.message);
    if (!schedule) throw new Error("Recurring schedule not found");
    await assertOwner(context.supabase, context.userId, null, data.channel_id, data.platform);
    const nextRun = initialFormulaNextRun(data.scheduler_mode, data.daily_times, data.interval_hours, data.start_at);
    const { data: updated, error } = await context.supabase.from("recurring_schedules").update({
      channel_id: data.channel_id,
      platform: data.platform,
      post_type: data.post_type,
      media_url: data.media_url,
      caption: data.caption,
      thumbnail_timestamp: data.thumbnail_timestamp,
      privacy_level: data.privacy_level,
      share_to_feed: data.share_to_feed,
      allow_comments: data.allow_comments,
      allow_duet: data.allow_duet,
      allow_stitch: data.allow_stitch,
      interval_hours: data.interval_hours,
      publish_mode: data.publish_mode,
      custom_schedule_offset_minutes: data.custom_schedule_offset_minutes,
      custom_schedule_at: data.custom_schedule_at,
      scheduler_mode: data.scheduler_mode,
      daily_times: data.daily_times,
      start_at: data.start_at,
      next_run_at: nextRun,
      cloudinary_transform_enabled: data.cloudinary_transform_enabled,
      cloudinary_transform: data.cloudinary_transform,
      cloudinary_transform_mode: data.cloudinary_transform_mode,
      last_error: null,
    }).eq("id", data.id).eq("user_id", context.userId).select("*").single();
    if (error) throw new Error(error.message);
    return updated;
  });

export const updateRecurringScheduleCloudinaryTransform = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    cloudinary_transform_enabled: z.boolean(),
    cloudinary_transform: z.string().max(1000),
    cloudinary_transform_mode: z.enum(["replace", "stack"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("recurring_schedules").update({
      cloudinary_transform_enabled: data.cloudinary_transform_enabled,
      cloudinary_transform: data.cloudinary_transform,
      cloudinary_transform_mode: data.cloudinary_transform_mode,
    }).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listRecurringScheduleItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("recurring_schedule_items").select("*").eq("schedule_id", data.schedule_id).order("position", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: schedule } = await context.supabase.from("recurring_schedules").select("id").eq("id", data.schedule_id).eq("user_id", context.userId).maybeSingle();
    if (!schedule) throw new Error("Recurring schedule not found");
    return rows ?? [];
  });

export const addRecurringScheduleItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid(), media_url: z.string().url().max(2000), caption: z.string().max(4000).default("") }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: schedule } = await context.supabase.from("recurring_schedules").select("id").eq("id", data.schedule_id).eq("user_id", context.userId).maybeSingle();
    if (!schedule) throw new Error("Recurring schedule not found");
    const { data: last } = await context.supabase.from("recurring_schedule_items").select("position").eq("schedule_id", data.schedule_id).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: row, error } = await context.supabase.from("recurring_schedule_items").insert({ schedule_id: data.schedule_id, position: Number(last?.position ?? 0) + 1, media_url: data.media_url, caption: data.caption }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteRecurringScheduleItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: item } = await context.supabase.from("recurring_schedule_items").select("id,schedule_id").eq("id", data.id).maybeSingle();
    if (!item) throw new Error("Rotation item not found");
    const { data: schedule } = await context.supabase.from("recurring_schedules").select("id").eq("id", item.schedule_id).eq("user_id", context.userId).maybeSingle();
    if (!schedule) throw new Error("Recurring schedule not found");
    const { error } = await context.supabase.from("recurring_schedule_items").delete().eq("id", data.id); if (error) throw new Error(error.message); return { ok: true };
  });

export const updateRecurringScheduleItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), media_url: z.string().url().max(2000), caption: z.string().max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: item } = await context.supabase.from("recurring_schedule_items").select("id,schedule_id").eq("id", data.id).maybeSingle();
    if (!item) throw new Error("Rotation item not found");
    const { data: schedule } = await context.supabase.from("recurring_schedules").select("id").eq("id", item.schedule_id).eq("user_id", context.userId).maybeSingle();
    if (!schedule) throw new Error("Recurring schedule not found");
    const { data: updated, error } = await context.supabase.from("recurring_schedule_items").update({ media_url: data.media_url, caption: data.caption }).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message); return updated;
  });

export const moveRecurringScheduleItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), direction: z.enum(["up", "down"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: item } = await context.supabase.from("recurring_schedule_items").select("id,schedule_id").eq("id", data.id).maybeSingle();
    if (!item) throw new Error("Rotation item not found");
    const { data: schedule } = await context.supabase.from("recurring_schedules").select("id").eq("id", item.schedule_id).eq("user_id", context.userId).maybeSingle();
    if (!schedule) throw new Error("Recurring schedule not found");
    const { data: moved, error } = await context.supabase.rpc("move_recurring_schedule_item", { _item_id: data.id, _direction: data.direction });
    if (error) throw new Error(error.message);
    if (!moved) throw new Error("Rotation item not found");
    return { ok: true };
  });

export const runRecurringScheduleNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: schedule } = await context.supabase.from("recurring_schedules").select("id").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (!schedule) throw new Error("Recurring schedule not found");
    return runReelFormulaSchedule(supabaseAdmin as any, data.id, `manual-${crypto.randomUUID()}`);
  });

export const setRecurringScheduleActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("recurring_schedules")
      .update({ is_active: data.is_active, last_error: null })
      .eq("id", data.id).eq("user_id", context.userId)
      .select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Recurring schedule not found");
    return row;
  });

export const deleteRecurringSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase.from("recurring_schedules")
      .delete({ count: "exact" }).eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Recurring schedule not found");
    return { ok: true };
  });

export const listFormulaRunHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("runs")
      .select("id,status,error,started_at,finished_at,duration_ms,strategy_used,published_posts(buffer_post_id,permalink,posted_at,buffer_status,due_at,verified_at,platform,text_content),audit_events(event_type,status,error,created_at,payload)")
      .eq("user_id", context.userId).eq("strategy_used", "1_reel_formula")
      .order("started_at", { ascending: false }).limit(100);
    if (data?.schedule_id) q = q.contains("step_state", { recurring_schedule_id: data.schedule_id });
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
