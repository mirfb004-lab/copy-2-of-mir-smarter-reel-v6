import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { applyCloudinaryTransform, isCloudinaryDeliveryUrl } from "./cloudinary-transform";
import { makeBufferClient, resolveBufferCredential } from "./buffer.server";
import { audit, makeIdempotencyKey, withRetry } from "./reliability.server";

type Sb = SupabaseClient;
type Sheet = {
  id: string;
  user_id: string;
  name: string;
  rows_per_run: number;
  publish_mode: "shareNow" | "addToQueue" | "customScheduled";
  custom_schedule_offset_minutes: number | null;
  custom_schedule_at: string | null;
  selection_rule: string;
  after_publish_mark_status: boolean;
  after_publish_save_post_id: boolean;
  after_publish_save_time: boolean;
  after_publish_save_url: boolean;
  retry_failed: boolean;
  is_enabled: boolean;
  scheduler_mode: "every_x_hours" | "daily_times" | "manual";
  scheduler_interval_hours: number;
  daily_times: string[];
  next_run_at: string | null;
  cloudinary_transform_enabled: boolean;
  cloudinary_transform: string;
  cloudinary_transform_mode: "replace" | "stack";
};
type Target = {
  id: string;
  sheet_id: string;
  buffer_connection_id: string;
  channel_id: string;
  channel_label: string;
  platform: string;
  is_active: boolean;
  backfill_applied: boolean;
  customization: Record<string, unknown>;
  added_at: string;
  channel: any;
};
type Row = {
  id: string;
  sheet_id: string;
  created_at: string;
  position: number;
  caption: string;
  video_url: string;
  priority: number | null;
  weight: number | null;
  status: string;
  channel_statuses: Array<{
    id: string;
    channel_target_id: string;
    status: "F" | "T";
    published_post_id: string | null;
    published_url: string | null;
    published_at: string | null;
    last_error: string | null;
    last_attempt_at: string | null;
  }>;
};

const STALE_MS = 15 * 60 * 1000;

