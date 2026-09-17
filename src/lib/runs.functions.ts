import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaign_id: z.string().uuid().nullable().optional(), export_all: z.boolean().optional().default(false), search: z.string().trim().max(200).optional().default("") }).optional().parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("runs")
      .select(`
        id, run_number, status, strategy_used, next_strategy, error, duration_ms,
        started_at, finished_at, campaign_id, channel_id,
        channels(name,platform),
        video_queue!runs_queue_item_id_fkey(cloudinary_url),
        video_analyses(summary, topic),
        captions(text, hashtags),
        published_posts(buffer_post_id, permalink, posted_at, buffer_status, due_at, verified_at, source,
          post_analytics(views,likes,comments,shares,saves,reach,impressions,fetched_at)),

        learning_reports(worked, hook_verdict, change_recommendation)
      `)
      .order("started_at", { ascending: false });
    if (data?.campaign_id) q = q.eq("campaign_id", data.campaign_id);
    const search = data?.search?.toLowerCase() ?? "";
    if (search && !data?.export_all) {
      const { data: allRows, error } = await q;
      if (error) throw new Error(error.message);
      return (allRows ?? []).filter((row) => JSON.stringify(row).toLowerCase().includes(search)).slice(0, 100);
    }
    const { data: rows, error } = await (data?.export_all ? q : q.limit(100));
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const manualRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    channel_id: z.string().uuid(),
    campaign_id: z.string().uuid().nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.campaign_id) {
      const { data: camp } = await context.supabase.from("campaigns").select("status").eq("id", data.campaign_id).maybeSingle();
      if (camp?.status && camp.status !== "active") throw new Error(`Campaign is ${camp.status}`);
    }
    const { runOrchestrator } = await import("./orchestrator.server");
    return await runOrchestrator({
      supabase: context.supabase,
      userId: context.userId,
      channelId: data.channel_id,
      campaignId: data.campaign_id ?? null,
    });
  });

export const dashboardStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaign_id: z.string().uuid().nullable().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const camp = data?.campaign_id ?? null;
    const build = <B extends { eq: (c: string, v: string) => B }>(b: B): B => (camp ? b.eq("campaign_id", camp) : b);

    const [queue, runs, memory, schedules] = await Promise.all([
      build(context.supabase.from("video_queue").select("status", { count: "exact" }) as any),
      build(context.supabase.from("runs").select("id,status,run_number,started_at,strategy_used").order("started_at", { ascending: false }).limit(20) as any),
      build(context.supabase.from("memory_insights").select("id,category,confidence,insight").eq("active", true).order("confidence", { ascending: false }).limit(5) as any),
      build(context.supabase.from("schedules").select("next_run_at,active,paused,channel_id").eq("active", true).order("next_run_at", { ascending: true }).limit(5) as any),
    ]);

    const queueRows: any[] = (queue as any).data ?? [];
    const total = queueRows.length;
    const done = queueRows.filter((r) => r.status === "done").length;
    const pending = queueRows.filter((r) => r.status === "pending").length;
    const failed = queueRows.filter((r) => r.status === "failed").length;

    const runsList: any[] = (runs as any).data ?? [];
    const successRuns = runsList.filter((r) => r.status === "complete").length;
    const successRate = runsList.length ? Math.round((successRuns / runsList.length) * 100) : 0;

    return {
      queue: { total, done, pending, failed, remaining: pending },
      runs: { recent: runsList, successRate, totalRuns: runsList.length },
      memory: { top: (memory as any).data ?? [] },
      schedules: (schedules as any).data ?? [],
      performance: [],
    };
  });

// Posts that exist in Buffer but were not created by an app run (historical / manual posts).
export const listImportedPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaign_id: z.string().uuid().nullable().optional(), export_all: z.boolean().optional().default(false), search: z.string().trim().max(200).optional().default("") }).optional().parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("published_posts")
      .select("id,buffer_post_id,permalink,posted_at,buffer_status,due_at,verified_at,platform,text_content,source,campaign_id,channel_id,channels(name,platform),post_analytics(views,likes,comments,shares,saves,reach,impressions,fetched_at)")
      .eq("source", "buffer_import")
      .order("posted_at", { ascending: false });
    // Sheets are campaign-isolated: only this campaign's imported posts.
    if (data?.campaign_id) q = q.eq("campaign_id", data.campaign_id);
    const search = data?.search?.toLowerCase() ?? "";
    if (search && !data?.export_all) {
      const { data: allRows, error } = await q;
      if (error) throw new Error(error.message);
      return (allRows ?? []).filter((row) => JSON.stringify(row).toLowerCase().includes(search)).slice(0, 100);
    }
    const { data: rows, error } = await (data?.export_all ? q : q.limit(100));
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

