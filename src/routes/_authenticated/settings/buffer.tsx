import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBufferCreds, saveBufferCred, deleteBufferCred, syncBufferChannels } from "@/lib/buffer.functions";
import { listChannels, deleteChannel } from "@/lib/channels.functions";
import { ChannelOptionLabel, ChannelSelect } from "@/components/channel-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useState } from "react";
import { useScopedCampaignId } from "@/components/campaign-context";
import { Plug, Trash2, RefreshCw } from "lucide-react";
import { getBufferPlatformCapabilities } from "@/lib/buffer-platforms";

export const Route = createFileRoute("/_authenticated/settings/buffer")({ component: BufferSettings });

function BufferSettings() {
  const list = useServerFn(listBufferCreds);
  const save = useServerFn(saveBufferCred);
  const del = useServerFn(deleteBufferCred);
  const sync = useServerFn(syncBufferChannels);
  const chansFn = useServerFn(listChannels);
  const qc = useQueryClient();
  const campaignId = useScopedCampaignId();

  const { data: creds, isError: credsError } = useQuery({ queryKey: ["buffer-creds", campaignId], queryFn: () => list({ data: { campaign_id: campaignId } }) });
  const { data: chans, isError: chansError } = useQuery({ queryKey: ["channels", campaignId], queryFn: () => chansFn({ data: { campaign_id: campaignId } }) });

  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [syncedPreview, setSyncedPreview] = useState<Array<{ id: string; name: string; platform: string; avatar?: string }>>([]);
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const delChan = useServerFn(deleteChannel);
  const delChanMut = useMutation({
    mutationFn: (v: { id: string; move_queue_to: string | null }) => delChan({ data: v }),
    onSuccess: () => {
      toast.success("Channel removed");
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });



  const syncMut = useMutation({
    mutationFn: (id: string) => sync({ data: { id } }),
    onSuccess: (r) => {
      setSyncedPreview(r.channels);
      toast.success(`Successfully synced ${r.count} channel${r.count === 1 ? "" : "s"} from Buffer`);
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["buffer-creds"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Sync failed"),
  });

  const saveMut = useMutation({
    mutationFn: () => save({ data: { label, api_token: token, graphql_endpoint: "https://api.buffer.com", campaign_id: campaignId } }),
    onSuccess: (r) => {
      toast.success("Saved");
      setLabel(""); setToken("");
      qc.invalidateQueries({ queryKey: ["buffer-creds"] });
      if (r?.id) syncMut.mutate(r.id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["buffer-creds"] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
  });

  if (credsError || chansError) {
    return <div className="text-sm text-destructive">Unable to load Buffer settings. Please try again.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Buffer</h1>
        <p className="text-sm text-muted-foreground">Add your Buffer account — channels sync automatically.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plug className="h-4 w-4"/>Add Buffer account</CardTitle>
          <CardDescription>Paste your Buffer Personal API token. We'll fetch all connected channels for you.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Account name</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My Buffer" />
          </div>
          <div className="space-y-1">
            <Label>Buffer API token</Label>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="1/abc…" />
          </div>
          <div className="md:col-span-2">
            <Button onClick={() => saveMut.mutate()} disabled={!label || !token || saveMut.isPending || syncMut.isPending}>
              {saveMut.isPending || syncMut.isPending ? "Saving & syncing…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Saved accounts</CardTitle></CardHeader>
        <CardContent>
          {(creds ?? []).length === 0 ? <div className="text-sm text-muted-foreground">None yet.</div> : (
            <ul className="divide-y divide-border">
              {(creds ?? []).map((c) => (
                <li key={c.id} className="py-3 flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground">{c.status}</div>
                  </div>
                  <Badge variant={c.status === "connected" ? "default" : "outline"}>{c.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => syncMut.mutate(c.id)} disabled={syncMut.isPending}>
                    <RefreshCw className={`h-4 w-4 mr-1 ${syncMut.isPending ? "animate-spin" : ""}`}/>Resync
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => delMut.mutate(c.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>
                </li>
              ))}
            </ul>
          )}
          {syncedPreview.length > 0 && (
            <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
              <div className="text-xs font-medium mb-2">Last synced ({syncedPreview.length})</div>
              <ul className="flex flex-wrap gap-2">
                {syncedPreview.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-full border border-border bg-background px-2 py-1 text-xs">
                    {s.avatar && <img src={s.avatar} alt="" className="h-4 w-4 rounded-full" />}
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">· {s.platform}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected channels</CardTitle>
          <CardDescription>Automatically populated from your Buffer account. Channels no longer found in Buffer are marked in red — delete them and their queue moves to the channel you pick.</CardDescription>
        </CardHeader>
        <CardContent>
          {(chans ?? []).length === 0 ? <div className="text-sm text-muted-foreground">No channels yet — save an account above.</div> : (
            <ul className="divide-y divide-border">
              {(chans ?? []).map((c) => {
                const missing = Boolean((c as any).missing_since);
                return (
                  <li key={c.id} className={`py-2 flex flex-wrap items-center gap-2 text-sm ${missing ? "text-destructive" : ""}`}>
                    <div className="flex-1 min-w-[160px]">
                      <ChannelOptionLabel channel={c} />
                      <div className={`text-xs ${missing ? "text-destructive/80" : "text-muted-foreground"}`}>
                        {c.platform} · {c.buffer_channel_id}
                        <span className="block">Supports: {getBufferPlatformCapabilities(c.platform).supportedPostTypes.join(", ")} · {getBufferPlatformCapabilities(c.platform).metadataSupport} metadata</span>
                      </div>
                    </div>
                    {missing ? (
                      <>
                        <Badge variant="destructive">not in Buffer</Badge>
                        <ChannelSelect channels={(chans ?? []).filter((o) => o.id !== c.id)} value={moveTargets[c.id] ?? ""} onValueChange={(v) => setMoveTargets((m) => ({ ...m, [c.id]: v }))} placeholder="Move queue to…" className="w-48 h-8 text-xs" includeMissing={false} />
                        <Button size="sm" variant="destructive" disabled={delChanMut.isPending}
                          onClick={() => delChanMut.mutate({ id: c.id, move_queue_to: moveTargets[c.id] || null })}>
                          <Trash2 className="h-4 w-4 mr-1" />Delete
                        </Button>
                      </>
                    ) : (
                      <Badge variant={c.active ? "default" : "outline"}>{c.active ? "active" : "off"}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
