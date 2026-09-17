import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getUsageOverview, getActivityFeed, cleanupUnusedFrames, purgeOldLogs } from "@/lib/usage.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Activity, Database, HardDrive, Images, RefreshCw, Trash2, Cloud, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/usage")({
  component: UsagePage,
  head: () => ({
    meta: [
      { title: "App Usage & Activity — Loop" },
      { name: "description", content: "Database, media host and AI frame storage usage, plus a live view of what Loop is doing right now." },
      { property: "og:title", content: "App Usage & Activity — Loop" },
      { property: "og:description", content: "Track storage, limits and live execution activity for your publishing loop." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function bytes(n: unknown) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(v) / Math.log(1024)));
  return `${(v / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function UsagePage() {
  const overview = useServerFn(getUsageOverview);
  const feed = useServerFn(getActivityFeed);
  const cleanFrames = useServerFn(cleanupUnusedFrames);
  const purgeLogs = useServerFn(purgeOldLogs);
  const qc = useQueryClient();

  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["usage-overview"], queryFn: () => overview({}) });
  const { data: activity } = useQuery({
    queryKey: ["usage-activity"],
    queryFn: () => feed({ data: { limit: 120 } }),
    refetchInterval: 15_000,
  });

  const framesMut = useMutation({
    mutationFn: () => cleanFrames({ data: { dry_run: false } }),
    onSuccess: (r: any) => { toast.success(r?.cleared ? `Cleared temporary frames for ${r.cleared} finished video(s).` : "Nothing to clean — no leftover frames."); qc.invalidateQueries({ queryKey: ["usage-overview"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Cleanup failed"),
  });
  const logsMut = useMutation({
    mutationFn: () => purgeLogs({ data: { older_than_days: 30 } }),
    onSuccess: (r: any) => { toast.success(`Removed ${r?.deleted ?? 0} old activity entries.`); qc.invalidateQueries({ queryKey: ["usage-overview"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Cleanup failed"),
  });

  const db = (data?.db ?? null) as any;
  const cloud = (data?.cloudinary ?? null) as any;
  const dbBytes = Number(db?.database_bytes ?? 0);
  const dbLimit = Number(data?.limits?.database_bytes ?? 0);
  const storage: Array<{ bucket: string; objects: number; bytes: number }> = db?.storage ?? [];
  const storageBytes = storage.reduce((s, b) => s + Number(b.bytes ?? 0), 0);
  const storageLimit = Number(data?.limits?.storage_bytes ?? 0);
  const tables: Array<{ table: string; total_bytes: number; estimated_rows: number }> = db?.tables ?? [];
  const frames = db?.frames ?? {};
  const logs = db?.logs ?? {};
  const myRows: Record<string, number> = db?.my_rows ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usage & Activity</h1>
          <p className="text-sm text-muted-foreground">Storage, limits, media host usage and a live view of what the app is doing.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {data?.db_error && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="pt-6 text-sm">Usage numbers are unavailable right now: {data.db_error}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Meter icon={Database} label="Database used" value={bytes(dbBytes)} used={dbBytes} limit={dbLimit} />
        <Meter icon={HardDrive} label="File storage used" value={bytes(storageBytes)} used={storageBytes} limit={storageLimit} />
        <Card>
          <CardContent className="pt-6">
            <Row icon={Images} label="AI preview frames" />
            <div className="mt-2 text-2xl font-semibold">{bytes(frames.frame_bytes)}</div>
            <div className="text-xs text-muted-foreground mt-1">{Number(frames.items_with_frames ?? 0)} video(s) hold frames · {Number(frames.stale_done_items ?? 0)} leftover ({bytes(frames.stale_done_bytes)})</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Row icon={Activity} label="Activity log entries" />
            <div className="mt-2 text-2xl font-semibold">{Number(logs.total ?? 0)}</div>
            <div className="text-xs text-muted-foreground mt-1">{Number(logs.older_than_30d ?? 0)} older than 30 days</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trash2 className="h-4 w-4 text-primary" />Free up space safely</CardTitle>
          <CardDescription>Only temporary items are removed. Videos, captions, posts and settings are never touched.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-medium">Leftover AI preview frames</div>
              <div className="text-muted-foreground text-xs">Frames from videos already published or finished. Runs also clear these automatically now.</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => framesMut.mutate()} disabled={framesMut.isPending}>
              {framesMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Clear {Number(frames.stale_done_items ?? 0) || ""} leftover
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-border pt-3">
            <div>
              <div className="font-medium">Activity history older than 30 days</div>
              <div className="text-muted-foreground text-xs">Keeps recent logs so you can still see what happened lately.</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => logsMut.mutate()} disabled={logsMut.isPending}>
              {logsMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Trim old history
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Cloud className="h-4 w-4 text-primary" />Media host usage</CardTitle>
            <CardDescription>Video hosting account totals.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {data?.cloudinary_error && <div className="text-muted-foreground">{data.cloudinary_error}</div>}
            {cloud && (
              <ul className="space-y-1">
                <Line label="Plan" value={String(cloud.plan ?? "—")} />
                <Line label="Stored media" value={`${bytes(cloud.storage?.usage)}${cloud.storage?.limit ? ` of ${bytes(cloud.storage.limit)}` : ""}`} />
                <Line label="Bandwidth this cycle" value={`${bytes(cloud.bandwidth?.usage)}${cloud.bandwidth?.limit ? ` of ${bytes(cloud.bandwidth.limit)}` : ""}`} />
                <Line label="Transformations" value={`${Number(cloud.transformations?.usage ?? 0)}${cloud.transformations?.limit ? ` of ${Number(cloud.transformations.limit)}` : ""}`} />
                <Line label="Credits used" value={`${Number(cloud.credits?.usage ?? 0)}${cloud.credits?.limit ? ` of ${Number(cloud.credits.limit)}` : ""}`} />
                <Line label="Stored files" value={String(cloud.resources ?? "—")} />
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" />Biggest data tables</CardTitle>
            <CardDescription>Where your database space goes.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
              <ul className="text-sm divide-y divide-border">
                {tables.slice(0, 10).map((t) => (
                  <li key={t.table} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="truncate">{t.table}</span>
                    <span className="text-muted-foreground text-xs shrink-0">{bytes(t.total_bytes)} · ~{Number(t.estimated_rows ?? 0).toLocaleString()} rows</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your content</CardTitle>
            <CardDescription>Counts owned by your account.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1">
              {Object.entries(myRows).map(([key, value]) => (
                <Line key={key} label={key.replace(/_/g, " ")} value={Number(value).toLocaleString()} />
              ))}
              {storage.map((b) => (
                <Line key={b.bucket} label={`files in ${b.bucket}`} value={`${Number(b.objects ?? 0)} · ${bytes(b.bytes)}`} />
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary" />What the app is doing now</CardTitle>
            <CardDescription>Live steps, refreshed every 15 seconds.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(activity?.active_runs ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">Nothing running right now.</div>
            ) : (
              <ul className="space-y-2">
                {(activity!.active_runs as any[]).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span className="text-muted-foreground">#{r.run_number}</span>
                    <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                    <span className="text-xs">step: {r.current_step ?? "—"}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{r.started_at ? new Date(r.started_at).toLocaleTimeString() : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border pt-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Recent execution log</div>
              <ul className="space-y-1 max-h-80 overflow-auto text-xs font-mono">
                {(activity?.logs ?? []).map((l: any) => (
                  <li key={l.id} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0">{new Date(l.created_at).toLocaleTimeString()}</span>
                    <span className={l.level === "error" ? "text-destructive shrink-0" : l.level === "warn" ? "text-warning shrink-0" : "text-primary shrink-0"}>{l.level}</span>
                    <span className="text-muted-foreground shrink-0">{l.module ?? "app"}</span>
                    <span className="truncate">{l.message}</span>
                  </li>
                ))}
                {(activity?.logs ?? []).length === 0 && <li className="text-muted-foreground font-sans">No activity recorded yet.</li>}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function Meter({ icon, label, value, used, limit }: { icon: any; label: string; value: string; used: number; limit: number }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <Card>
      <CardContent className="pt-6">
        <Row icon={icon} label={label} />
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        {limit > 0 && (
          <>
            <Progress value={pct} className="h-1 mt-2" />
            <div className="text-xs text-muted-foreground mt-1">{pct}% of {bytes(limit)} typical allowance</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground capitalize">{label}</span>
      <span className="font-medium">{value}</span>
    </li>
  );
}
