import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRuns, listImportedPosts } from "@/lib/runs.functions";
import { refreshCampaignSheet } from "@/lib/analytics.functions";
import { useScopedCampaignId } from "@/components/campaign-context";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sheet")({ component: SheetPage });

type Row = {
  run_number: number;
  channel: string;
  platform: string;
  status: string;
  strategy_used: string | null;
  next_strategy: string | null;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
  url: string;
  summary: string;
  topic: string;
  caption: string;
  hashtags: string[];
  buffer_post_id: string | null;
  buffer_status: string | null;
  permalink: string | null;
  verified: string;
  source: string;
  posted_at: string | null;
  views: number | null; likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; reach: number | null; impressions: number | null;
  worked: boolean | null;
  learning: string | null;
};

function flatten(runs: any[]): Row[] {
  return (runs ?? []).map((r) => {
    const cap = r.captions?.[0] ?? {};
    const pp = r.published_posts?.[0] ?? {};
    const an = pp.post_analytics?.[0] ?? {};
    const va = r.video_analyses?.[0] ?? {};
    const lr = r.learning_reports?.[0] ?? {};
    return {
      run_number: r.run_number,
      channel: r.channels?.name ?? "Unassigned",
      platform: r.channels?.platform ?? r.published_posts?.[0]?.platform ?? "",
      status: r.status,
      strategy_used: r.strategy_used,
      next_strategy: r.next_strategy,
      error: r.error,
      duration_ms: r.duration_ms,
      started_at: r.started_at,
      finished_at: r.finished_at,
      url: r.video_queue?.cloudinary_url ?? "",
      summary: va.summary ?? "",
      topic: va.topic ?? "",
      caption: cap.text ?? "",
      hashtags: cap.hashtags ?? [],
      buffer_post_id: pp.buffer_post_id ?? null,
      buffer_status: pp.buffer_status ?? null,
      permalink: pp.permalink ?? null,
      verified: pp.verified_at ? "✓ confirmed" : pp.buffer_post_id ? "pending" : "—",
      source: pp.source ?? "app",
      posted_at: pp.posted_at ?? null,
      views: an.views ?? null, likes: an.likes ?? null, comments: an.comments ?? null,
      shares: an.shares ?? null, saves: an.saves ?? null, reach: an.reach ?? null, impressions: an.impressions ?? null,
      worked: lr.worked ?? null,
      learning: lr.change_recommendation ?? null,
    };
  });
}

function flattenImported(posts: any[]): Row[] {
  return (posts ?? []).map((p) => {
    const an = p.post_analytics?.[0] ?? {};
    return {
      run_number: 0,
      channel: p.channels?.name ?? "Unassigned",
      platform: p.channels?.platform ?? p.platform ?? "",
      status: p.buffer_status ?? "sent",
      strategy_used: null, next_strategy: null, error: null, duration_ms: null,
      started_at: p.posted_at ?? p.due_at ?? "",
      finished_at: p.posted_at ?? null,
      url: p.permalink ?? "",
      summary: "", topic: "",
      caption: p.text_content ?? "",
      hashtags: [],
      buffer_post_id: p.buffer_post_id ?? null,
      buffer_status: p.buffer_status ?? null,
      permalink: p.permalink ?? null,
      verified: p.verified_at ? "✓ confirmed" : "pending",
      source: "buffer",
      posted_at: p.posted_at ?? null,
      views: an.views ?? null, likes: an.likes ?? null, comments: an.comments ?? null,
      shares: an.shares ?? null, saves: an.saves ?? null, reach: an.reach ?? null, impressions: an.impressions ?? null,
      worked: null, learning: null,
    };
  });
}

const cols: Array<{ key: keyof Row; label: string }> = [
  { key: "run_number", label: "Run" },
  { key: "channel", label: "Channel" },
  { key: "platform", label: "Platform" },
  { key: "started_at", label: "Date" },
  { key: "url", label: "URL" },
  { key: "topic", label: "Topic" },
  { key: "caption", label: "Caption" },
  { key: "hashtags", label: "Hashtags" },
  { key: "source", label: "Source" },
  { key: "buffer_post_id", label: "Buffer ID" },
  { key: "buffer_status", label: "Buffer status" },
  { key: "verified", label: "Proof" },
  { key: "permalink", label: "Permalink" },
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "saves", label: "Saves" },
  { key: "reach", label: "Reach" },
  { key: "impressions", label: "Impressions" },
  { key: "posted_at", label: "Posted" },
  { key: "learning", label: "Next Strategy" },
  { key: "status", label: "Status" },
  { key: "error", label: "Errors" },
  { key: "duration_ms", label: "Duration" },
];

function toCsv(rows: Row[]): string {
  const header = cols.map((c) => JSON.stringify(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => {
    const v = r[c.key];
    return JSON.stringify(Array.isArray(v) ? v.join(" ") : (v ?? ""));
  }).join(",")).join("\n");
  return header + "\n" + body;
}