function bucketKey(now: Date) {
  return new Date(Math.floor(now.getTime() / 300_000) * 300_000).toISOString();
}
export function nextSheetRunAt(sheet: Pick<Sheet, "scheduler_mode" | "scheduler_interval_hours" | "daily_times">, now: Date) {
  if (sheet.scheduler_mode === "manual") return null;
  if (sheet.scheduler_mode === "every_x_hours") {
    const hours = Number(sheet.scheduler_interval_hours ?? 0);
    return new Date(now.getTime() + (hours > 0 ? hours * 3_600_000 : 300_000)).toISOString();
  }
  const times = [...(sheet.daily_times ?? [])].sort();
  for (const time of times) {
    const [hour, minute] = time.split(":").map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue;
    const candidate = new Date(now);
    candidate.setUTCHours(hour, minute, 0, 0);
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  const [firstHour, firstMinute] = (times[0] ?? "00:00").split(":").map(Number);
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(firstHour || 0, firstMinute || 0, 0, 0);
  return tomorrow.toISOString();
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function resolveSheetDueAt(sheet: Sheet) {
  if (sheet.publish_mode !== "customScheduled") return null;
  if (sheet.custom_schedule_at) return sheet.custom_schedule_at;
  if (sheet.custom_schedule_offset_minutes != null)
    return new Date(Date.now() + sheet.custom_schedule_offset_minutes * 60_000).toISOString();
  throw new Error("Custom schedule requires a date/time or relative offset");
}

async function nextRunNumber(sb: Sb, userId: string) {
  const { data } = await sb
    .from("runs")
    .select("run_number")
    .eq("user_id", userId)
    .order("run_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return Number(data?.run_number ?? 0) + 1;
}

async function loadSheet(sb: Sb, sheetId: string, userId?: string): Promise<Sheet> {
  let query = sb.from("sheet_mode_sheets").select("*").eq("id", sheetId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sheet not found");
  return data as Sheet;
}

async function loadTargets(sb: Sb, sheetId: string): Promise<Target[]> {
  const { data, error } = await sb
    .from("sheet_mode_channel_targets")
    .select(
      "id,sheet_id,buffer_connection_id,channel_id,channel_label,platform,is_active,backfill_applied,customization,added_at,channels(id,buffer_channel_id,name,platform,buffer_credentials(api_token,graphql_endpoint))",
    )
    .eq("sheet_id", sheetId)
    .eq("is_active", true)
    .order("added_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((target: any) => ({
    ...target,
    channel: Array.isArray(target.channels) ? target.channels[0] : target.channels,
  })) as Target[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function ensureChannelStatusRows(sb: Sb, sheetId: string, targets: Target[]) {
  if (!targets.length) return;
  const { data: rows, error: rowError } = await sb.from("sheet_mode_rows").select("id").eq("sheet_id", sheetId);
  if (rowError) throw new Error(rowError.message);
  const pairs = (rows ?? []).flatMap((row: { id: string }) => targets.map((target) => ({ row_id: row.id, channel_target_id: target.id, status: "F" })));
  if (!pairs.length) return;
  for (const batch of chunk(pairs, 500)) {
    const { error } = await sb.from("sheet_mode_row_channel_status").upsert(batch, {
      onConflict: "row_id,channel_target_id",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  }
}

async function loadRows(sb: Sb, sheetId: string): Promise<Row[]> {
  const { data: rows, error } = await sb
    .from("sheet_mode_rows")
    .select("*")
    .eq("sheet_id", sheetId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  if (!rows?.length) return [];
  // Chunked: a single .in() with hundreds of ids blows past the request URL
  // length limit and PostgREST answers "Bad Request".
  const statuses: any[] = [];
  for (const batch of chunk(rows.map((row) => row.id), 100)) {
    const { data, error: statusError } = await sb
      .from("sheet_mode_row_channel_status")
      .select("*")
      .in("row_id", batch);
    if (statusError) throw new Error(statusError.message);
    statuses.push(...(data ?? []));
  }
  const byRow = new Map<string, Row["channel_statuses"]>();
  for (const status of statuses)
    byRow.set(status.row_id, [...(byRow.get(status.row_id) ?? []), status]);
  return rows.map((row) => ({ ...row, channel_statuses: byRow.get(row.id) ?? [] })) as Row[];
}


function targetEligibleForRow(row: Row, target: Target) {
  if (!target.is_active) return false;
  if (target.backfill_applied) return true;
  return new Date(row.created_at).getTime() >= new Date(target.added_at).getTime();
}

function eligible(row: Row, targets: Target[]) {
  const eligibleIds = new Set(
    targets.filter((target) => targetEligibleForRow(row, target)).map((target) => target.id),
  );
  return row.channel_statuses.some(
    (cell) => eligibleIds.has(cell.channel_target_id) && cell.status === "F",
  );
}

function sortRows(rows: Row[], rule: string) {
  const copy = [...rows];
  if (rule === "highest_priority")
    return copy.sort((a, b) => (b.priority ?? -Infinity) - (a.priority ?? -Infinity));
  if (rule === "lowest_priority")
    return copy.sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
  if (rule === "newest_created") return copy.reverse();
  if (rule === "oldest_created") return copy;
  if (rule === "random_ready" || rule === "weighted_random")
    return copy.sort(() => Math.random() - 0.5);
  return copy.sort((a, b) => a.position - b.position);
}

async function recalculateRowStatus(sb: Sb, rowId: string, activeTargetIds: Set<string>) {
  const { data: statuses, error } = await sb
    .from("sheet_mode_row_channel_status")
    .select("channel_target_id,status")
    .eq("row_id", rowId);
  if (error) throw new Error(error.message);
  const active = (statuses ?? []).filter((status) => activeTargetIds.has(status.channel_target_id));
  const done = active.filter((status) => status.status === "T").length;
  const next =
    active.length === 0 || done === 0 ? "pending" : done === active.length ? "complete" : "partial";
  const { error: updateError } = await sb
    .from("sheet_mode_rows")
    .update({ status: next })
    .eq("id", rowId);
  if (updateError) throw new Error(updateError.message);
}

async function createRun(sb: Sb, sheet: Sheet, idempotencyKey: string) {
  const { data: existing } = await sb
    .from("runs")
    .select("*")
    .eq("user_id", sheet.user_id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await sb
    .from("runs")
    .insert({
      user_id: sheet.user_id,
      campaign_id: null,
      channel_id: null,
      queue_item_id: null,
      run_number: await nextRunNumber(sb, sheet.user_id),
      status: "publishing",
      current_step: "sheet_mode_preflight",
      heartbeat_at: new Date().toISOString(),

      idempotency_key: idempotencyKey,
      strategy_used: "sheet_mode",
      step_state: { sheet_id: sheet.id, step: "preflight" },
    })
    .select("*")
    .single();
  if (error) {
    const { data: raced } = await sb
      .from("runs")
      .select("*")
      .eq("user_id", sheet.user_id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (raced) return raced;
    throw new Error(`sheet mode run create: ${error.message}`);
  }
  return data;
}

async function publishChannel(
  sb: Sb,
  sheet: Sheet,
  row: Row,
  target: Target,
  statusId: string,
  runId: string,
) {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data: claimed, error: claimError } = await supabaseAdmin.rpc("claim_sheet_mode_channel", {
    _row_id: row.id,
    _channel_target_id: target.id,
    _now: now,
    _stale_before: staleBefore,
  });
  if (claimError) throw new Error(`sheet mode channel claim: ${claimError.message}`);
  if (!claimed) return { skipped: true };
  const started = Date.now();
  try {
    const channel = target.channel;
    if (!channel?.buffer_channel_id)
      throw new Error(`Buffer channel missing for ${target.channel_label}`);
    const channelCredential = Array.isArray(channel.buffer_credentials)
      ? channel.buffer_credentials[0]
      : channel.buffer_credentials;
    const credential = await resolveBufferCredential(sb, sheet.user_id, null, channelCredential);
    const buffer = makeBufferClient(credential.api_token, credential.graphql_endpoint);
    const connection = await buffer.testConnection();
    if (!connection.ok) throw new Error(`Buffer pre-flight failed: ${connection.message}`);
    const schema = await buffer.verifySchema();
    if (!schema.ok || !schema.hasCreatePost)
      throw new Error(`Buffer schema pre-flight failed: ${schema.message}`);
    let publishMediaUrl = row.video_url;
    if (sheet.cloudinary_transform_enabled && isCloudinaryDeliveryUrl(row.video_url)) {
      const transformed = applyCloudinaryTransform(row.video_url, sheet.cloudinary_transform, sheet.cloudinary_transform_mode);
      if (transformed.error) throw new Error(`Cloudinary transformation failed: ${transformed.error}`);
      publishMediaUrl = transformed.url;
    }
    const published = await withRetry(
      "buffer",
      (attempt) => {
        return buffer.createPost({
          channelId: channel.buffer_channel_id,
          text: row.caption,
          mediaUrl: publishMediaUrl,
          mode: sheet.publish_mode,
          dueAt: resolveSheetDueAt(sheet),
          platform: target.platform,
          formula: { isAiGenerated: false, ...(target.customization ?? {}) } as any,
        });
      },
      async (attempt, error, durationMs) => {
        await audit(sb, {
          userId: sheet.user_id,
          runId,
          eventType: error ? "sheet_mode.publish.retry" : "sheet_mode.publish.response",
          module: "sheet_mode",
          status: error ? "error" : "success",
          attempt,
          durationMs,
          error: error ? errorMessage(error) : null,
          payload: { sheet_id: sheet.id, row_id: row.id, channel_target_id: target.id },
        });
      },
    );
    const updates: Record<string, unknown> = {
      status: "T",
      last_error: null,
      last_attempt_at: now,
    };
    if (sheet.after_publish_save_post_id) updates.published_post_id = published.postId;
    if (sheet.after_publish_save_url) updates.published_url = published.permalink;
    if (sheet.after_publish_save_time) updates.published_at = published.sentAt ?? now;
    const { error: statusError } = await sb
      .from("sheet_mode_row_channel_status")
      .update(updates)
      .eq("id", statusId)
      .eq("row_id", row.id);
    if (statusError) throw new Error(statusError.message);
    const { error: postHistoryError } = await sb.from("published_posts").insert({
      run_id: runId,
      user_id: sheet.user_id,
      campaign_id: null,
      channel_id: target.channel_id,
      buffer_post_id: published.postId,
      platform: target.platform,
      posted_at: published.sentAt,
      raw: published.raw,
      source: "sheet_mode",
      text_content: row.caption,
      buffer_status: published.status,
      due_at: published.dueAt,
      permalink: published.permalink,
      verified_at: published.verified ? new Date().toISOString() : null,
    });
    if (postHistoryError) throw new Error(`sheet mode post history: ${postHistoryError.message}`);
    await audit(sb, {
      userId: sheet.user_id,
      runId,
      eventType: "sheet_mode.channel_completed",
      module: "sheet_mode",
      status: "success",
      durationMs: Date.now() - started,
      payload: {
        sheet_id: sheet.id,
        row_id: row.id,
        channel_target_id: target.id,
        post_id: published.postId,
      },
    });
    return { postId: published.postId };
  } catch (error) {
    const message = errorMessage(error);
    await sb
      .from("sheet_mode_row_channel_status")
      .update({ status: "F", last_error: message, last_attempt_at: now })
      .eq("id", statusId)
      .eq("row_id", row.id);
    await audit(sb, {
      userId: sheet.user_id,
      runId,
      eventType: "sheet_mode.channel_failed",
      module: "sheet_mode",
      status: "error",
      durationMs: Date.now() - started,
      error: message,
      payload: { sheet_id: sheet.id, row_id: row.id, channel_target_id: target.id },
    });
    return { error: message };
  }
}

export async function runSheetModeCycle(
  sb: Sb,
  sheetId: string,
  reason: "manual" | "scheduled" = "scheduled",
  slotKey = bucketKey(new Date()),
) {
  const sheet = await loadSheet(sb, sheetId);
  if (!sheet.is_enabled && reason === "scheduled")
    return { sheetId, skipped: true, reason: "paused" };
  const idempotencyKey = makeIdempotencyKey(["sheet-mode", sheet.id, slotKey]);
  const run = await createRun(sb, sheet, idempotencyKey);
  if (run.status === "complete" && reason === "scheduled")
    return { sheetId, runId: run.id, skipped: true, reason: "already_complete" };
  let targets: Target[];
  let rows: Row[];
  try {
    targets = await loadTargets(sb, sheet.id);
    await ensureChannelStatusRows(sb, sheet.id, targets);
    rows = sortRows(
      (await loadRows(sb, sheet.id)).filter((row) => eligible(row, targets)),
      sheet.selection_rule,
    );
  } catch (error) {
    // Never leave the run row stranded in "publishing" when setup fails.
    const message = errorMessage(error);
    await sb
      .from("runs")
      .update({
        status: "failed",
        current_step: "failed",
        finished_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        error: message,
      })
      .eq("id", run.id);
    throw error;
  }
  const activeTargetIds = new Set(targets.map((target) => target.id));

  let budget = Math.max(1, Number(sheet.rows_per_run ?? 1));
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];
  await audit(sb, {
    userId: sheet.user_id,
    runId: run.id,
    eventType: "sheet_mode.run_started",
    module: "sheet_mode",
    status: "info",
    payload: {
      sheet_id: sheet.id,
      reason,
      slot_key: slotKey,
      rows_considered: rows.length,
      publish_budget: budget,
    },
  });
  try {
    for (const row of rows) {
      if (budget <= 0) break;
      for (const target of targets) {
        if (budget <= 0) break;
        const cell = row.channel_statuses.find(
          (status) => status.channel_target_id === target.id && status.status === "F",
        );
        if (!cell || !targetEligibleForRow(row, target)) continue;
        attempted++;
        budget--;
        const result = await publishChannel(sb, sheet, row, target, cell.id, run.id);
        if (result.skipped) continue;
        if (result.error) {
          failed++;
          errors.push(`${target.channel_label}: ${result.error}`);
        } else succeeded++;
        await recalculateRowStatus(sb, row.id, activeTargetIds);
      }
    }
    if (sheet.after_publish_mark_status)
      for (const row of rows) await recalculateRowStatus(sb, row.id, activeTargetIds);
    const finish = new Date().toISOString();
    await sb
      .from("runs")
      .update({
        status: "complete",
        current_step: "complete",
        finished_at: finish,
        heartbeat_at: finish,
        duration_ms: Date.now() - new Date(run.started_at ?? finish).getTime(),
        error: errors.length ? errors.join("; ") : null,
        step_state: {
          sheet_id: sheet.id,
          reason,
          slot_key: slotKey,
          attempted,
          succeeded,
          failed,
          step: "complete",
        },
      })
      .eq("id", run.id);
    await audit(sb, {
      userId: sheet.user_id,
      runId: run.id,
      eventType: "sheet_mode.run_completed",
      module: "sheet_mode",
      status: errors.length ? "error" : "success",
      payload: { sheet_id: sheet.id, attempted, succeeded, failed, errors },
    });
    return {
      sheetId: sheet.id,
      runId: run.id,
      attempted,
      succeeded,
      failed,
      errors,
      rowsConsidered: rows.length,
      noEligiblePendingChannel: rows.length === 0,
    };
  } catch (error) {
    const message = errorMessage(error);
    await sb
      .from("runs")
      .update({
        status: "failed",
        current_step: "failed",
        finished_at: new Date().toISOString(),
        error: message,
        step_state: {
          sheet_id: sheet.id,
          reason,
          slot_key: slotKey,
          attempted,
          succeeded,
          failed,
          step: "failed",
        },
      })
      .eq("id", run.id);
    await audit(sb, {
      userId: sheet.user_id,
      runId: run.id,
      eventType: "sheet_mode.run_failed",
      module: "sheet_mode",
      status: "error",
      error: message,
      payload: { sheet_id: sheet.id, attempted, succeeded, failed },
    });
    throw error;
  }
}

export async function runDueSheetModeSheets(sb: Sb) {
  const now = new Date();
  const { data: sheets, error } = await sb
    .from("sheet_mode_sheets")
    .select("id,user_id,scheduler_mode,scheduler_interval_hours,daily_times,next_run_at")
    .eq("is_enabled", true)
    .neq("scheduler_mode", "manual")
    .lte("next_run_at", now.toISOString())
    .limit(50);
  if (error) throw new Error(error.message);
  const results: unknown[] = [];
  const slotKey = bucketKey(now);
  for (const sheet of sheets ?? []) {
    const nextRunAt = nextSheetRunAt(sheet as any, now);
    if (!nextRunAt) continue;
    const { data: claimed, error: claimError } = await supabaseAdmin.rpc("claim_sheet_mode_schedule", {
      _sheet_id: sheet.id,
      _now: now.toISOString(),
      _next_run_at: nextRunAt,
    });
    if (claimError) {
      results.push({ sheetId: sheet.id, error: `sheet mode schedule claim: ${claimError.message}` });
      continue;
    }
    if (!claimed) continue;
    try {
      results.push(await runSheetModeCycle(sb, sheet.id, "scheduled", slotKey));
    } catch (error) {
      results.push({ sheetId: sheet.id, error: errorMessage(error) });
    }
  }
  return results;
}
