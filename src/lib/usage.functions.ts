import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Read-only usage reporting + safe cleanup of temporary AI preview frames / old logs.
// Nothing here touches uploads, Cloudinary media, Buffer dispatch, Formula or Sheet Mode.

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Json = { [key: string]: JsonValue };


const FREE_DB_BYTES = 500 * 1024 * 1024; // Cloud database soft limit
const FREE_STORAGE_BYTES = 1024 * 1024 * 1024; // Cloud file storage soft limit

export const getUsageOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as unknown as {
      rpc: (name: string, args?: Json) => Promise<{ data: unknown; error: { message: string } | null }>;
    };

    let db: Json | null = null;
    let dbError: string | null = null;
    const { data, error } = await sb.rpc("usage_db_stats");
    if (error) dbError = error.message;
    else db = (data ?? null) as Json | null;

    // Cloudinary account usage (plain account API — no transformations triggered).
    let cloudinary: Json | null = null;
    let cloudinaryError: string | null = null;
    const cloudName = process.env["CLOUDINARY_CLOUD_NAME"];
    const apiKey = process.env["CLOUDINARY_API_KEY"];
    const apiSecret = process.env["CLOUDINARY_API_SECRET"];
    if (cloudName && apiKey && apiSecret) {
      try {
        const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
        const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/usage`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        const body = (await res.json()) as Json;
        if (!res.ok) cloudinaryError = String((body as any)?.error?.message ?? `Cloudinary responded ${res.status}`);
        else cloudinary = body;
      } catch (e) {
        cloudinaryError = e instanceof Error ? e.message : String(e);
      }
    } else {
      cloudinaryError = "Media host credentials are not configured.";
    }

    return {
      generated_at: new Date().toISOString(),
      limits: { database_bytes: FREE_DB_BYTES, storage_bytes: FREE_STORAGE_BYTES },
      db,
      db_error: dbError,
      cloudinary,
      cloudinary_error: cloudinaryError,
    };
  });

/** Live activity feed: what the app is doing right now + recent step logs. */
export const getActivityFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(10).max(300).default(120) }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const limit = data?.limit ?? 120;
    const [logsRes, activeRes, recentRes] = await Promise.all([
      context.supabase.from("logs")
        .select("id,created_at,level,module,message,run_id")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(limit),
      context.supabase.from("runs")
        .select("id,run_number,status,current_step,started_at,heartbeat_at,strategy_used,campaign_id")
        .eq("user_id", context.userId)
        .not("status", "in", "(complete,failed)")
        .order("started_at", { ascending: false })
        .limit(20),
      context.supabase.from("runs")
        .select("id,run_number,status,current_step,started_at,finished_at,duration_ms,error,strategy_used")
        .eq("user_id", context.userId)
        .order("started_at", { ascending: false })
        .limit(10),
    ]);
    if (logsRes.error) throw new Error(logsRes.error.message);
    return {
      logs: logsRes.data ?? [],
      active_runs: activeRes.data ?? [],
      recent_runs: recentRes.data ?? [],
    };
  });

/**
 * Deletes cached AI preview frames that are no longer needed (queue items already
 * published/done, or failed items past their retry budget). Videos, captions and
 * posts are never touched.
 */
export const cleanupUnusedFrames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ dry_run: z.boolean().default(false) }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const dryRun = data?.dry_run ?? false;
    const { data: rows, error } = await context.supabase
      .from("video_queue")
      .select("id,status,ai_frames_at")
      .eq("user_id", context.userId)
      .in("status", ["done", "skipped"])
      .not("ai_frames", "is", null)
      .limit(2000);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r) => r.id);
    if (dryRun || !ids.length) return { cleared: dryRun ? 0 : 0, candidates: ids.length };

    let cleared = 0;
    for (let start = 0; start < ids.length; start += 200) {
      const chunk = ids.slice(start, start + 200);
      const { error: updErr } = await context.supabase
        .from("video_queue")
        .update({ ai_frames: null, ai_frames_at: null })
        .in("id", chunk)
        .eq("user_id", context.userId);
      if (updErr) throw new Error(updErr.message);
      cleared += chunk.length;
    }
    return { cleared, candidates: ids.length };
  });

/** Trims the activity log history. Only log rows are removed. */
export const purgeOldLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ older_than_days: z.number().int().min(7).max(365).default(30) }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const days = data?.older_than_days ?? 30;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const { error, count } = await context.supabase
      .from("logs")
      .delete({ count: "exact" })
      .eq("user_id", context.userId)
      .lt("created_at", cutoff);
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0, older_than_days: days };
  });