function download(name: string, mime: string, data: string | Blob) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function SheetPage() {
  const fn = useServerFn(listRuns);
  const importedFn = useServerFn(listImportedPosts);
  const refreshFn = useServerFn(refreshCampaignSheet);
  const qc = useQueryClient();
  const campaignId = useScopedCampaignId();
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["runs", campaignId, q], queryFn: () => fn({ data: { campaign_id: campaignId, search: q } }), refetchInterval: 15000 });
  const { data: imported } = useQuery({ queryKey: ["imported-posts", campaignId, q], queryFn: () => importedFn({ data: { campaign_id: campaignId, search: q } }), refetchInterval: 60000 });
  // Keep this campaign's older posts' metrics fresh without waiting for the next run.
  const refreshMut = useMutation({
    mutationFn: () => refreshFn({ data: { campaign_id: campaignId } }),
    onSuccess: (r) => {
      toast.success(`Synced ${r.fetched} post${r.fetched === 1 ? "" : "s"} · ${r.updated} metric update${r.updated === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["imported-posts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Refresh failed"),
  });
  useEffect(() => { refreshMut.mutate(); /* refresh once when the sheet opens */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);
  const rows = useMemo(
    () => [...flatten(data ?? []), ...flattenImported(imported ?? [])]
      .sort((a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime()),
    [data, imported],
  );
  const [page, setPage] = useState(0);
  const perPage = 25;

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
  }, [rows, q]);
  const pageRows = filtered.slice(page * perPage, page * perPage + perPage);

  async function loadExportRows() {
    const [exportedRuns, exportedImported] = await Promise.all([
      fn({ data: { campaign_id: campaignId, export_all: true } }),
      importedFn({ data: { campaign_id: campaignId, export_all: true } }),
    ]);
    return [...flatten(exportedRuns), ...flattenImported(exportedImported)]
      .sort((a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime());
  }

  async function exportCsv() {
    try {
      download("loop-runs.csv", "text/csv", toCsv(await loadExportRows()));
      toast.success("Exported CSV");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSV export failed");
    }
  }

  async function exportJson() {
    try {
      download("loop-runs.json", "application/json", JSON.stringify(await loadExportRows(), null, 2));
      toast.success("Exported JSON");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "JSON export failed");
    }
  }

  async function exportXlsx() {
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(await loadExportRows());
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Runs");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      download("loop-runs.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Blob([buf]));
      toast.success("Exported XLSX");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "XLSX export failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sheet</h1>
          <p className="text-sm text-muted-foreground">Every run and every Buffer post, with publish proof and live metrics.</p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} className="w-56" />
          <Button variant="outline" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshMut.isPending ? "animate-spin" : ""}`}/>Refresh metrics
          </Button>
          <Button variant="outline" onClick={() => void exportCsv()}><Download className="h-4 w-4 mr-2"/>CSV</Button>
          <Button variant="outline" onClick={() => void exportXlsx()}><Download className="h-4 w-4 mr-2"/>XLSX</Button>
          <Button variant="outline" onClick={() => void exportJson()}><Download className="h-4 w-4 mr-2"/>JSON</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">{filtered.length} rows</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[65vh]">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>{cols.map((c) => <th key={c.key} className="text-left px-3 py-2 font-medium border-b border-border">{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/30">
                    {cols.map((c) => {
                      const v = r[c.key];
                      if (c.key === "status") return <td key={c.key} className="px-3 py-2"><Badge variant="outline">{String(v)}</Badge></td>;
                      if (c.key === "permalink") return <td key={c.key} className="px-3 py-2 max-w-[180px] truncate">{v ? <a href={String(v)} target="_blank" rel="noreferrer" className="text-primary underline">open</a> : ""}</td>;
                      if (c.key === "url" || c.key === "caption" || c.key === "summary" || c.key === "topic" || c.key === "learning") {
                        return <td key={c.key} className="px-3 py-2 max-w-[220px] truncate" title={String(v ?? "")}>{String(v ?? "")}</td>;
                      }
                      if (c.key === "hashtags") return <td key={c.key} className="px-3 py-2">{(v as string[])?.join(" ")}</td>;
                      if (c.key === "started_at" || c.key === "posted_at") return <td key={c.key} className="px-3 py-2 whitespace-nowrap">{v ? new Date(v as string).toLocaleString() : ""}</td>;
                      return <td key={c.key} className="px-3 py-2 whitespace-nowrap">{v == null ? "" : String(v)}</td>;
                    })}
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-muted-foreground">No runs yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-3 border-t border-border">
            <div className="text-xs text-muted-foreground">Page {page + 1} / {Math.max(1, Math.ceil(filtered.length / perPage))}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * perPage >= filtered.length} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
