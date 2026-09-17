// Buffer analytics sync — called by pg_cron (hourly).
// For every active channel:
//   1. Pull recent sent posts from Buffer (batch GraphQL call).
//   2. Match to published_posts by buffer_post_id; import posts we don't know
//      about yet (historical / manually posted) so analysis can learn from them.
//   3. Upsert post_analytics, refresh publish proof, evaluate predictions.
//   4. Recompute durable trend insights for each touched user.
import { createFileRoute } from "@tanstack/react-router";
import { isAuthorizedCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/fetch-analytics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthorizedCronRequest(request)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { makeBufferClient } = await import("@/lib/buffer.server");

        const { data: channels, error: chErr } = await supabaseAdmin
          .from("channels")
          .select("id,user_id,platform,buffer_channel_id,active,campaign_id,buffer_credentials(api_token,graphql_endpoint)")
          .eq("active", true);
        if (chErr) return Response.json({ error: chErr.message }, { status: 500 });

        const usersTouched = new Set<string>();
        const summary: Array<{ channel_id: string; fetched: number; imported: number; updated: number; error?: string }> = [];

        for (const ch of channels ?? []) {
          const cred = (ch as any).buffer_credentials;
          if (!cred?.api_token || !ch.buffer_channel_id) {
            summary.push({ channel_id: ch.id, fetched: 0, imported: 0, updated: 0, error: "missing credentials" });
            continue;
          }

          let nodes: Awaited<ReturnType<ReturnType<typeof makeBufferClient>["getChannelPostsMetrics"]>> = [];
          try {
            const buffer = makeBufferClient(cred.api_token, cred.graphql_endpoint || "https://graphql.buffer.com");
            nodes = await buffer.getChannelPostsMetrics(ch.buffer_channel_id, 50);
          } catch (e) {
            summary.push({ channel_id: ch.id, fetched: 0, imported: 0, updated: 0, error: e instanceof Error ? e.message : String(e) });
            continue;
          }
          if (!nodes.length) { summary.push({ channel_id: ch.id, fetched: 0, imported: 0, updated: 0 }); continue; }

          const { data: known } = await supabaseAdmin
            .from("published_posts")
            .select("id,run_id,buffer_post_id")
            .eq("user_id", ch.user_id)
            .in("buffer_post_id", nodes.map((n) => n.id));
          const knownById = new Map((known ?? []).map((k) => [k.buffer_post_id as string, k]));

          let imported = 0, updated = 0;

          for (const n of nodes) {
            let row = knownById.get(n.id) as { id: string; run_id: string | null } | undefined;

            if (!row) {
              const { data: ins } = await supabaseAdmin.from("published_posts").insert({
                user_id: ch.user_id, channel_id: ch.id, run_id: null,
                campaign_id: (ch as any).campaign_id ?? null,
                buffer_post_id: n.id, platform: ch.platform,
                posted_at: n.sentAt, text_content: n.text,
                permalink: (n.raw as any)?.externalLink ?? null,
                buffer_status: (n.raw as any)?.status ?? "sent",
                verified_at: new Date().toISOString(),
                source: "buffer_import", raw: n.raw as never,
              } as never).select("id,run_id").single();
              if (!ins) continue;
              row = ins as any;
              imported++;
            } else {
              await supabaseAdmin.from("published_posts").update({
                buffer_status: (n.raw as any)?.status ?? null,
                permalink: (n.raw as any)?.externalLink ?? null,
                posted_at: n.sentAt ?? undefined,
                verified_at: new Date().toISOString(),
                metrics_updated_at: n.metricsUpdatedAt ?? new Date().toISOString(),
              } as never).eq("id", row.id);
            }

            const m = n.metrics;
            const metrics = {
              views: m.views ?? null, likes: m.likes ?? null, comments: m.comments ?? null,
              shares: m.shares ?? null, saves: m.saves ?? null, reach: m.reach ?? null,
              impressions: m.impressions ?? null,
            };
            const hasMetrics = Object.values(metrics).some((v) => v != null);
            if (hasMetrics) {
              const { data: existing } = await supabaseAdmin
                .from("post_analytics").select("id").eq("published_post_id", row!.id).maybeSingle();
              if (existing) {
                await supabaseAdmin.from("post_analytics").update({
                  ...metrics, fetched_at: new Date().toISOString(), raw: n.raw as never,
                }).eq("id", existing.id);
              } else {
                await supabaseAdmin.from("post_analytics").insert({
                  published_post_id: row!.id, user_id: ch.user_id, campaign_id: (ch as any).campaign_id ?? null, ...metrics, raw: n.raw as never,
                });
              }
              updated++;
              usersTouched.add(ch.user_id);
            }

            // Evaluate prediction accuracy for app runs.
            if (row!.run_id) {
              const { data: run } = await supabaseAdmin
                .from("runs").select("prediction_id").eq("id", row!.run_id).maybeSingle();
              if (run?.prediction_id && hasMetrics) {
                try {
                  const { evaluatePrediction } = await import("@/lib/prediction-engine.server");
                  await evaluatePrediction(supabaseAdmin, run.prediction_id, metrics);
                } catch { /* prediction scoring must not break ingestion */ }
              }
            }
          }

          summary.push({ channel_id: ch.id, fetched: nodes.length, imported, updated });
        }

        if (usersTouched.size) {
          const { recomputeTrends } = await import("@/lib/trend-analyzer.server");
          for (const uid of usersTouched) {
            try { await recomputeTrends(supabaseAdmin, uid); } catch { /* trend failure must not break ingestion */ }
          }
        }

        return Response.json({ channels: (channels ?? []).length, summary });
      },
    },
  },
});
