import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { listFormulaRunInsights, syncFormulaRunInsight } from "@/lib/formula-insights.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function FormulaInsightsPanel({ scheduleId }: { scheduleId: string }) {
  const [open, setOpen] = React.useState(false);
  const listFn = useServerFn(listFormulaRunInsights);
  const syncFn = useServerFn(syncFormulaRunInsight);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["formula-insights", scheduleId],
    queryFn: () => listFn({ data: { recurring_schedule_id: scheduleId } }),
    enabled: open,
  });

  const syncMut = useMutation({
    mutationFn: (insightId: string) => syncFn({ data: { insight_id: insightId } }),
    onSuccess: (result: any) => {
      toast[result?.synced ? "success" : "message"](
        result?.synced ? "Metrics updated from Buffer" : "Buffer hasn't ingested metrics for this post yet — try again later.",
      );
      qc.invalidateQueries({ queryKey: ["formula-insights", scheduleId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Sync failed"),
  });

  return (
    <div className="w-full md:w-auto">
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
        <BarChart3 className="h-4 w-4 mr-1" />
        {open ? "Hide insights" : "Insights"}
      </Button>
      {open && (
        <div className="mt-3 rounded-md border bg-muted/20 p-3 text-sm">
          {query.isLoading ? (
            <div className="text-muted-foreground">Loading Buffer insights…</div>
          ) : query.error ? (
            <div className="text-destructive">Unable to load insights for this formula.</div>
          ) : !query.data?.length ? (
            <div className="text-muted-foreground">No published formula posts yet.</div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Buffer ingests network metrics roughly once a day, so a new post can take up to ~24h before numbers appear.
                Stories sync automatically; other post types can be synced on demand.
              </p>
              {query.data.map((insight: any) => {
                const metrics = Array.isArray(insight.metrics) ? insight.metrics : [];
                const isStory = insight.post_type === "story";
                return (
                  <div key={insight.id} className="rounded border p-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={insight.sync_status === "synced" ? "default" : insight.sync_status === "failed" ? "destructive" : "secondary"}>
                        {insight.sync_status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {insight.runs?.started_at ? new Date(insight.runs.started_at).toLocaleString() : new Date(insight.created_at).toLocaleString()}
                      </span>
                      <Badge variant="outline">{isStory ? "story" : insight.post_type}</Badge>
                    </div>
                    {metrics.length ? (
                      <div className="grid gap-1 sm:grid-cols-2">
                        {metrics.map((metric: any, index: number) => (
                          <div key={`${insight.id}-${metric?.type ?? index}`} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">{metric?.name ?? metric?.type ?? "Metric"}</span>
                            <span>{metric?.value ?? "—"}{metric?.unit ? ` ${metric.unit}` : ""}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">No metrics from Buffer yet.</div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        Last synced: {insight.last_synced_at ? new Date(insight.last_synced_at).toLocaleString() : "never"}
                        {insight.metrics_updated_at ? ` · Buffer updated: ${new Date(insight.metrics_updated_at).toLocaleString()}` : ""}
                      </div>
                      {isStory ? (
                        <span className="text-xs text-muted-foreground">
                          Auto-sync{insight.next_sync_due_at ? ` due ${new Date(insight.next_sync_due_at).toLocaleString()}` : " complete"}
                        </span>
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled={syncMut.isPending} onClick={() => syncMut.mutate(insight.id)}>
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />Sync
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
