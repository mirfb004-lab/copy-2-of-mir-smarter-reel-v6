import { withRetry, audit, makeIdempotencyKey } from "./reliability.server";
import { makeBufferClient, resolveBufferCredential } from "./buffer.server";
import { applyCloudinaryTransform, isCloudinaryDeliveryUrl } from "./cloudinary-transform";

function resolveFormulaDueAt(schedule: { publish_mode: string; custom_schedule_offset_minutes: number | null; custom_schedule_at: string | null }) {
  if (schedule.publish_mode !== "customScheduled") return null;
  if (schedule.custom_schedule_at) return schedule.custom_schedule_at;
  if (schedule.custom_schedule_offset_minutes != null) {
    return new Date(Date.now() + schedule.custom_schedule_offset_minutes * 60_000).toISOString();
  }
  throw new Error("Custom schedule requires a date/time or relative offset");
}

type Sb = any;

function nextRunAt(now: Date, intervalHours: number) {
  return new Date(now.getTime() + intervalHours * 60 * 60 * 1000).toISOString();
}
function nextFormulaRunAt(schedule: any, now: Date, retry = false) {
  if (schedule.scheduler_mode === "manual") return null;
  if (retry) return new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  if (schedule.scheduler_mode === "daily_times") {
    const times = [...(schedule.daily_times ?? [])].sort();
    for (const time of times) {
      const [hour, minute] = String(time).split(":").map(Number);
      if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue;
      const candidate = new Date(now);
      candidate.setUTCHours(hour, minute, 0, 0);
      if (candidate.getTime() > now.getTime()) return candidate.toISOString();
    }
    const [hour, minute] = String(times[0] ?? "00:00").split(":").map(Number);
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(hour || 0, minute || 0, 0, 0);
    return tomorrow.toISOString();
  }
  return nextRunAt(now, Number(schedule.interval_hours));
}

async function nextRunNumber(sb: Sb, userId: string) {
  const { data } = await sb.from("runs").select("run_number").eq("user_id", userId).order("run_number", { ascending: false }).limit(1).maybeSingle();
  return Number(data?.run_number ?? 0) + 1;
}

