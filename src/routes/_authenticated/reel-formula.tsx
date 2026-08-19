import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { listCampaigns } from "@/lib/campaigns.functions";
import { listChannels } from "@/lib/channels.functions";
import {
  activateRecurringSchedule,
  updateRecurringSchedule,
  deleteRecurringSchedule,
  listFormulaRunHistory,
  listRecurringSchedules,
  runRecurringScheduleNow,
  setRecurringScheduleActive,
  updateRecurringScheduleCloudinaryTransform,
} from "@/lib/recurring-schedules.functions";
import { CloudinaryUpload } from "@/components/cloudinary-upload";
import { RecurringScheduleItemsPanel } from "@/components/recurring-schedule-items-panel";
import { FormulaScheduleEditor } from "@/components/formula-schedule-editor";
import { ContentGalleryPanel } from "@/components/content-gallery-panel";
import { SchedulerStatsPanel } from "@/components/scheduler-stats-panel";
import { ChannelSelect } from "@/components/channel-picker";
import { SchedulerItemHistory } from "@/components/scheduler-item-history";
import { FormulaInsightsPanel } from "@/components/formula-insights-panel";
import { useCampaignScope } from "@/components/campaign-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Pause, Pencil, Play, Repeat2, Trash2 } from "lucide-react";
import { getBufferPlatformCapabilities } from "@/lib/buffer-platforms";
import { FormulaSchedulerFields, type FormulaSchedulerMode } from "@/components/formula-scheduler-fields";
import { CloudinaryTransformFields } from "@/components/cloudinary-transform-fields";
import { PublishModeFields, localInputToIso, type PublishMode } from "@/components/publish-mode-fields";

export const Route = createFileRoute("/_authenticated/reel-formula")({ component: ReelFormulaPage });

type Platform = "instagram" | "tiktok";

