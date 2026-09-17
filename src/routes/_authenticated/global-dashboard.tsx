import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { globalStats, listCampaignProgress, listGlobalFailures, bulkRetryFailures } from "@/lib/global.functions";
import { useCampaignScope } from "@/components/campaign-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Globe, RefreshCw, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/global-dashboard")({
  head: () => ({
    meta: [
      { title: "Global Workspace Dashboard — Loop" },
      { name: "description", content: "Aggregate metrics, campaign progress and failure monitoring across every campaign in your workspace." },
      { property: "og:title", content: "Global Workspace Dashboard — Loop" },
      { property: "og:description", content: "Aggregate metrics, campaign progress and failure monitoring across every campaign." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GlobalDashboard,
});

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function GlobalDashboard() {
  const statsFn = useServerFn(globalStats);
  const progressFn = useServerFn(listCampaignProgress);
  const failuresFn = useServerFn(listGlobalFailures);
  const retryFn = useServerFn(bulkRetryFailures);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { setCampaignId, setMode } = useCampaignScope();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "paused" | "stopped">("all");

  const { data: stats, isError: statsError } = useQuery({ queryKey: ["global-stats"], queryFn: () => statsFn(), refetchInterval: 30_000 });
  const { data: progress, isFetching, isError: progressError } = useQuery({
    queryKey: ["global-progress", page, search, status],
    queryFn: () => progressFn({ data: { page, pageSize: 50, search, status } }),
  });
  const { data: failures, isError: failuresError } = useQuery({ queryKey: ["global-failures"], queryFn: () => failuresFn() });

  const retryMut = useMutation({
    mutationFn: (v: { ids?: string[]; all?: boolean }) => retryFn({ data: v }),
    onSuccess: () => {
      toast.success("Queued for retry");
      qc.invalidateQueries({ queryKey: ["global-failures"] });
      qc.invalidateQueries({ queryKey: ["global-progress"] });
      qc.invalidateQueries({ queryKey: ["global-stats"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Retry failed"),
  });

  if (statsError || progressError || failuresError) {
    return <div className="text-sm text-destructive">Unable to load the global dashboard. Please try again.</div>;
  }

  const total = progress?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));

  function switchTo(id: string) {
    setCampaignId(id);
    setMode("campaign");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Globe className="h-5 w-5 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Global workspace dashboard</h1>
          <p className="text-sm text-muted-foreground">Aggregated across every campaign in this workspace.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active campaigns" value={stats?.activeCampaigns ?? "—"} hint={`${stats?.campaigns ?? 0} total`} />
        <Metric label="Queue processing" value={stats?.queueProcessing ?? "—"} hint={`${stats?.queuePending ?? 0} pending · ${stats?.deadLetters ?? 0} dead-letter`} />
        <Metric label="Prediction accuracy" value={stats?.predictionAccuracy != null ? `${stats.predictionAccuracy}` : "—"} hint={`${stats?.predictionSample ?? 0} evaluated`} />
        <Metric label="Published posts" value={stats?.publishedPosts ?? "—"} hint={`${stats?.activeRuns ?? 0} runs in flight`} />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[200px]">
              <CardTitle>Campaign progress</CardTitle>
              <CardDescription>{total} campaigns · page {page} of {pages}</CardDescription>
            </div>
            <Input
              className="max-w-56"
              placeholder="Search campaign name…"
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value); }}
            />
            <Select value={status} onValueChange={(v) => { setPage(1); setStatus(v as typeof status); }}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">Campaign</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3">Pending</th>
                <th className="py-2 pr-3">Last run</th>
                <th className="py-2 pr-3">Accuracy</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {(progress?.rows ?? []).map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-medium">{r.name}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={r.status === "active" ? "default" : r.status === "paused" ? "secondary" : "outline"}>{r.status}</Badge>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.channelName ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {r.pending}
                    {r.deadLetter > 0 && <span className="ml-1 text-xs text-destructive">({r.deadLetter} failed)</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {r.lastRunStatus ?? "—"}
                    {r.lastRunAt ? ` · ${new Date(r.lastRunAt).toLocaleDateString()}` : ""}
                  </td>
                  <td className="py-2 pr-3">{r.predictionAccuracy ?? "—"}</td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => switchTo(r.id)}>Switch</Button>
                  </td>
                </tr>
              ))}
              {!isFetching && (progress?.rows ?? []).length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No campaigns match.</td></tr>
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-end gap-2 pt-3">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[200px]">
              <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Error & dead-letter monitor</CardTitle>
              <CardDescription>Queue failures across every campaign.</CardDescription>
            </div>
            <Button
              size="sm"
              disabled={!failures?.length || retryMut.isPending}
              onClick={() => retryMut.mutate({ all: true })}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${retryMut.isPending ? "animate-spin" : ""}`} />Retry all
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {(failures ?? []).length === 0 ? (
            <div className="text-sm text-muted-foreground">No failures. </div>
          ) : (
            <ul className="divide-y divide-border">
              {(failures ?? []).map((f) => (
                <li key={f.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                  <div className="flex-1 min-w-[220px]">
                    <div className="font-medium truncate">{f.campaignName ?? "Unassigned campaign"}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {f.last_error_module ? `${f.last_error_module}: ` : ""}{f.error ?? "unknown error"} · {f.attempts}/{f.max_attempts} attempts
                    </div>
                  </div>
                  <Badge variant="outline">{f.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => retryMut.mutate({ ids: [f.id] })}>Retry</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
