// 1 Reel Formula — Buffer post insights (server-only).
// Scope: 1 Reel Formula only. Not used by Sheet Mode, Loop Learner or multi-channel.
import { makeBufferClient, resolveBufferCredential, type BufferMetricEntry } from "./buffer.server";

type Sb = any;

// Buffer ingests network metrics on a daily cadence, so a fresh post has nothing
// to read for many hours. Instagram Stories expire at 24h, but Buffer keeps what
// it ingested, so a slightly-late retry is still useful.
// First attempt: 20h after publish (ingestion has had a full cycle, still before expiry).
// Retries: every 3h, up to 3 attempts total (≈20h, 23h, 26h), then give up.
export const STORY_FIRST_SYNC_HOURS = 20;
export const STORY_RETRY_HOURS = 3;
export const STORY_MAX_SYNC_ATTEMPTS = 3;

export function storyFirstSyncDueAt(from: Date = new Date()) {
  return new Date(from.getTime() + STORY_FIRST_SYNC_HOURS * 3_600_000).toISOString();
}

export function isStoryPostType(postType: string | null | undefined) {
  return String(postType ?? "").toLowerCase() === "story";
}

/** Insert the insight row right after a formula run publishes to Buffer. */
export async function recordFormulaRunInsight(sb: Sb, params: {
  runId: string | null;
  recurringScheduleId: string;
  bufferPostId: string;
  postType: string | null;
  platform: string | null;
}) {
  const story = isStoryPostType(params.postType);
  try {
    await sb.from("formula_run_insights").upsert({
      run_id: params.runId,
      recurring_schedule_id: params.recurringScheduleId,
      buffer_post_id: params.bufferPostId,
      post_type: story ? "story" : "other",
      sync_status: "pending",
      next_sync_due_at: story ? storyFirstSyncDueAt() : null,
    }, { onConflict: "recurring_schedule_id,buffer_post_id" });
  } catch {
    // Insights must never break a publish.
  }
}

async function bufferClientForSchedule(sb: Sb, scheduleId: string) {
  const { data: schedule, error } = await sb.from("recurring_schedules")
    .select("id,user_id,campaign_id,channel_id,channels(buffer_credentials(api_token,graphql_endpoint))")
    .eq("id", scheduleId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!schedule) throw new Error("Formula not found");
  const credential = await resolveBufferCredential(
    sb,
    schedule.user_id,
    schedule.campaign_id,
    (schedule as any).channels?.buffer_credentials ?? null,
  );
  return makeBufferClient(credential.api_token, credential.graphql_endpoint);
}

/** Fetch fresh metrics for one insight row and persist them. */
export async function syncFormulaInsightRow(sb: Sb, row: {
  id: string;
  recurring_schedule_id: string;
  buffer_post_id: string;
  post_type: string;
  sync_attempts: number;
}, options: { scheduleRetries: boolean }) {
  const now = new Date();
  try {
    const buffer = await bufferClientForSchedule(sb, row.recurring_schedule_id);
    const result = await buffer.getPostMetricEntries(row.buffer_post_id);
    const metrics: BufferMetricEntry[] = result?.metrics ?? [];
    if (metrics.length) {
      await sb.from("formula_run_insights").update({
        metrics,
        metrics_updated_at: result?.metricsUpdatedAt ?? null,
        last_synced_at: now.toISOString(),
        sync_status: "synced",
        next_sync_due_at: null,
      }).eq("id", row.id);
      return { id: row.id, ok: true, synced: true, metrics: metrics.length };
    }
    // Buffer has nothing ingested yet.
    if (!options.scheduleRetries) {
      await sb.from("formula_run_insights").update({ last_synced_at: now.toISOString() }).eq("id", row.id);
      return { id: row.id, ok: true, synced: false, reason: "not_ingested_yet" };
    }
    const exhausted = row.sync_attempts >= STORY_MAX_SYNC_ATTEMPTS;
    await sb.from("formula_run_insights").update({
      last_synced_at: now.toISOString(),
      sync_status: exhausted ? "failed" : "pending",
      next_sync_due_at: exhausted ? null : new Date(now.getTime() + STORY_RETRY_HOURS * 3_600_000).toISOString(),
    }).eq("id", row.id);
    return { id: row.id, ok: true, synced: false, reason: exhausted ? "attempts_exhausted" : "retry_scheduled" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.scheduleRetries) {
      const exhausted = row.sync_attempts >= STORY_MAX_SYNC_ATTEMPTS;
      await sb.from("formula_run_insights").update({
        sync_status: exhausted ? "failed" : "pending",
        next_sync_due_at: exhausted ? null : new Date(now.getTime() + STORY_RETRY_HOURS * 3_600_000).toISOString(),
      }).eq("id", row.id);
    }
    return { id: row.id, ok: false, error: message };
  }
}

/** Cron pass: auto-sync due Story insights (Stories only — other post types are manual). */
export async function runDueFormulaInsightSyncs(sb: Sb) {
  const now = new Date().toISOString();
  const { data: due } = await sb.from("formula_run_insights")
    .select("id,recurring_schedule_id,buffer_post_id,post_type,sync_attempts")
    .eq("post_type", "story")
    .neq("sync_status", "synced")
    .not("next_sync_due_at", "is", null)
    .lte("next_sync_due_at", now)
    .limit(20);

  const results: Array<Record<string, unknown>> = [];
  for (const row of due ?? []) {
    const { data: claimed } = await sb.rpc("claim_formula_insight_sync", { _insight_id: row.id, _now: now });
    if (!claimed) { results.push({ id: row.id, ok: true, skipped: "not_claimed" }); continue; }
    results.push(await syncFormulaInsightRow(sb, { ...row, sync_attempts: Number(row.sync_attempts ?? 0) + 1 }, { scheduleRetries: true }));
  }
  return results;
}
