import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardStats, manualRun } from "@/lib/runs.functions";
import { listChannels } from "@/lib/channels.functions";
import { useScopedCampaignId } from "@/components/campaign-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Play, Sparkles, TrendingUp, Clock, ListVideo, CheckCircle2, XCircle, Brain } from "lucide-react";
import { toast } from "sonner";
import { ChannelSelect } from "@/components/channel-picker";
import { FrameExtractionRunner } from "@/components/frame-extraction-runner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: DashboardPage });

function DashboardPage() {
  const stats = useServerFn(dashboardStats);
  const channels = useServerFn(listChannels);
  const manual = useServerFn(manualRun);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const campaignId = useScopedCampaignId();
  const [channelId, setChannelId] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", campaignId],
    queryFn: () => stats({ data: { campaign_id: campaignId } }),
  });
  const { data: chans } = useQuery({ queryKey: ["channels", campaignId], queryFn: () => channels({ data: { campaign_id: campaignId } }) });

  const run = useMutation({
    mutationFn: (id: string) => manual({ data: { channel_id: id, campaign_id: campaignId } }),
    onSuccess: () => { toast.success("Run complete"); qc.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Run failed"),
  });

  const q = data?.queue;
  const done = q?.done ?? 0;
  const total = q?.total ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const nextSched = data?.schedules?.[0]?.next_run_at;
  const topMem: Array<{ id: string; category: string; confidence: number; insight: string }> = data?.memory.top ?? [];
  const recent: Array<{ id: string; run_number: number; status: string; started_at: string; strategy_used: string | null }> = data?.runs.recent ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Your adaptive publishing loop at a glance.</p>
          <FrameExtractionRunner />

        </div>
        <div className="flex gap-2 items-center">
          <ChannelSelect channels={chans ?? []} value={channelId} onValueChange={setChannelId} placeholder="Select a channel" className="w-56" />
          <Button disabled={!channelId || run.isPending} onClick={() => run.mutate(channelId)}>
            <Play className="h-4 w-4 mr-2" />
            {run.isPending ? "Running…" : "Manual run"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Stat icon={ListVideo} label="Queue Progress" value={`${done}/${total}`} sub={`${pct}% complete`} />
        <Stat icon={Clock} label="Next Scheduled" value={nextSched ? new Date(nextSched).toLocaleString() : "—"} sub={nextSched ? "" : "No schedule active"} />
        <Stat icon={CheckCircle2} label="Success Rate" value={`${data?.runs.successRate ?? 0}%`} sub={`${data?.runs.totalRuns ?? 0} recent runs`} />
        <Stat icon={Brain} label="Learning Insights" value={`${topMem.length}`} sub="active in memory" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary"/>Recent Activity</CardTitle>
            <CardDescription>Last runs in this campaign.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> :
              recent.length === 0 ?
                <div className="text-sm text-muted-foreground">No runs yet. Add videos to the queue, then hit Manual run.</div> :
              <ul className="divide-y divide-border">
                {recent.slice(0, 8).map((r) => (
                  <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">#{r.run_number}</span>
                      <StatusBadge status={r.status} />
                      <span className="text-muted-foreground text-xs">{new Date(r.started_at).toLocaleString()}</span>
                    </div>
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">{r.strategy_used ?? ""}</span>
                  </li>
                ))}
              </ul>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary"/>Top Learnings</CardTitle>
            <CardDescription>Highest-confidence insights guiding new captions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topMem.length === 0 ? (
              <div className="text-sm text-muted-foreground">Memory is empty. Loop will start learning after your first published post has analytics.</div>
            ) : topMem.map((m) => (
              <div key={m.id} className="text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px] uppercase">{m.category}</Badge>
                  <span className="text-xs text-muted-foreground">{Math.round(m.confidence * 100)}%</span>
                </div>
                <Progress value={m.confidence * 100} className="h-1 mb-1" />
                <p className="text-muted-foreground">{m.insight}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {(chans ?? []).length === 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="pt-6 text-sm">
            No channels configured yet. Head to <Button variant="link" className="px-1 h-auto" onClick={() => navigate({ to: "/settings/buffer" })}>Buffer settings</Button>
            to connect Buffer, then create a channel.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{label}</div>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    complete: "bg-success/15 text-success",
    failed: "bg-destructive/15 text-destructive",
    publishing: "bg-primary/15 text-primary",
    generating: "bg-primary/15 text-primary",
    analyzing: "bg-primary/15 text-primary",
    pending: "bg-muted text-muted-foreground",
  };
  const Icon = status === "complete" ? CheckCircle2 : status === "failed" ? XCircle : Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${map[status] ?? "bg-muted"}`}>
      <Icon className="h-3 w-3" /> {status}
    </span>
  );
}
