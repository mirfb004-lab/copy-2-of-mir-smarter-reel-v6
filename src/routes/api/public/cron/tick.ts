// Cron tick — called by pg_cron every 5 minutes.
// Advances due schedules by running the orchestrator for each.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Simple auth: require Supabase anon key
        const apikey = request.headers.get("apikey");
        if (!apikey) return new Response("Unauthorized", { status: 401 });
        if (apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date().toISOString();
        const { data: due } = await supabaseAdmin
          .from("schedules")
          .select("id,user_id,channel_id,campaign_id,mode,interval_hours,daily_times,paused,campaigns(status)")
          .eq("active", true)
          .eq("paused", false)
          .lte("next_run_at", now)
          .limit(20);


        const results: Array<{ id: string; ok: boolean; error?: string }> = [];
        for (const s of due ?? []) {
          // Skip when the campaign is paused/stopped.
          const campStatus = (s as any).campaigns?.status;
          if (campStatus && campStatus !== "active") { results.push({ id: s.id, ok: false, error: `campaign ${campStatus}` }); continue; }
          try {
            const { runOrchestrator } = await import("@/lib/orchestrator.server");
            await runOrchestrator({ supabase: supabaseAdmin as any, userId: s.user_id, channelId: s.channel_id, campaignId: s.campaign_id ?? null });
            results.push({ id: s.id, ok: true });
          } catch (e) {
            results.push({ id: s.id, ok: false, error: e instanceof Error ? e.message : String(e) });
          }

          // Advance next_run_at
          let next: string | null = null;
          const nowD = new Date();
          if (s.mode === "interval" && s.interval_hours) {
            next = new Date(nowD.getTime() + Number(s.interval_hours) * 3600_000).toISOString();
          } else if (s.mode === "daily_times" && s.daily_times?.length) {
            const cands = s.daily_times.map((t: string) => {
              const [h, m] = t.split(":").map(Number);
              const d = new Date(nowD); d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
              if (d <= nowD) d.setUTCDate(d.getUTCDate() + 1);
              return d;
            }).sort((a, b) => a.getTime() - b.getTime());
            next = cands[0].toISOString();
          }
          await supabaseAdmin.from("schedules").update({ next_run_at: next, last_run_at: now }).eq("id", s.id);
        }
        const { data: formulaDue } = await supabaseAdmin
          .from("recurring_schedules")
          .select("id,user_id,campaign_id,next_run_at,is_active,campaigns(status)")
          .eq("is_active", true)
          .neq("scheduler_mode", "manual")
          .lte("next_run_at", now)
          .limit(20);
        const formulaResults: Array<{ id: string; ok: boolean; error?: string; skipped?: string }> = [];
        for (const schedule of formulaDue ?? []) {
          const campaignStatus = (schedule as any).campaigns?.status;
          if (campaignStatus && campaignStatus !== "active") {
            formulaResults.push({ id: schedule.id, ok: false, error: `campaign ${campaignStatus}` });
            continue;
          }
          try {
            const { runReelFormulaSchedule } = await import("@/lib/reel-formula.server");
            const result = await runReelFormulaSchedule(supabaseAdmin as any, schedule.id, schedule.next_run_at ?? now);
            formulaResults.push({ id: schedule.id, ok: true, skipped: result.skipped ? result.reason : undefined });
          } catch (e) {
            formulaResults.push({ id: schedule.id, ok: false, error: e instanceof Error ? e.message : String(e) });
          }
        }
        const { runDueMultiChannelSchedules } = await import("@/lib/multi-channel.server");
        const multiChannelResults = await runDueMultiChannelSchedules(supabaseAdmin as any);
        const { runDueSheetModeSheets } = await import("@/lib/sheet-mode.server");
        const sheetModeResults = await runDueSheetModeSheets(supabaseAdmin as any);
        const { runDueFormulaInsightSyncs } = await import("@/lib/formula-insights.server");
        const formulaInsightResults = await runDueFormulaInsightSyncs(supabaseAdmin as any);
        return Response.json({ processed: results.length + formulaResults.length + multiChannelResults.length + sheetModeResults.length, results, formulaResults, multiChannelResults, sheetModeResults, formulaInsightResults });
      },
    },
  },
});
