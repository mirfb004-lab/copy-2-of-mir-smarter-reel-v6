// Stale-run recovery — called by pg_cron every 5 minutes.
// Finds runs whose heartbeat is older than 15 minutes and returns them
// to a resumable state so the next scheduler tick picks them up.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/cron/recover-stale")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

        // Runs stuck in an in-flight state with no recent heartbeat.
        // Rows with a NULL heartbeat are stuck too — fall back to started_at.
        const { data: stuck } = await supabaseAdmin
          .from("runs")
          .select("id,user_id,channel_id,queue_item_id,attempts")
          .in("status", ["analyzing", "generating", "publishing"])
          .lt("started_at", cutoff)
          .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`)
          .limit(50);


        const recovered: string[] = [];
        for (const r of stuck ?? []) {
          // Mark stale, release channel lock, requeue the queue item so orchestrator can resume from step_state.
          await supabaseAdmin.from("runs").update({
            status: "stale",
            error: "No heartbeat for 15+ minutes; marked for resume.",
          }).eq("id", r.id);
          if (r.channel_id) {
            await supabaseAdmin.rpc("release_channel_lock", { _channel_id: r.channel_id, _run_id: r.id });
          }
          if (r.queue_item_id) {
            await supabaseAdmin.from("video_queue").update({ status: "pending" }).eq("id", r.queue_item_id);
          }
          await supabaseAdmin.from("audit_events").insert({
            user_id: r.user_id, run_id: r.id, queue_item_id: r.queue_item_id,
            event_type: "run.stale_recovered", module: "orchestrator", status: "info",
            payload: { attempts: r.attempts } as never,
          });
          recovered.push(r.id);
        }
        return Response.json({ recovered: recovered.length, ids: recovered });
      },
    },
  },
});
