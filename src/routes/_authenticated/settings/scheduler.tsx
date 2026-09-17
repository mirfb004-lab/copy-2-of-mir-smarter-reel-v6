import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSchedules, upsertSchedule, deleteSchedule, setSchedulePaused } from "@/lib/schedule.functions";
import { listChannels } from "@/lib/channels.functions";
import { useScopedCampaignId } from "@/components/campaign-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useState } from "react";
import { Trash2, Play, Pause } from "lucide-react";
import { PublishModeFields, localInputToIso, type PublishMode } from "@/components/publish-mode-fields";
import { ChannelOptionLabel, ChannelSelect } from "@/components/channel-picker";


export const Route = createFileRoute("/_authenticated/settings/scheduler")({ component: SchedulerSettings });

function SchedulerSettings() {
  const list = useServerFn(listSchedules);
  const upsert = useServerFn(upsertSchedule);
  const del = useServerFn(deleteSchedule);
  const pauseFn = useServerFn(setSchedulePaused);
  const chansFn = useServerFn(listChannels);
  const qc = useQueryClient();
  const campaignId = useScopedCampaignId();

  const { data, isError: schedulesError } = useQuery({ queryKey: ["schedules", campaignId], queryFn: () => list({ data: { campaign_id: campaignId } }) });
  const { data: chans, isError: chansError } = useQuery({ queryKey: ["channels", campaignId], queryFn: () => chansFn({ data: { campaign_id: campaignId } }) });

  const [channelId, setChannelId] = useState<string>("");
  const [mode, setMode] = useState<"interval"|"daily_times"|"manual">("interval");
  const [interval, setInterval] = useState<number>(6);
  const [times, setTimes] = useState<string>("09:00, 15:00, 21:00");
  const [publishMode, setPublishMode] = useState<PublishMode>("addToQueue");
  const [scheduledAt, setScheduledAt] = useState("");
  const [delayMinutes, setDelayMinutes] = useState<number | null>(null);

  const mut = useMutation({
    mutationFn: () => upsert({ data: {
      channel_id: channelId, campaign_id: campaignId, mode,
      interval_hours: mode === "interval" ? interval : null,
      daily_times: mode === "daily_times" ? times.split(",").map(s => s.trim()).filter(Boolean) : [],
      active: true,
      publish_mode: publishMode,
      custom_scheduled_at: publishMode === "customScheduled" ? localInputToIso(scheduledAt) : null,
      publish_delay_minutes: publishMode === "customScheduled" ? delayMinutes : null,
    } }),
    onSuccess: () => { toast.success("Schedule saved"); qc.invalidateQueries({ queryKey: ["schedules"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const delMut = useMutation({ mutationFn: (id: string) => del({ data: { id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }) });
  const pauseMut = useMutation({
    mutationFn: (p: { id: string; paused: boolean }) => pauseFn({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedules"] }),
  });


  if (schedulesError || chansError) {
    return <div className="text-sm text-destructive">Unable to load scheduler settings. Please try again.</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Scheduler</h1>
        <p className="text-sm text-muted-foreground">Auto-consume the queue on interval or at daily times.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>New schedule</CardTitle><CardDescription>Per channel. UTC.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1 md:col-span-2"><Label>Channel</Label>
            <ChannelSelect channels={chans ?? []} value={channelId} onValueChange={setChannelId} placeholder="Pick a channel" includeMissing={false} />
          </div>
          <div className="space-y-1"><Label>Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as any)}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="interval">Every X hours</SelectItem>
                <SelectItem value="daily_times">Daily at times</SelectItem>
                <SelectItem value="manual">Manual only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "interval" && (
            <div className="space-y-1"><Label>Hours</Label><Input type="number" min={1} max={168} value={interval} onChange={e => setInterval(Number(e.target.value))}/></div>
          )}
          {mode === "daily_times" && (
            <div className="space-y-1 md:col-span-4"><Label>Times (UTC, comma-separated HH:MM)</Label><Input value={times} onChange={e => setTimes(e.target.value)}/></div>
          )}
          <div className="md:col-span-4">
            <PublishModeFields
              mode={publishMode} onModeChange={setPublishMode}
              scheduledAt={scheduledAt} onScheduledAtChange={setScheduledAt}
              delayMinutes={delayMinutes} onDelayMinutesChange={setDelayMinutes}
            />
          </div>
          <div className="md:col-span-4"><Button onClick={() => mut.mutate()} disabled={!channelId}>Add schedule</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Active schedules</CardTitle></CardHeader>
        <CardContent>
          {(data ?? []).length === 0 ? <div className="text-sm text-muted-foreground">None yet.</div> : (
            <ul className="divide-y divide-border">
              {(data ?? []).map(s => {
                const chan = (chans ?? []).find(c => c.id === s.channel_id);
                return (
                  <li key={s.id} className="py-3 flex items-center gap-3 text-sm">
                    <div className="flex-1">
                      {chan ? <ChannelOptionLabel channel={chan} /> : <div className="font-medium">{s.channel_id}</div>}
                      <div className="text-xs text-muted-foreground">
                        {s.mode === "interval" ? `Every ${s.interval_hours}h` : s.mode === "daily_times" ? `At ${(s.daily_times ?? []).join(", ")} UTC` : "Manual"}
                        {s.next_run_at ? ` · next ${new Date(s.next_run_at).toLocaleString()}` : ""}
                        {s.publish_mode ? ` · ${s.publish_mode === "shareNow" ? "publish immediately" : s.publish_mode === "customScheduled" ? (s.publish_delay_minutes ? `in ${s.publish_delay_minutes} min` : `at ${s.custom_scheduled_at ? new Date(s.custom_scheduled_at).toLocaleString() : "custom time"}`) : "Buffer queue"}` : ""}
                      </div>
                    </div>
                    <Badge variant={s.paused ? "secondary" : s.active ? "default" : "outline"}>
                      {s.paused ? "paused" : s.active ? "active" : "off"}
                    </Badge>
                    {s.paused ? (
                      <Button size="icon" variant="ghost" title="Resume" disabled={pauseMut.isPending} onClick={() => pauseMut.mutate({ id: s.id, paused: false })}>
                        <Play className="h-4 w-4 text-success"/>
                      </Button>
                    ) : (
                      <Button size="icon" variant="ghost" title="Pause" disabled={pauseMut.isPending} onClick={() => pauseMut.mutate({ id: s.id, paused: true })}>
                        <Pause className="h-4 w-4"/>
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" disabled={delMut.isPending} onClick={() => delMut.mutate(s.id)}><Trash2 className="h-4 w-4 text-destructive"/></Button>

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