function ReelFormulaPage() {
  const { campaignId } = useCampaignScope();
  const listCampaignsFn = useServerFn(listCampaigns);
  const listChannelsFn = useServerFn(listChannels);
  const listSchedulesFn = useServerFn(listRecurringSchedules);
  const activateFn = useServerFn(activateRecurringSchedule);
  const updateScheduleFn = useServerFn(updateRecurringSchedule);
  const setActiveFn = useServerFn(setRecurringScheduleActive);
  const runNowFn = useServerFn(runRecurringScheduleNow);
  const deleteFn = useServerFn(deleteRecurringSchedule);
  const updateCloudinaryFn = useServerFn(updateRecurringScheduleCloudinaryTransform);
  const listHistoryFn = useServerFn(listFormulaRunHistory);
  const qc = useQueryClient();

  const { data: campaigns } = useQuery({ queryKey: ["campaigns"], queryFn: () => listCampaignsFn() });
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(campaignId ?? "none");
  const scopeCampaignId = selectedCampaignId === "none" ? null : selectedCampaignId;
  const { data: channels } = useQuery({
    queryKey: ["channels", scopeCampaignId],
    queryFn: () => listChannelsFn({ data: { campaign_id: scopeCampaignId } }),
  });
  const { data: schedules } = useQuery({ queryKey: ["recurring-schedules"], queryFn: () => listSchedulesFn() });
  const { data: history } = useQuery({ queryKey: ["formula-history"], queryFn: () => listHistoryFn() });

  const [channelId, setChannelId] = useState("");
  const [mode, setMode] = useState<"single" | "multiple">("single");
  const [postType, setPostType] = useState("reel");
  const [mediaUrl, setMediaUrl] = useState("");
  const [rotationItems, setRotationItems] = useState<Array<{ media_url: string; caption: string }>>([{ media_url: "", caption: "" }]);
  const [caption, setCaption] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [thumbnailTimestamp, setThumbnailTimestamp] = useState(0);
  const [privacyLevel, setPrivacyLevel] = useState("PUBLIC");
  const [allowComments, setAllowComments] = useState(true);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [intervalHours, setIntervalHours] = useState(24);
  const [startImmediately, setStartImmediately] = useState(true);
  const [startAt, setStartAt] = useState("");
  const [schedulerMode, setSchedulerMode] = useState<FormulaSchedulerMode>("every_x_hours");
  const [dailyTimes, setDailyTimes] = useState(["09:00"]);
  const [publishMode, setPublishMode] = useState<PublishMode>("shareNow");
  const [scheduledAt, setScheduledAt] = useState("");
  const [delayMinutes, setDelayMinutes] = useState<number | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [expandedScheduleIds, setExpandedScheduleIds] = useState<Record<string, boolean>>({});
  const [cloudinaryTransformEnabled, setCloudinaryTransformEnabled] = useState(false);
  const [cloudinaryTransform, setCloudinaryTransform] = useState("");
  const [cloudinaryTransformMode, setCloudinaryTransformMode] = useState<"replace" | "stack">("replace");

  const selectedChannel = (channels ?? []).find((channel: any) => channel.id === channelId) as any;
  const platform = (String(selectedChannel?.platform ?? "instagram").toLowerCase().includes("tiktok") ? "tiktok" : "instagram") as Platform;
  const platformCapabilities = getBufferPlatformCapabilities(platform);
  const platformChannels = useMemo(() => (channels ?? []).filter((channel: any) => channel.active && !channel.missing_since), [channels]);

  useEffect(() => {
    if (!channelId && platformChannels[0]) setChannelId(platformChannels[0].id);
    if (platform === "instagram" && !["reel", "story"].includes(postType)) setPostType("reel");
    if (platform === "tiktok" && !["video", "story"].includes(postType)) setPostType("video");
  }, [channelId, platformChannels, platform, postType]);

  const activateMut = useMutation({
    mutationFn: () => activateFn({
      data: {
        campaign_id: scopeCampaignId,
        channel_id: channelId,
        platform,
        post_type: postType as "reel" | "story" | "video",
        mode,
        media_url: mode === "single" ? mediaUrl : rotationItems[0]?.media_url ?? "",
        caption: mode === "single" ? caption : rotationItems[0]?.caption ?? "",
        items: mode === "multiple" ? rotationItems : [],
        share_to_feed: shareToFeed,
        thumbnail_timestamp: Number(thumbnailTimestamp),
        privacy_level: platform === "tiktok" ? privacyLevel as "PUBLIC" | "MUTUAL_FOLLOWS" | "SELF_ONLY" : null,
        allow_comments: allowComments,
        allow_duet: allowDuet,
        allow_stitch: allowStitch,
        interval_hours: Number(intervalHours),
        publish_mode: publishMode,
        custom_schedule_offset_minutes: publishMode === "customScheduled" ? delayMinutes : null,
        custom_schedule_at: publishMode === "customScheduled" && delayMinutes == null ? localInputToIso(scheduledAt) : null,
        scheduler_mode: schedulerMode,
        daily_times: dailyTimes,
        start_at: schedulerMode === "every_x_hours" && !startImmediately ? localInputToIso(startAt) : null,
        cloudinary_transform_enabled: cloudinaryTransformEnabled,
        cloudinary_transform: cloudinaryTransform,
        cloudinary_transform_mode: cloudinaryTransformMode,
      },
    }),
    onSuccess: () => {
      toast.success("1 Reel Formula activated");
      qc.invalidateQueries({ queryKey: ["recurring-schedules"] });
      setMediaUrl("");
      setCaption("");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Activation failed"),
  });

  const editScheduleMut = useMutation({
    mutationFn: (value: any) => updateScheduleFn({ data: value }),
    onSuccess: () => { toast.success("Formula settings saved"); setEditingScheduleId(null); qc.invalidateQueries({ queryKey: ["recurring-schedules"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update formula"),
  });
  const cloudinaryMut = useMutation({
    mutationFn: (value: { id: string; cloudinary_transform_enabled: boolean; cloudinary_transform: string; cloudinary_transform_mode: "replace" | "stack" }) => updateCloudinaryFn({ data: value }),
    onSuccess: () => { toast.success("Formula Cloudinary settings saved"); qc.invalidateQueries({ queryKey: ["recurring-schedules"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const activeMut = useMutation({
    mutationFn: (value: { id: string; is_active: boolean }) => setActiveFn({ data: value }),
    onSuccess: () => { toast.success("Formula updated"); qc.invalidateQueries({ queryKey: ["recurring-schedules"] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Formula deleted"); qc.invalidateQueries({ queryKey: ["recurring-schedules"] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed"),
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Repeat2 className="h-5 w-5 text-primary" />1 Reel Formula</h1>
        <p className="text-sm text-muted-foreground">A separate recurring publisher for one fixed media asset. It does not use AI captions, the adaptive queue, or campaign learning.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Activate 1 Reel Formula</CardTitle><CardDescription>Choose an existing connected Buffer channel and configure one recurring post.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1"><Label>Formula mode</Label><Select value={mode} onValueChange={(value) => setMode(value as "single" | "multiple")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single — one fixed media asset</SelectItem><SelectItem value="multiple">Multiple — rotate an ordered item list</SelectItem></SelectContent></Select></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1"><Label>Campaign (optional)</Label><Select value={selectedCampaignId} onValueChange={(value) => { setSelectedCampaignId(value); setChannelId(""); }}><SelectTrigger><SelectValue placeholder="Shared workspace" /></SelectTrigger><SelectContent><SelectItem value="none">Shared workspace</SelectItem>{(campaigns ?? []).map((campaign: any) => <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>Buffer Connection & Channel</Label><ChannelSelect channels={platformChannels} value={channelId} onValueChange={setChannelId} placeholder="Select a connected channel" includeMissing={false} /></div>
          </div>

          {selectedChannel ? (
            <div className="rounded-md border p-4 space-y-4">
              <div className="text-sm font-medium">{platform === "instagram" ? "Instagram settings" : "TikTok settings"}</div>
              {platformCapabilities.metadataSupport === "limited" && <p className="text-xs text-warning">{platformCapabilities.notes} Unsupported platform controls are stored with the formula but are not sent to Buffer.</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1"><Label>Post Type</Label><Select value={postType} onValueChange={setPostType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{platform === "instagram" ? <><SelectItem value="reel">Reel</SelectItem><SelectItem value="story">Story</SelectItem></> : <><SelectItem value="video">Video</SelectItem><SelectItem value="story">Story</SelectItem></>}</SelectContent></Select></div>
                {mode === "single" ? <div className="space-y-2"><Label>Media URL or upload</Label><Input type="url" value={mediaUrl} onChange={(event) => setMediaUrl(event.target.value)} placeholder="https://…/video.mp4" /><CloudinaryUpload onUploaded={setMediaUrl} onSelectExisting={setMediaUrl} /></div> : <div className="space-y-3 md:col-span-2"><Label>Rotation items (ordered)</Label>{rotationItems.map((item, index) => <div key={index} className="rounded-md border p-3 space-y-2"><div className="flex items-center justify-between"><span className="text-sm font-medium">Item {index + 1}</span><div className="flex gap-1"><Button type="button" size="sm" variant="outline" disabled={index === 0} onClick={() => setRotationItems((items) => items.map((value, itemIndex) => itemIndex === index - 1 ? items[index] : itemIndex === index ? items[index - 1] : value))}>Up</Button><Button type="button" size="sm" variant="outline" disabled={index === rotationItems.length - 1} onClick={() => setRotationItems((items) => items.map((value, itemIndex) => itemIndex === index + 1 ? items[index] : itemIndex === index ? items[index + 1] : value))}>Down</Button><Button type="button" size="sm" variant="ghost" disabled={rotationItems.length <= 1} onClick={() => setRotationItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button></div></div><Input type="url" value={item.media_url} onChange={(event) => setRotationItems((items) => items.map((value, itemIndex) => itemIndex === index ? { ...value, media_url: event.target.value } : value))} placeholder="https://…/video.mp4" /><CloudinaryUpload onUploaded={(url) => setRotationItems((items) => items.map((value, itemIndex) => itemIndex === index ? { ...value, media_url: url } : value))} onSelectExisting={(url) => setRotationItems((items) => items.map((value, itemIndex) => itemIndex === index ? { ...value, media_url: url } : value))} /><Textarea value={item.caption} onChange={(event) => setRotationItems((items) => items.map((value, itemIndex) => itemIndex === index ? { ...value, caption: event.target.value } : value))} placeholder="Caption for this item" /></div>)}<Button type="button" variant="outline" onClick={() => setRotationItems((items) => [...items, { media_url: "", caption: "" }])}>Add rotation item</Button></div>}
              </div>
              {mode === "single" && <div className="space-y-1"><Label>Caption</Label><Textarea value={caption} onChange={(event) => setCaption(event.target.value)} disabled={platform === "instagram" && postType === "story"} placeholder={platform === "instagram" && postType === "story" ? "Disabled for Instagram Stories" : "Caption to publish each time"} /></div>}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1"><Label>Thumbnail Timestamp (seconds)</Label><Input type="number" min={0} step="0.1" value={thumbnailTimestamp} onChange={(event) => setThumbnailTimestamp(Number(event.target.value))} /></div>
                {platform === "tiktok" && <div className="space-y-1"><Label>Privacy Level</Label><Select value={privacyLevel} onValueChange={setPrivacyLevel} disabled={platformCapabilities.metadataSupport === "limited"}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PUBLIC">PUBLIC</SelectItem><SelectItem value="MUTUAL_FOLLOWS">MUTUAL_FOLLOWS</SelectItem><SelectItem value="SELF_ONLY">SELF_ONLY</SelectItem></SelectContent></Select></div>}
              </div>
              {platform === "instagram" ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={shareToFeed && postType === "reel"} disabled={postType !== "reel"} onCheckedChange={(checked) => setShareToFeed(Boolean(checked))} />Share to Feed</label> : <div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm"><Checkbox checked={allowComments} disabled={platformCapabilities.metadataSupport === "limited"} onCheckedChange={(checked) => setAllowComments(Boolean(checked))} />Allow Comments</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={allowDuet} disabled={platformCapabilities.metadataSupport === "limited"} onCheckedChange={(checked) => setAllowDuet(Boolean(checked))} />Allow Duet</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={allowStitch} disabled={platformCapabilities.metadataSupport === "limited"} onCheckedChange={(checked) => setAllowStitch(Boolean(checked))} />Allow Stitch</label></div>}
            </div>
          ) : <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">Connect and select a Buffer channel before configuring the formula.</div>}

          <FormulaSchedulerFields mode={schedulerMode} intervalHours={intervalHours} dailyTimes={dailyTimes} onModeChange={setSchedulerMode} onIntervalChange={setIntervalHours} onDailyTimesChange={setDailyTimes} />
          <PublishModeFields mode={publishMode} onModeChange={setPublishMode} scheduledAt={scheduledAt} onScheduledAtChange={setScheduledAt} delayMinutes={delayMinutes} onDelayMinutesChange={setDelayMinutes} />
          <CloudinaryTransformFields enabled={cloudinaryTransformEnabled} transformation={cloudinaryTransform} mode={cloudinaryTransformMode} sampleUrl={mode === "single" ? mediaUrl : rotationItems[0]?.media_url} onEnabledChange={setCloudinaryTransformEnabled} onTransformationChange={setCloudinaryTransform} onModeChange={setCloudinaryTransformMode} />
          {schedulerMode === "every_x_hours" && <div className="rounded-md border p-4 space-y-3"><div className="font-medium text-sm">First run</div><div className="flex gap-2"><Button type="button" variant={startImmediately ? "default" : "outline"} onClick={() => setStartImmediately(true)}>Start immediately</Button><Button type="button" variant={!startImmediately ? "default" : "outline"} onClick={() => setStartImmediately(false)}>Specific UTC time</Button></div>{!startImmediately && <Input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />}</div>}
          <Button onClick={() => activateMut.mutate()} disabled={!channelId || (mode === "single" ? !mediaUrl : rotationItems.some((item) => !item.media_url)) || !intervalHours || (!startImmediately && !startAt) || activateMut.isPending}><Repeat2 className="h-4 w-4 mr-2" />Activate 1 Reel Formula</Button>
        </CardContent>
      </Card>

      <ContentGalleryPanel compact onSelect={(url) => { if (mode === "single") setMediaUrl(url); else setRotationItems((items) => items.map((item, index) => index === 0 ? { ...item, media_url: url } : item)); toast.success("Gallery media selected"); }} />

      <Card>
        <CardHeader><CardTitle>Active formulas</CardTitle><CardDescription>Pause, resume, or delete recurring formulas. Each formula runs independently from the main adaptive loop.</CardDescription></CardHeader>
        <CardContent>
          {!schedules?.length ? <div className="text-sm text-muted-foreground">No formulas activated yet.</div> : (
            <div className="space-y-3">
              {schedules.map((schedule: any) => {
                const isExpanded = Boolean(expandedScheduleIds[schedule.id]);
                return (
                  <div key={schedule.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{schedule.channels?.name ?? "Channel"} · {schedule.platform} {schedule.post_type}</div>
                        <div className="text-xs text-muted-foreground truncate">Every {schedule.interval_hours}h · next {new Date(schedule.next_run_at).toLocaleString()}</div>
                      </div>
                      <Button type="button" size="sm" variant="outline" aria-expanded={isExpanded} onClick={() => setExpandedScheduleIds((current) => ({ ...current, [schedule.id]: !isExpanded }))}>{isExpanded ? "Hide Details" : "Show Details"}</Button>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-muted-foreground truncate">{schedule.media_url}</div>
                          {schedule.last_error && <div className="text-xs text-destructive">{schedule.last_error}</div>}
                          {schedule.mode === "multiple" && <RecurringScheduleItemsPanel scheduleId={schedule.id} />}
                          <div className="flex flex-wrap items-start gap-2">
                            <SchedulerItemHistory source="formula" itemId={schedule.id} />
                            <FormulaInsightsPanel scheduleId={schedule.id} />
                          </div>
                          <div className="mt-3"><CloudinaryTransformFields enabled={Boolean(schedule.cloudinary_transform_enabled)} transformation={schedule.cloudinary_transform ?? ""} mode={schedule.cloudinary_transform_mode === "stack" ? "stack" : "replace"} sampleUrl={schedule.media_url} onEnabledChange={(cloudinary_transform_enabled) => cloudinaryMut.mutate({ id: schedule.id, cloudinary_transform_enabled, cloudinary_transform: schedule.cloudinary_transform ?? "", cloudinary_transform_mode: schedule.cloudinary_transform_mode === "stack" ? "stack" : "replace" })} onTransformationChange={(cloudinary_transform) => cloudinaryMut.mutate({ id: schedule.id, cloudinary_transform_enabled: Boolean(schedule.cloudinary_transform_enabled), cloudinary_transform, cloudinary_transform_mode: schedule.cloudinary_transform_mode === "stack" ? "stack" : "replace" })} onModeChange={(cloudinary_transform_mode) => cloudinaryMut.mutate({ id: schedule.id, cloudinary_transform_enabled: Boolean(schedule.cloudinary_transform_enabled), cloudinary_transform: schedule.cloudinary_transform ?? "", cloudinary_transform_mode })} /></div>
                          {editingScheduleId === schedule.id && <FormulaScheduleEditor schedule={schedule} channels={channels ?? []} onCancel={() => setEditingScheduleId(null)} onSave={(value) => editScheduleMut.mutate(value)} />}
                        </div>
                        <Button size="icon" variant="ghost" title="Edit" onClick={() => setEditingScheduleId(editingScheduleId === schedule.id ? null : schedule.id)}><Pencil className="h-4 w-4" /></Button>
                        <Badge variant={schedule.is_active ? "default" : "secondary"}>{schedule.is_active ? "active" : "paused"}</Badge>
                        {schedule.scheduler_mode === "manual" && <Button size="sm" variant="outline" onClick={() => runNowFn({ data: { id: schedule.id } }).then(() => { toast.success("Formula published"); qc.invalidateQueries({ queryKey: ["recurring-schedules"] }); }).catch((error) => toast.error(error instanceof Error ? error.message : "Publish failed"))}>Publish next</Button>}
                        <Button size="icon" variant="ghost" title={schedule.is_active ? "Pause" : "Resume"} onClick={() => activeMut.mutate({ id: schedule.id, is_active: !schedule.is_active })}>{schedule.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
                        <Button size="icon" variant="ghost" title="Delete" onClick={() => deleteMut.mutate(schedule.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <SchedulerStatsPanel source="formula" />

      <Card><CardHeader><CardTitle>Recent formula runs</CardTitle><CardDescription>Formula publishes are logged to the shared runs and audit history with the `1_reel_formula` marker.</CardDescription></CardHeader><CardContent>{!history?.length ? <div className="text-sm text-muted-foreground">No formula runs yet.</div> : <div className="space-y-2">{history.map((run: any) => <div key={run.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"><Badge variant={run.status === "complete" ? "default" : run.status === "failed" ? "destructive" : "secondary"}>{run.status}</Badge><span>{new Date(run.started_at).toLocaleString()}</span><span className="text-muted-foreground">{run.published_posts?.[0]?.permalink ?? run.error ?? "No proof yet"}</span></div>)}</div>}</CardContent></Card>
    </div>
  );
}
