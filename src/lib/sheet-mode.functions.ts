import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { normalizeBufferPlatform } from "./buffer-platforms";
import { z } from "zod";
import { nextSheetRunAt, runSheetModeCycle } from "./sheet-mode.server";
import { addChannelUsageLabels } from "./channel-usage.server";

const sheetId = z.string().uuid();
const channelId = z.string().uuid();
const rowId = z.string().uuid();

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// PostgREST caps a single response (default 1000 rows), so every full-sheet read
// must page explicitly or large sheets silently truncate.
const PAGE_SIZE = 1000;
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE_SIZE) return out;
  }
}
const selectionRule = z.enum([
  "first_ready",
  "random_ready",
  "highest_priority",
  "lowest_priority",
  "newest_created",
  "oldest_created",
  "round_robin",
  "weighted_random",
  "ai_smart_score",
]);

const sheetSettingsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  publish_mode: z.enum(["shareNow", "addToQueue", "customScheduled"]).default("shareNow"),
  custom_schedule_offset_minutes: z.number().int().min(0).max(60 * 24 * 30).nullable().default(null),
  custom_schedule_at: z.string().datetime().nullable().default(null),
  rows_per_run: z.number().int().min(1).max(500).default(1),
  schedule_label: z.string().trim().max(200).nullable().optional(),
  selection_rule: selectionRule.default("first_ready"),
  after_publish_mark_status: z.boolean().default(true),
  after_publish_save_post_id: z.boolean().default(true),
  after_publish_save_time: z.boolean().default(true),
  after_publish_save_url: z.boolean().default(true),
  retry_failed: z.boolean().default(true),
  scheduler_mode: z.enum(["every_x_hours", "daily_times", "manual"]).default("every_x_hours"),
  scheduler_interval_hours: z.number().int().min(0).max(8760).default(0),
  daily_times: z.preprocess((value) => Array.isArray(value) ? value.map((time) => String(time).trim()).filter(Boolean) : value, z.array(z.string()).default([])),
  cloudinary_transform_enabled: z.boolean().default(false),
  cloudinary_transform: z.string().max(1000).default(""),
  cloudinary_transform_mode: z.enum(["replace", "stack"]).default("replace"),
});

function validateSchedulerTimes(value: { scheduler_mode: string; daily_times: string[] }, ctx: z.RefinementCtx) {
  if (value.scheduler_mode !== "daily_times") return;
  if (value.daily_times.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["daily_times"], message: "At least one daily UTC time is required" });
    return;
  }
  for (const [index, time] of value.daily_times.entries()) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["daily_times", index], message: "Invalid daily UTC time" });
    }
  }
}

const customizationSchema = z.record(z.string(), z.any()).default({});

const customizationKeysByPlatform = {
  instagram: new Set(["postType", "shareToFeed", "isAiGenerated", "link", "geolocation"]),
  tiktok: new Set(["isAiGenerated", "title"]),
  facebook: new Set(["facebookType", "linkAttachment", "firstComment"]),
  youtube: new Set(["youtubeTitle", "youtubePrivacy", "categoryId", "madeForKids", "notifySubscribers", "embeddable", "license"]),
  pinterest: new Set(["boardServiceId", "title"]),
} as const;

