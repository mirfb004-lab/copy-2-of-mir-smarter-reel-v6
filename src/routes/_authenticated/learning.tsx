import { createFileRoute } from "@tanstack/react-router";
import { useScopedCampaignId } from "@/components/campaign-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMemory, resetMemory, exportMemory, importMemory, deleteInsight } from "@/lib/memory.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Brain, Download, Upload, Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useRef, useState } from "react";

export const Route = createFileRoute("/_authenticated/learning")({ component: LearningPage });

function LearningPage() {
  const list = useServerFn(listMemory);
  const reset = useServerFn(resetMemory);
  const exp = useServerFn(exportMemory);
  const imp = useServerFn(importMemory);
  const del = useServerFn(deleteInsight);
  const qc = useQueryClient();
  const campaignId = useScopedCampaignId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data, isError: memoryError } = useQuery({ queryKey: ["memory", campaignId], queryFn: () => list({ data: { campaign_id: campaignId } }) });

  const resetMut = useMutation({
    mutationFn: () => reset(),
    onSuccess: () => { toast.success("Memory cleared"); qc.invalidateQueries({ queryKey: ["memory"] }); },
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory"] }),
  });
  const impMut = useMutation({
    mutationFn: (payload: any) => imp({ data: payload }),
    onSuccess: (r) => { toast.success(`Imported ${r.imported} insights`); qc.invalidateQueries({ queryKey: ["memory"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed"),
  });

  if (memoryError) {
    return <div className="text-sm text-destructive">Unable to load learning memory. Please try again.</div>;
  }

  async function doExport() {
    const data = await exp();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "loop-memory.json"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const text = await f.text();
    try {
      const parsed = JSON.parse(text);
      const insights = Array.isArray(parsed) ? parsed : parsed.insights;
      impMut.mutate({ insights });
    } catch {
      toast.error("Invalid JSON");
    }
  }

  const totalItems = data?.length ?? 0;
  const grouped: Record<string, any[]> = {};
  for (const m of (data ?? []).slice(page * pageSize, page * pageSize + pageSize)) (grouped[m.category] ??= []).push(m);
  const groupedEntries = Object.entries(grouped);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Learning Memory</h1>
          <p className="text-sm text-muted-foreground">Durable insights that shape every future caption.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onFile} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-2"/>Import</Button>
          <Button variant="outline" onClick={doExport}><Download className="h-4 w-4 mr-2"/>Export</Button>
          <Button variant="destructive" onClick={() => confirm("Erase all memory?") && resetMut.mutate()}>
            <RotateCcw className="h-4 w-4 mr-2"/>Reset
          </Button>
        </div>
      </div>

      {(data ?? []).length === 0 ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">
          <Brain className="inline h-4 w-4 mr-2 text-primary"/>
          Memory is empty. After your first published post gets analytics, Loop will start extracting insights automatically.
        </CardContent></Card>
      ) : (
        <>
        <div className="grid gap-4 lg:grid-cols-2">
          {groupedEntries.map(([cat, items]) => (
            <Card key={cat}>
              <CardHeader>
                <CardTitle className="capitalize flex items-center gap-2">{cat}</CardTitle>
                <CardDescription>{items.length} insights</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((m) => (
                  <div key={m.id} className="border border-border rounded-md p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <Badge variant="outline" className="text-[10px]">supported {m.support_count}×</Badge>
                      <span className="text-xs text-muted-foreground">{Math.round(m.confidence * 100)}%</span>
                    </div>
                    <Progress value={m.confidence * 100} className="h-1 mb-2" />
                    <p className="text-sm">{m.insight}</p>
                    <Button size="sm" variant="ghost" onClick={() => delMut.mutate(m.id)} className="mt-2 h-7 text-xs">
                      <Trash2 className="h-3 w-3 mr-1"/>Forget
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
        {totalItems > pageSize && (
          <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
            <span>Insights {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalItems)} of {totalItems}</span>
            <div className="flex gap-2">
              <button className="underline disabled:no-underline disabled:opacity-50" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <button className="underline disabled:no-underline disabled:opacity-50" disabled={(page + 1) * pageSize >= totalItems} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
}
