import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const listInput = z.object({ recurring_schedule_id: z.string().uuid() });
const syncInput = z.object({ insight_id: z.string().uuid() });

async function assertFormulaOwner(supabase: any, userId: string, scheduleId: string) {
  const { data, error } = await supabase.from("recurring_schedules").select("id").eq("id", scheduleId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Formula not found");
}

export const listFormulaRunInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertFormulaOwner(context.supabase, context.userId, data.recurring_schedule_id);
    const { data: rows, error } = await context.supabase
      .from("formula_run_insights")
      .select("id,run_id,buffer_post_id,post_type,metrics,metrics_updated_at,last_synced_at,sync_status,sync_attempts,next_sync_due_at,created_at,runs(started_at,status)")
      .eq("recurring_schedule_id", data.recurring_schedule_id)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Manual on-demand sync for non-Story formula posts (Reels, TikTok videos, ...). */
export const syncFormulaRunInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => syncInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("formula_run_insights")
      .select("id,recurring_schedule_id,buffer_post_id,post_type,sync_attempts")
      .eq("id", data.insight_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Insight not found");
    await assertFormulaOwner(context.supabase, context.userId, row.recurring_schedule_id);
    const { syncFormulaInsightRow } = await import("./formula-insights.server");
    const result = await syncFormulaInsightRow(context.supabase as any, {
      id: row.id,
      recurring_schedule_id: row.recurring_schedule_id,
      buffer_post_id: row.buffer_post_id,
      post_type: row.post_type,
      sync_attempts: Number(row.sync_attempts ?? 0),
    }, { scheduleRetries: false });
    if (!result.ok) throw new Error(String(result.error ?? "Sync failed"));
    return result;
  });