function validateCustomization(platform: string, value: Record<string, any>) {
  const normalized = normalizeBufferPlatform(platform);
  const allowed = customizationKeysByPlatform[normalized as keyof typeof customizationKeysByPlatform];
  if (!allowed) throw new Error(`Unsupported customization platform: ${platform}`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unsupported ${normalized} customization field(s): ${unknown.join(", ")}`);
  const booleanKeys = ["shareToFeed", "isAiGenerated", "madeForKids", "notifySubscribers", "embeddable"];
  for (const key of booleanKeys) if (key in value && typeof value[key] !== "boolean") throw new Error(`${key} must be a boolean`);
  const stringKeys = ["link", "title", "firstComment", "youtubeTitle", "categoryId", "boardServiceId"];
  for (const key of stringKeys) if (key in value && typeof value[key] !== "string") throw new Error(`${key} must be a string`);
  if ("postType" in value && !["post", "reel", "story"].includes(value.postType)) throw new Error("Instagram postType is invalid");
  if ("facebookType" in value && !["post", "story", "reel"].includes(value.facebookType)) throw new Error("Facebook type is invalid");
  if ("youtubePrivacy" in value && !["public", "unlisted", "private"].includes(value.youtubePrivacy)) throw new Error("YouTube privacy is invalid");
  if ("license" in value && !["youtube", "creativeCommon"].includes(value.license)) throw new Error("YouTube license is invalid");
  if ("geolocation" in value && (!value.geolocation || typeof value.geolocation !== "object" || typeof value.geolocation.id !== "string" || typeof value.geolocation.text !== "string")) throw new Error("Instagram geolocation requires string id and text");
  if ("linkAttachment" in value && (!value.linkAttachment || typeof value.linkAttachment !== "object" || typeof value.linkAttachment.url !== "string" || (value.linkAttachment.title != null && typeof value.linkAttachment.title !== "string") || (value.linkAttachment.description != null && typeof value.linkAttachment.description !== "string") || (value.linkAttachment.thumbnail?.url != null && typeof value.linkAttachment.thumbnail.url !== "string"))) throw new Error("Facebook linkAttachment has an invalid shape");
  return value;
}
const targetInput = z.object({
  channel_id: channelId,
  backfill_applied: z.boolean().default(false),
  customization: customizationSchema,
});

const rowValues = z.object({
  caption: z.string().max(20000),
  video_url: z.string().max(2000),
  priority: z.number().int().nullable(),
  weight: z.number().int().min(0).nullable(),
});

type SheetModeChannelStatus = {
  id: string;
  row_id: string;
  channel_target_id: string;
  status: string;
  published_post_id: string | null;
  published_url: string | null;
  published_at: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
};

type SheetModeTargetSummary = {
  id: string;
  sheet_id: string;
  buffer_connection_id: string;
  channel_id: string;
  channel_label: string;
  platform: string;
  is_active: boolean;
  backfill_applied: boolean;
  customization: Json;
  added_at: string;
  removed_at: string | null;
};

async function assertSheetOwner(sb: any, userId: string, id: string) {
  const { data, error } = await sb
    .from("sheet_mode_sheets")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sheet not found");
}

async function recalculateRowStatus(sb: any, rowIdValue: string) {
  const { data: row, error: rowError } = await sb.from("sheet_mode_rows").select("id").eq("id", rowIdValue).maybeSingle();
  if (rowError) throw new Error(rowError.message);
  if (!row) throw new Error("Row not found");
  const { data: statuses, error: statusError } = await sb
    .from("sheet_mode_row_channel_status")
    .select("status,channel_target_id")
    .eq("row_id", rowIdValue);
  if (statusError) throw new Error(statusError.message);
  const targetIds = (statuses ?? []).map((status: { channel_target_id: string }) => status.channel_target_id);
  let activeIds: string[] = [];
  if (targetIds.length) {
    const { data: targets, error: targetError } = await sb
      .from("sheet_mode_channel_targets")
      .select("id")
      .in("id", targetIds)
      .eq("is_active", true);
    if (targetError) throw new Error(targetError.message);
    activeIds = (targets ?? []).map((target: { id: string }) => target.id);
  }
  const activeCount = activeIds.length;
  const activeSet = new Set(activeIds);
  const doneCount = (statuses ?? []).filter((status: { channel_target_id: string; status: string }) => activeSet.has(status.channel_target_id) && status.status === "T").length;
  const nextStatus = activeCount === 0 || doneCount === 0 ? "pending" : doneCount >= activeCount ? "complete" : "partial";
  const { error: updateError } = await sb.from("sheet_mode_rows").update({ status: nextStatus }).eq("id", rowIdValue);
  if (updateError) throw new Error(updateError.message);
}

async function getOwnedChannels(sb: any, userId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return [];
  const { data, error } = await sb
    .from("channels")
    .select("id,name,platform,credential_id,active,missing_since,buffer_credentials(id,label)")
    .eq("user_id", userId)
    .in("id", uniqueIds)
    .eq("active", true)
    .is("missing_since", null);
  if (error) throw new Error(error.message);
  if ((data ?? []).length !== uniqueIds.length) throw new Error("One or more selected channels are unavailable.");
  return data ?? [];
}

export const listSheetModeWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [sheetsResult, channelsResult] = await Promise.all([
      context.supabase
        .from("sheet_mode_sheets")
        .select("id,name,rows_per_run,schedule_label,publish_mode,custom_schedule_offset_minutes,custom_schedule_at,selection_rule,after_publish_mark_status,after_publish_save_post_id,after_publish_save_time,after_publish_save_url,retry_failed,is_enabled,created_at,updated_at")
        .order("created_at", { ascending: false }),
      context.supabase
        .from("channels")
        .select("id,name,platform,credential_id,campaign_id,active,missing_since,buffer_credentials(id,label)")
        .eq("user_id", context.userId)
        .eq("active", true)
        .is("missing_since", null)
        .order("created_at", { ascending: false }),
    ]);
    if (sheetsResult.error) throw new Error(sheetsResult.error.message);
    if (channelsResult.error) throw new Error(channelsResult.error.message);

    const sheets = sheetsResult.data ?? [];
    const targetsBySheet = new Map<string, SheetModeTargetSummary[]>();
    if (sheets.length) {
      const { data: targets, error } = await context.supabase
        .from("sheet_mode_channel_targets")
        .select("id,sheet_id,buffer_connection_id,channel_id,channel_label,platform,is_active,backfill_applied,customization,added_at,removed_at")
        .in("sheet_id", sheets.map((sheet) => sheet.id))
        .eq("is_active", true)
        .order("added_at", { ascending: true });
      if (error) throw new Error(error.message);
      for (const target of targets ?? []) {
        const list = targetsBySheet.get(target.sheet_id) ?? [];
        list.push(target);
        targetsBySheet.set(target.sheet_id, list);
      }
    }

    return {
      sheets: sheets.map((sheet) => ({ ...sheet, channel_targets: targetsBySheet.get(sheet.id) ?? [] })),
      channels: await addChannelUsageLabels(context.supabase, context.userId, channelsResult.data ?? []),
    };
  });

export const createSheetModeSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sheetSettingsSchema.extend({ targets: z.array(targetInput).max(50) }).superRefine(validateSchedulerTimes).parse(d))
  .handler(async ({ data, context }) => {
    const channels = await getOwnedChannels(context.supabase, context.userId, data.targets.map((target) => target.channel_id));
    const { data: sheet, error } = await context.supabase
      .from("sheet_mode_sheets")
      .insert({
        user_id: context.userId,
        name: data.name,
        rows_per_run: data.rows_per_run,
        schedule_label: data.schedule_label ?? null,
        publish_mode: data.publish_mode,
        custom_schedule_offset_minutes: data.custom_schedule_offset_minutes ?? null,
        custom_schedule_at: data.custom_schedule_at ?? null,
        selection_rule: data.selection_rule,
        after_publish_mark_status: data.after_publish_mark_status,
        after_publish_save_post_id: data.after_publish_save_post_id,
        after_publish_save_time: data.after_publish_save_time,
        after_publish_save_url: data.after_publish_save_url,
        retry_failed: data.retry_failed,
        scheduler_mode: data.scheduler_mode,
        scheduler_interval_hours: data.scheduler_interval_hours,
        daily_times: data.daily_times,
        next_run_at: nextSheetRunAt({ scheduler_mode: data.scheduler_mode, scheduler_interval_hours: data.scheduler_interval_hours, daily_times: data.daily_times }, new Date()),
        cloudinary_transform_enabled: data.cloudinary_transform_enabled,
        cloudinary_transform: data.cloudinary_transform,
        cloudinary_transform_mode: data.cloudinary_transform_mode,
        is_enabled: true,
      })
      .select("id,name")
      .single();
    if (error) throw new Error(error.message);

    if (data.targets.length) {
      const channelById = new Map(channels.map((channel: any) => [channel.id, channel]));
      const { error: targetError } = await context.supabase.from("sheet_mode_channel_targets").insert(
        data.targets.map((target) => {
          const channel = channelById.get(target.channel_id) as any;
          const credential = Array.isArray(channel.buffer_credentials) ? channel.buffer_credentials[0] : channel.buffer_credentials;
          return {
            sheet_id: sheet.id,
            buffer_connection_id: channel.credential_id,
            channel_id: channel.id,
            channel_label: `${credential?.label ?? "Buffer"} · ${channel.name ?? channel.platform}`,
            platform: channel.platform ?? "unknown",
            is_active: true,
            backfill_applied: target.backfill_applied,
            customization: target.customization,
          };
        }),
      );
      if (targetError) throw new Error(targetError.message);
    }
    return { id: sheet.id };
  });

export const updateSheetModeSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sheetSettingsSchema.extend({ id: sheetId }).superRefine(validateSchedulerTimes).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sheet_mode_sheets")
      .update({
        name: data.name,
        rows_per_run: data.rows_per_run,
        schedule_label: data.schedule_label ?? null,
        publish_mode: data.publish_mode,
        custom_schedule_offset_minutes: data.custom_schedule_offset_minutes ?? null,
        custom_schedule_at: data.custom_schedule_at ?? null,
        selection_rule: data.selection_rule,
        after_publish_mark_status: data.after_publish_mark_status,
        after_publish_save_post_id: data.after_publish_save_post_id,
        after_publish_save_time: data.after_publish_save_time,
        after_publish_save_url: data.after_publish_save_url,
        retry_failed: data.retry_failed,
        scheduler_mode: data.scheduler_mode,
        scheduler_interval_hours: data.scheduler_interval_hours,
        daily_times: data.daily_times,
        next_run_at: nextSheetRunAt({ scheduler_mode: data.scheduler_mode, scheduler_interval_hours: data.scheduler_interval_hours, daily_times: data.daily_times }, new Date()),
        cloudinary_transform_enabled: data.cloudinary_transform_enabled,
        cloudinary_transform: data.cloudinary_transform,
        cloudinary_transform_mode: data.cloudinary_transform_mode,
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setSheetModeEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: sheetId, is_enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sheet_mode_sheets")
      .update({ is_enabled: data.is_enabled })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSheetModeSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: sheetId }).parse(d))
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase
      .from("sheet_mode_sheets")
      .delete({ count: "exact" })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Sheet not found");
    return { ok: true };
  });

export const getSheetModeSheet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: sheetId }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.id);
    const [sheetResult, targetsResult, rows] = await Promise.all([
      context.supabase.from("sheet_mode_sheets").select("*").eq("id", data.id).eq("user_id", context.userId).single(),
      context.supabase.from("sheet_mode_channel_targets").select("*").eq("sheet_id", data.id).order("added_at", { ascending: true }),
      selectAll<any>((from, to) =>
        context.supabase
          .from("sheet_mode_rows")
          .select("*")
          .eq("sheet_id", data.id)
          .order("position", { ascending: true })
          .range(from, to) as any,
      ),
    ]);
    if (sheetResult.error) throw new Error(sheetResult.error.message);
    if (targetsResult.error) throw new Error(targetsResult.error.message);

    const statusesByRow = new Map<string, SheetModeChannelStatus[]>();
    for (const batch of chunk(rows.map((row: any) => row.id), 200)) {
      const statuses = await selectAll<SheetModeChannelStatus>((from, to) =>
        context.supabase
          .from("sheet_mode_row_channel_status")
          .select("*")
          .in("row_id", batch)
          .order("row_id", { ascending: true })
          .range(from, to) as any,
      );
      for (const status of statuses) {
        const list = statusesByRow.get(status.row_id) ?? [];
        list.push(status);
        statusesByRow.set(status.row_id, list);
      }
    }
    return {
      sheet: sheetResult.data,
      channel_targets: targetsResult.data ?? [],
      rows: rows.map((row) => ({ ...row, channel_statuses: statusesByRow.get(row.id) ?? [] })),
    };
  });

export const addSheetModeChannelTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId, targets: z.array(targetInput).max(50) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const channels = await getOwnedChannels(context.supabase, context.userId, data.targets.map((target) => target.channel_id));
    const channelById = new Map(channels.map((channel: any) => [channel.id, channel]));
    for (const target of data.targets) {
      const channel = channelById.get(target.channel_id) as any;
      const credential = Array.isArray(channel.buffer_credentials) ? channel.buffer_credentials[0] : channel.buffer_credentials;
      const { data: inserted, error } = await context.supabase.from("sheet_mode_channel_targets").upsert({
        sheet_id: data.sheet_id,
        buffer_connection_id: channel.credential_id,
        channel_id: channel.id,
        channel_label: `${credential?.label ?? "Buffer"} · ${channel.name ?? channel.platform}`,
        platform: channel.platform ?? "unknown",
        is_active: true,
        backfill_applied: target.backfill_applied,
        customization: target.customization,
        removed_at: null,
      }, { onConflict: "sheet_id,buffer_connection_id,channel_id" }).select("id").single();
      if (error) throw new Error(error.message);
      const rows = await selectAll<{ id: string }>((from, to) =>
        context.supabase.from("sheet_mode_rows").select("id").eq("sheet_id", data.sheet_id).order("position", { ascending: true }).range(from, to) as any,
      );
      for (const batch of chunk(rows, 500)) {
        const { error: statusError } = await context.supabase.from("sheet_mode_row_channel_status").upsert(
          batch.map((row) => ({ row_id: row.id, channel_target_id: inserted.id, status: "F" })),
          { onConflict: "row_id,channel_target_id" },
        );
        if (statusError) throw new Error(statusError.message);
      }
    }
    return { ok: true };
  });

export const updateSheetModeChannelCustomization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId, target_id: z.string().uuid(), customization: customizationSchema }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const { data: target, error: targetError } = await context.supabase
      .from("sheet_mode_channel_targets")
      .select("platform")
      .eq("id", data.target_id)
      .eq("sheet_id", data.sheet_id)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("Channel target not found");
    const customization = validateCustomization(target.platform, data.customization);
    const { data: updated, error } = await context.supabase
      .from("sheet_mode_channel_targets")
      .update({ customization })
      .eq("id", data.target_id)
      .eq("sheet_id", data.sheet_id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Channel target not found");
    return updated;
  });

export const removeSheetModeChannelTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId, target_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const { error } = await context.supabase
      .from("sheet_mode_channel_targets")
      .update({ is_active: false, removed_at: new Date().toISOString() })
      .eq("id", data.target_id)
      .eq("sheet_id", data.sheet_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createSheetModeRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId, ...rowValues.shape }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const { data: lastRow, error: lastError } = await context.supabase
      .from("sheet_mode_rows")
      .select("position")
      .eq("sheet_id", data.sheet_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw new Error(lastError.message);
    const { data: row, error } = await context.supabase
      .from("sheet_mode_rows")
      .insert({ sheet_id: data.sheet_id, position: (lastRow?.position ?? 0) + 1, caption: data.caption, video_url: data.video_url, priority: data.priority, weight: data.weight })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const { data: targets, error: targetError } = await context.supabase.from("sheet_mode_channel_targets").select("id,backfill_applied").eq("sheet_id", data.sheet_id).eq("is_active", true);
    if (targetError) throw new Error(targetError.message);
    if (targets?.length) {
      const { error: statusError } = await context.supabase.from("sheet_mode_row_channel_status").insert(targets.map((target) => ({ row_id: row.id, channel_target_id: target.id, status: "F" })));
      if (statusError) throw new Error(statusError.message);
    }
    return row;
  });

export const updateSheetModeRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: rowId, ...rowValues.shape }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("sheet_mode_rows")
      .update({ caption: data.caption, video_url: data.video_url, priority: data.priority, weight: data.weight })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Row not found");
    return row;
  });

export const deleteSheetModeRow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: rowId }).parse(d))
  .handler(async ({ data, context }) => {
    const { error, count } = await context.supabase.from("sheet_mode_rows").delete({ count: "exact" }).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("Row not found");
    return { ok: true };
  });

export const updateSheetModeChannelCell = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), status: z.enum(["F", "T"]), published_url: z.string().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: current, error: currentError } = await context.supabase
      .from("sheet_mode_row_channel_status")
      .select("row_id")
      .eq("id", data.id)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!current) throw new Error("Channel cell not found");
    const { data: updated, error } = await context.supabase
      .from("sheet_mode_row_channel_status")
      .update({ status: data.status, published_url: data.published_url })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Channel cell not found");
    await recalculateRowStatus(context.supabase, current.row_id);
    return updated;
  });


const importRowSchema = z.object({
  caption: z.string().max(20000),
  video_url: z.string().max(2000),
  priority: z.number().int().nullable().optional(),
  weight: z.number().int().min(0).nullable().optional(),
});

const cellType = z.enum(["caption", "video_url", "status", "published_url"]);

function validateCellValue(type: z.infer<typeof cellType>, value: string) {
  const trimmed = value.trim();
  if ((type === "video_url" || type === "published_url") && trimmed && !/^https?:\/\//i.test(trimmed)) return "Value must start with http:// or https://";
  if (type === "caption" && trimmed && /^https?:\/\/\S+$/i.test(trimmed)) return "Caption cannot be only a bare URL";
  if (type === "status" && trimmed !== "F" && trimmed !== "T") return "Status must be F or T";
  return null;
}

async function insertImportedRows(sb: any, sheetIdValue: string, rows: Array<{ caption: string; video_url: string; priority?: number | null; weight?: number | null }>) {
  const { data: targets, error: targetError } = await sb.from("sheet_mode_channel_targets").select("id").eq("sheet_id", sheetIdValue).eq("is_active", true);
  if (targetError) throw new Error(targetError.message);
  const { data: last, error: lastError } = await sb.from("sheet_mode_rows").select("position").eq("sheet_id", sheetIdValue).order("position", { ascending: false }).limit(1).maybeSingle();
  if (lastError) throw new Error(lastError.message);
  const payload = rows.map((row, index) => ({ sheet_id: sheetIdValue, position: (last?.position ?? 0) + index + 1, caption: row.caption, video_url: row.video_url, priority: row.priority ?? null, weight: row.weight ?? null, status: "pending" }));
  if (!payload.length) return { inserted: 0 };
  // Chunked so a 3000+ row import never sends one oversized statement.
  let insertedCount = 0;
  for (const batch of chunk(payload, 500)) {
    const { data: inserted, error } = await sb.from("sheet_mode_rows").insert(batch).select("id");
    if (error) throw new Error(error.message);
    insertedCount += inserted?.length ?? 0;
    if ((targets ?? []).length && (inserted ?? []).length) {
      const pairs = (inserted ?? []).flatMap((row: { id: string }) =>
        (targets ?? []).map((target: { id: string }) => ({ row_id: row.id, channel_target_id: target.id, status: "F" })),
      );
      for (const statusBatch of chunk(pairs, 500)) {
        const { error: statusError } = await sb.from("sheet_mode_row_channel_status").insert(statusBatch);
        if (statusError) throw new Error(statusError.message);
      }
    }
  }
  return { inserted: insertedCount };
}

export const importSheetModeRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId, rows: z.array(importRowSchema).max(5000), allow_partial: z.boolean().optional().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const errors: Array<{ row: number; message: string }> = [];
    const seen = new Set<string>();
    const valid: Array<{ caption: string; video_url: string; priority?: number | null; weight?: number | null }> = [];
    data.rows.forEach((row, index) => {
      const urlError = validateCellValue("video_url", row.video_url);
      const captionError = validateCellValue("caption", row.caption);
      const missingUrl = !row.video_url.trim();
      if (urlError || captionError || (missingUrl && !data.allow_partial)) {
        errors.push({ row: index + 1, message: urlError ?? captionError ?? "Video URL is required" });
        return;
      }
      if (data.allow_partial && missingUrl && !row.caption.trim()) {
        errors.push({ row: index + 1, message: "Row is empty" });
        return;
      }
      const key = row.video_url.trim().toLowerCase();
      if (key) {
        if (seen.has(key)) { errors.push({ row: index + 1, message: "Duplicate video URL" }); return; }
        seen.add(key);
      }
      valid.push({ ...row, caption: row.caption.trim(), video_url: row.video_url.trim() });
    });
    const result = await insertImportedRows(context.supabase, data.sheet_id, valid);
    return { ...result, skipped: errors.length, errors };
  });


export const removeEmptySheetModeRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const { data: rows, error } = await context.supabase.from("sheet_mode_rows").select("id,caption,video_url").eq("sheet_id", data.sheet_id);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).filter((row) => !row.caption.trim() && !row.video_url.trim()).map((row) => row.id);
    if (ids.length) { const result = await context.supabase.from("sheet_mode_rows").delete().in("id", ids); if (result.error) throw new Error(result.error.message); }
    return { removed: ids.length };
  });

export const removeDuplicateSheetModeRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const { data: rows, error } = await context.supabase.from("sheet_mode_rows").select("id,video_url,position").eq("sheet_id", data.sheet_id).order("position", { ascending: true });
    if (error) throw new Error(error.message);
    const seen = new Set<string>(); const ids: string[] = [];
    for (const row of rows ?? []) { const key = row.video_url.trim().toLowerCase(); if (!key) continue; if (seen.has(key)) ids.push(row.id); else seen.add(key); }
    for (const batch of chunk(ids, 500)) {
      const result = await context.supabase.from("sheet_mode_rows").delete().in("id", batch);
      if (result.error) throw new Error(result.error.message);
    }
    return { removed: ids.length };
  });

export const retryFailedSheetModeRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const { data: rows, error } = await context.supabase.from("sheet_mode_rows").select("id").eq("sheet_id", data.sheet_id);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((row) => row.id);
    for (const batch of chunk(ids, 500)) {
      const result = await context.supabase
        .from("sheet_mode_row_channel_status")
        .update({ status: "F", last_error: null })
        .in("row_id", batch)
        .not("last_error", "is", null);
      if (result.error) throw new Error(result.error.message);
    }
    return { reset: ids.length };
  });

export const publishNextSheetMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    return runSheetModeCycle(context.supabase, data.sheet_id, "manual", `manual-${crypto.randomUUID()}`);
  });

export const bulkUpdateSheetModeCells = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId, column: cellType, row_ids: z.array(rowId).min(1).max(5000), mode: z.enum(["clear", "overwrite", "add"]), value: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const values = data.mode === "clear" ? data.row_ids.map(() => "") : (data.mode === "add" ? (data.value ?? "").split(/\r?\n/) : data.row_ids.map(() => data.value ?? ""));
    if (data.mode !== "clear" && !values.length) throw new Error("A value is required");
    const { data: scopedRows, error: scopedRowsError } = await context.supabase
      .from("sheet_mode_rows")
      .select("id")
      .eq("sheet_id", data.sheet_id)
      .in("id", data.row_ids);
    if (scopedRowsError) throw new Error(scopedRowsError.message);
    const scopedRowIds = new Set((scopedRows ?? []).map((row: { id: string }) => row.id));
    const outOfScope = data.row_ids.filter((id) => !scopedRowIds.has(id));
    if (outOfScope.length) throw new Error("One or more selected rows do not belong to this sheet");
    const errors: Array<{ row_id: string; message: string }> = [];
    const changed: string[] = [];
    for (let index = 0; index < data.row_ids.length; index++) {
      const value = values[data.mode === "add" ? index : 0] ?? "";
      const validation = validateCellValue(data.column, value);
      if (validation) { errors.push({ row_id: data.row_ids[index], message: validation }); continue; }
      const rowIdValue = data.row_ids[index];
      if (data.column === "caption" || data.column === "video_url") {
        const update = data.column === "caption" ? { caption: value } : { video_url: value };
        const result = await context.supabase.from("sheet_mode_rows").update(update).eq("id", rowIdValue).eq("sheet_id", data.sheet_id);
        if (result.error) throw new Error(result.error.message);
      } else {
        const { data: statuses, error } = await context.supabase.from("sheet_mode_row_channel_status").select("id").eq("row_id", rowIdValue);
        if (error) throw new Error(error.message);
        const update = data.column === "status" ? { status: value } : { published_url: value || null };
        if ((statuses ?? []).length) { const result = await context.supabase.from("sheet_mode_row_channel_status").update(update).eq("row_id", rowIdValue); if (result.error) throw new Error(result.error.message); }
      }
      changed.push(rowIdValue);
    }
    return { changed: changed.length, skipped: errors.length, errors };
  });


const fillLinesSchema = z.object({ sheet_id: sheetId, lines: z.array(z.string().max(20000)).min(1).max(5000) });

async function fillSheetModeColumn(sb: any, sheetIdValue: string, column: "caption" | "video_url", lines: string[]) {
  const { data: rows, error } = await sb.from("sheet_mode_rows").select("id,sheet_id,position,caption,video_url,priority,weight,status").eq("sheet_id", sheetIdValue).order("position", { ascending: true });
  if (error) throw new Error(error.message);
  const skipped: Array<{ line: number; message: string }> = [];
  const valid: string[] = [];
  lines.forEach((raw, index) => {
    const value = raw.trim();
    const issue = validateCellValue(column, value);
    if (issue || !value) skipped.push({ line: index + 1, message: issue ?? `${column === "caption" ? "Caption" : "URL"} cannot be empty` });
    else valid.push(value);
  });
  const emptyRows = (rows ?? []).filter((row: any) => !String(row[column] ?? "").trim());
  const updates = valid.slice(0, emptyRows.length);
  for (const batch of chunk(updates.map((value, index) => ({ row: emptyRows[index], value })), 500)) {
    const payload = batch.map(({ row, value }) => ({
      id: row.id,
      sheet_id: row.sheet_id,
      position: row.position,
      caption: column === "caption" ? value : row.caption,
      video_url: column === "video_url" ? value : row.video_url,
      priority: row.priority,
      weight: row.weight,
      status: row.status,
    }));
    const result = await sb.from("sheet_mode_rows").upsert(payload, { onConflict: "id" });
    if (result.error) throw new Error(result.error.message);
  }
  const filled = updates.length;
  const overflow = valid.slice(updates.length);
  const inserted = await insertImportedRows(
    sb,
    sheetIdValue,
    overflow.map((value) => ({ caption: column === "caption" ? value : "", video_url: column === "video_url" ? value : "" })),
  );
  return { filled, created: inserted.inserted, skipped: skipped.length, errors: skipped };
}

export const fillSheetModeCaptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fillLinesSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    return fillSheetModeColumn(context.supabase, data.sheet_id, "caption", data.lines);
  });

export const fillSheetModeUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => fillLinesSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    return fillSheetModeColumn(context.supabase, data.sheet_id, "video_url", data.lines);
  });

export const fillAllSheetModeCaptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ sheet_id: sheetId, caption: z.string().trim().min(1).max(20000), scope: z.enum(["empty", "all"]).default("empty") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const issue = validateCellValue("caption", data.caption);
    if (issue) throw new Error(issue);
    const { data: rows, error } = await context.supabase
      .from("sheet_mode_rows")
      .select("id,caption")
      .eq("sheet_id", data.sheet_id);
    if (error) throw new Error(error.message);
    const targets = (rows ?? []).filter((row) => (data.scope === "all" ? true : !String(row.caption ?? "").trim()));
    if (!targets.length) return { filled: 0 };
    const result = await context.supabase
      .from("sheet_mode_rows")
      .update({ caption: data.caption })
      .eq("sheet_id", data.sheet_id)
      .in("id", targets.map((row) => row.id));
    if (result.error) throw new Error(result.error.message);
    return { filled: targets.length };
  });

export const clearSheetModeRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ sheet_id: sheetId }).parse(d))
  .handler(async ({ data, context }) => {
    await assertSheetOwner(context.supabase, context.userId, data.sheet_id);
    const { data: rows, error } = await context.supabase
      .from("sheet_mode_rows")
      .select("id")
      .eq("sheet_id", data.sheet_id);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((row) => row.id);
    if (!ids.length) return { removed: 0 };
    const statusResult = await context.supabase.from("sheet_mode_row_channel_status").delete().in("row_id", ids);
    if (statusResult.error) throw new Error(statusResult.error.message);
    const rowResult = await context.supabase.from("sheet_mode_rows").delete().eq("sheet_id", data.sheet_id);
    if (rowResult.error) throw new Error(rowResult.error.message);
    return { removed: ids.length };
  });