export async function runReelFormulaSchedule(sb: Sb, scheduleId: string, slotKey: string) {
  const { data: schedule, error: scheduleError } = await sb.from("recurring_schedules")
    .select("*,channels(*,buffer_credentials(*)),recurring_schedule_items!recurring_schedule_items_schedule_id_fkey(*)")
    .eq("id", scheduleId).maybeSingle();
  if (scheduleError) throw new Error(scheduleError.message);
  if (!schedule || !schedule.is_active) return { skipped: true, reason: "inactive" };

  const idempotencyKey = makeIdempotencyKey(["1-reel-formula", schedule.id, slotKey]);
  let { data: run } = await sb.from("runs").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (run?.status === "complete") return { runId: run.id, skipped: true, reason: "already_complete" };
  if (!run) {
    const runNumber = await nextRunNumber(sb, schedule.user_id);
    const { data: created, error } = await sb.from("runs").insert({
      user_id: schedule.user_id,
      campaign_id: schedule.campaign_id,
      channel_id: schedule.channel_id,
      queue_item_id: null,
      run_number: runNumber,
      status: "publishing",
      current_step: "formula_preflight",
      idempotency_key: idempotencyKey,
      strategy_used: "1_reel_formula",
      step_state: { recurring_schedule_id: schedule.id, slot_key: slotKey, step: "preflight" },
    }).select("*").single();
    if (error) {
      const { data: existing } = await sb.from("runs").select("*").eq("user_id", schedule.user_id).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (!existing) throw new Error(`formula run create: ${error.message}`);
      run = existing;
    } else {
      run = created;
    }
  }

  if (run.status === "complete") return { runId: run.id, skipped: true, reason: "already_complete" };
  const { data: claimed, error: claimError } = await sb.rpc("claim_recurring_schedule_slot", {
    _schedule_id: schedule.id,
    _slot_key: slotKey,
    _run_id: run.id,
    _now: new Date().toISOString(),
  });
  if (claimError) throw new Error(`formula slot claim: ${claimError.message}`);
  if (!claimed) return { skipped: true, reason: "already_claimed" };

  const startedAt = new Date(run.started_at ?? Date.now()).getTime();
  try {
    const channel = schedule.channels;
    if (!channel) throw new Error("Formula channel not found");
    const credential = await resolveBufferCredential(sb, schedule.user_id, schedule.campaign_id, channel.buffer_credentials);
    const buffer = makeBufferClient(credential.api_token, credential.graphql_endpoint);
    const connection = await buffer.testConnection();
    if (!connection.ok) throw new Error(`Buffer pre-flight failed: ${connection.message}`);
    const schema = await buffer.verifySchema();
    if (!schema.ok || !schema.hasCreatePost) throw new Error(`Buffer schema pre-flight failed: ${schema.message}`);
    await audit(sb, { userId: schedule.user_id, runId: run.id, eventType: "formula.preflight.ok", module: "reel_formula", status: "success", payload: { connection: connection.message, schema: schema.message } });
    await sb.from("runs").update({ current_step: "formula_publish", heartbeat_at: new Date().toISOString(), step_state: { recurring_schedule_id: schedule.id, slot_key: slotKey, step: "publish" } }).eq("id", run.id);

    const items = schedule.mode === "multiple" ? [...(schedule.recurring_schedule_items ?? [])].sort((a: any, b: any) => a.position - b.position) : [];
    let rotationItem = null as any;
    if (schedule.mode === "multiple") {
      if (!items.length) throw new Error("Multiple-mode schedule has no rotation items");
      rotationItem = items.find((item: any) => item.id === schedule.last_published_item_id) ?? null;
      const currentIndex = rotationItem ? items.findIndex((item: any) => item.id === rotationItem.id) : -1;
      rotationItem = items[(currentIndex + 1 + items.length) % items.length] ?? items[0];
    }
    const formulaOptions = {
      postType: schedule.post_type,
      shareToFeed: schedule.share_to_feed,
      thumbnailTimestamp: Number(schedule.thumbnail_timestamp ?? 0),
      privacyLevel: schedule.privacy_level,
      allowComments: schedule.allow_comments,
      allowDuet: schedule.allow_duet,
      allowStitch: schedule.allow_stitch,
    };
    const sourceMediaUrl = rotationItem?.media_url ?? schedule.media_url;
    let publishMediaUrl = sourceMediaUrl;
    if (schedule.cloudinary_transform_enabled && isCloudinaryDeliveryUrl(sourceMediaUrl)) {
      const transformed = applyCloudinaryTransform(sourceMediaUrl, schedule.cloudinary_transform, schedule.cloudinary_transform_mode);
      if (transformed.error) throw new Error(`Cloudinary transformation failed: ${transformed.error}`);
      publishMediaUrl = transformed.url;
    }
    const existingBufferPostId = (run.step_state as any)?.buffer_post_id as string | undefined;
    const existingProof = existingBufferPostId ? await buffer.getPostProof(existingBufferPostId) : null;
    const published = existingProof ?? await withRetry("buffer", async (attempt) => {
      await audit(sb, { userId: schedule.user_id, runId: run.id, eventType: "formula.publish.attempt", module: "reel_formula", status: "info", attempt, payload: { schedule_id: schedule.id, slot_key: slotKey } });
      return buffer.createPost({
        channelId: channel.buffer_channel_id,
          text: rotationItem?.caption ?? schedule.caption ?? "",
          mediaUrl: publishMediaUrl,
        mode: schedule.publish_mode,
        dueAt: resolveFormulaDueAt(schedule),
        platform: schedule.platform,
        formula: formulaOptions,
      });
    }, async (attempt, error, durationMs) => {
      await audit(sb, { userId: schedule.user_id, runId: run.id, eventType: error ? "formula.publish.retry" : "formula.publish.response", module: "buffer", status: error ? "error" : "success", attempt, durationMs, error: error instanceof Error ? error.message : error ? String(error) : null });
    });
    if (!published.postId) throw new Error("Buffer did not return a post id");
    await sb.from("runs").update({ step_state: { recurring_schedule_id: schedule.id, slot_key: slotKey, step: "persist", buffer_post_id: published.postId } }).eq("id", run.id);
    const { error: postError } = await sb.from("published_posts").insert({
      run_id: run.id,
      user_id: schedule.user_id,
      campaign_id: schedule.campaign_id,
      channel_id: schedule.channel_id,
      buffer_post_id: published.postId,
      platform: schedule.platform,
      posted_at: published.sentAt,
      raw: published.raw,
      source: "1_reel_formula",
      text_content: schedule.caption ?? "",
      buffer_status: published.status,
      due_at: published.dueAt,
      permalink: published.permalink,
      verified_at: published.verified ? new Date().toISOString() : null,
    });
    if (postError) throw new Error(`formula post history: ${postError.message}`);
    const { recordFormulaRunInsight } = await import("./formula-insights.server");
    await recordFormulaRunInsight(sb, {
      runId: run.id,
      recurringScheduleId: schedule.id,
      bufferPostId: published.postId,
      postType: schedule.platform === "instagram" ? schedule.post_type : schedule.post_type,
      platform: schedule.platform,
    });
    const finish = new Date().toISOString();
    await sb.from("runs").update({ status: "complete", current_step: "complete", finished_at: finish, duration_ms: Date.now() - startedAt, heartbeat_at: finish, step_state: { recurring_schedule_id: schedule.id, slot_key: slotKey, step: "complete", buffer_post_id: published.postId } }).eq("id", run.id);
    await sb.from("recurring_schedules").update({
      last_run_at: finish,
      last_run_id: run.id,
      next_run_at: nextFormulaRunAt(schedule, new Date()),
      last_published_item_id: schedule.mode === "multiple" ? rotationItem?.id ?? null : null,
      last_error: null,
    }).eq("id", schedule.id);
    await audit(sb, { userId: schedule.user_id, runId: run.id, eventType: "formula.run.completed", module: "reel_formula", status: "success", durationMs: Date.now() - startedAt,       payload: { post_id: published.postId, schedule_id: schedule.id, mode: schedule.mode ?? "single", rotation_item_id: rotationItem?.id ?? null } });
    return { runId: run.id, postId: published.postId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finish = new Date().toISOString();
    await sb.from("runs").update({ status: "failed", current_step: "failed", error: message, finished_at: finish, duration_ms: Date.now() - startedAt, step_state: { recurring_schedule_id: schedule.id, slot_key: slotKey, step: "failed" } }).eq("id", run.id);
    await sb.from("recurring_schedules").update({ last_run_at: finish, last_run_id: run.id, next_run_at: nextFormulaRunAt(schedule, new Date(), true), last_error: message }).eq("id", schedule.id);
    await audit(sb, { userId: schedule.user_id, runId: run.id, eventType: "formula.run.failed", module: "reel_formula", status: "error", durationMs: Date.now() - startedAt, error: message, payload: { schedule_id: schedule.id, slot_key: slotKey } });
    throw error;
  }
}
