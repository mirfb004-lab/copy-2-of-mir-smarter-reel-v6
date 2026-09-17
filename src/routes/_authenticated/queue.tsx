import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { listQueue, addToQueue, removeFromQueue, resetQueueItem, moveQueueItem, listDeadLetters, retryDeadLetter, moveQueueToChannel } from "@/lib/queue.functions";
import { listChannels } from "@/lib/channels.functions";
import { useScopedCampaignId } from "@/components/campaign-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2, RotateCcw, Plus, ListVideo, ArrowUp, ArrowDown, AlertTriangle, RefreshCw, Upload, ArrowRightLeft } from "lucide-react";
import { ChannelSelect } from "@/components/channel-picker";
import { FrameExtractionRunner } from "@/components/frame-extraction-runner";

export const Route = createFileRoute("/_authenticated/queue")({ component: QueuePage });


function QueuePage() {
  const list = useServerFn(listQueue);
  const add = useServerFn(addToQueue);
  const remove = useServerFn(removeFromQueue);
  const reset = useServerFn(resetQueueItem);
  const move = useServerFn(moveQueueItem);
  const chans = useServerFn(listChannels);
  const dead = useServerFn(listDeadLetters);
  const retryDl = useServerFn(retryDeadLetter);
  const qc = useQueryClient();

  const campaignId = useScopedCampaignId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [channelId, setChannelId] = useState<string>("");
  const [bulkFrom, setBulkFrom] = useState<string>("");
  const [bulkTo, setBulkTo] = useState<string>("");
  const moveChan = useServerFn(moveQueueToChannel);

  const { data: items } = useQuery({
    queryKey: ["queue", campaignId],
    queryFn: () => list({ data: { campaign_id: campaignId } }),
  });
  const { data: channels } = useQuery({ queryKey: ["channels", campaignId], queryFn: () => chans({ data: { campaign_id: campaignId } }) });
  const { data: deadItems } = useQuery({ queryKey: ["dead-letters", campaignId], queryFn: () => dead({ data: { campaign_id: campaignId } }) });

  const addMut = useMutation({
    mutationFn: (urls: string[]) => add({ data: { urls, channel_id: channelId || null, campaign_id: campaignId } }),
    onSuccess: (r) => {
      if (r.added && r.skipped) toast.success(`Added ${r.added} · skipped ${r.skipped} duplicate${r.skipped === 1 ? "" : "s"}`);
      else if (r.added) toast.success(`Added ${r.added} video${r.added === 1 ? "" : "s"}`);
      else toast.warning(`Skipped ${r.skipped} duplicate${r.skipped === 1 ? "" : "s"}`);
      setText("");
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rmMut = useMutation({ mutationFn: (id: string) => remove({ data: { id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }) });
  const resetMut = useMutation({ mutationFn: (id: string) => reset({ data: { id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }) });
  const moveMut = useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: "up" | "down" }) => move({ data: { id, direction } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const retryDlMut = useMutation({
    mutationFn: (id: string) => retryDl({ data: { id } }),
    onSuccess: () => {
      toast.success("Requeued for retry");
      qc.invalidateQueries({ queryKey: ["dead-letters"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const moveChanMut = useMutation({
    mutationFn: (v: { ids?: string[]; from_channel_id?: string | null; to_channel_id: string | null }) =>
      moveChan({ data: { ...v, campaign_id: campaignId, only_pending: true } }),
    onSuccess: (r) => {
      toast.success(`Moved ${r.moved} item${r.moved === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["dead-letters"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });


  function submit() {
    const urls = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return toast.error("Paste one or more URLs");
    addMut.mutate(urls);
  }

  async function onFile(f: File) {
    const raw = await f.text();
    // Accept CSV, TSV, or line-per-URL. Extract anything that looks like a URL.
    const urls = Array.from(raw.matchAll(/https?:\/\/[^\s,"']+/gi)).map((m) => m[0]);
    if (!urls.length) return toast.error("No URLs found in file");
    addMut.mutate(urls);
  }


  const list_ = items ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
        <p className="text-sm text-muted-foreground">Paste Cloudinary URLs. Each run consumes one URL from the top. Duplicates are automatically skipped.</p>
        <FrameExtractionRunner />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4"/>Add videos</CardTitle>
          <CardDescription>One URL per line. Assign a default channel (optional).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={6} placeholder="https://res.cloudinary.com/.../video.mp4" value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
          <div className="flex gap-2 items-center">
            <ChannelSelect channels={channels ?? []} value={channelId} onValueChange={setChannelId} placeholder="Default channel (optional)" className="w-64" />
            <Button onClick={submit} disabled={addMut.isPending}>Add to queue</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={addMut.isPending}>
              <Upload className="h-4 w-4 mr-1"/>Import CSV/TXT
            </Button>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/plain" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4"/>Move queue to another channel</CardTitle>
          <CardDescription>Reassign pending/failed items — useful when a Buffer channel was reconnected and got a new ID.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-center">
          <ChannelSelect channels={channels ?? []} value={bulkFrom} onValueChange={setBulkFrom} placeholder="From channel" className="w-56" />
          <ChannelSelect channels={channels ?? []} value={bulkTo} onValueChange={setBulkTo} placeholder="To channel" className="w-56" includeMissing={false} />
          <Button disabled={!bulkFrom || !bulkTo || moveChanMut.isPending}
            onClick={() => moveChanMut.mutate({ from_channel_id: bulkFrom, to_channel_id: bulkTo })}>
            Move all
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ListVideo className="h-4 w-4"/>Queue ({list_.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {list_.length === 0 ? (
            <div className="text-sm text-muted-foreground">Queue is empty.</div>
          ) : (
            <ul className="divide-y divide-border">
              {list_.map((it, i) => (
                <li key={it.id} className="py-3 flex flex-wrap items-center gap-3">
                  <span className="text-xs text-muted-foreground w-8">#{it.position}</span>
                  <Badge variant="outline" className="capitalize">{it.status}</Badge>
                  <span className="font-mono text-xs truncate flex-1 min-w-[120px] text-muted-foreground">{it.cloudinary_url}</span>
                  <ChannelSelect channels={channels ?? []} value={it.channel_id ?? ""} onValueChange={(v) => moveChanMut.mutate({ ids: [it.id], to_channel_id: v })} placeholder="No channel" className="w-44 h-8 text-xs" />
                  {it.error && <span className="text-xs text-destructive truncate max-w-[180px]">{it.error}</span>}
                  {it.status === "pending" && (
                    <>
                      <Button size="icon" variant="ghost" disabled={i === 0 || moveMut.isPending}
                        onClick={() => moveMut.mutate({ id: it.id, direction: "up" })} title="Move up">
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" disabled={i === list_.length - 1 || moveMut.isPending}
                        onClick={() => moveMut.mutate({ id: it.id, direction: "down" })} title="Move down">
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {it.status !== "pending" && (
                    <Button size="icon" variant="ghost" onClick={() => resetMut.mutate(it.id)} title="Reset to pending">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => rmMut.mutate(it.id)} title="Remove">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive"/>Dead letter ({deadItems?.length ?? 0})
          </CardTitle>
          <CardDescription>Items that failed more than their max attempts. Nothing was published — retry to send them back to pending.</CardDescription>
        </CardHeader>
        <CardContent>
          {!deadItems?.length ? (
            <div className="text-sm text-muted-foreground">No failed items. 🎉</div>
          ) : (
            <ul className="divide-y divide-border">
              {deadItems.map((it) => (
                <li key={it.id} className="py-3 flex items-center gap-3">
                  <Badge variant="destructive">{it.last_error_module ?? "error"}</Badge>
                  <span className="font-mono text-xs truncate flex-1 text-muted-foreground">{it.cloudinary_url}</span>
                  <span className="text-xs text-muted-foreground">{it.attempts}/{it.max_attempts} tries</span>
                  {it.error && <span className="text-xs text-destructive truncate max-w-[240px]" title={it.error}>{it.error}</span>}
                  <Button size="sm" variant="outline" onClick={() => retryDlMut.mutate(it.id)}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Retry
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => rmMut.mutate(it.id)} title="Remove">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
