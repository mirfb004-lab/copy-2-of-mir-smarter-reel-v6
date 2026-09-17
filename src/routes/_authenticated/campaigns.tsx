import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCampaigns, upsertCampaign, setCampaignStatus, deleteCampaign, updateCampaignPublishing, updateCampaignCloudinaryTransform, resetCampaign } from "@/lib/campaigns.functions";
import { PublishModeFields, PUBLISH_MODES, isoToLocalInput, localInputToIso, type PublishMode } from "@/components/publish-mode-fields";
import { setActiveCampaignId, useActiveCampaignId } from "@/lib/active-campaign";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useState } from "react";
import { Play, Pause, Square, Trash2, Plus, CircleCheck, RotateCcw, RefreshCw, Eraser, Pencil, Check, X } from "lucide-react";
import { MultiChannelCampaignPanel } from "@/components/multi-channel-campaign-panel";
import { CloudinaryTransformFields } from "@/components/cloudinary-transform-fields";
import { FrameSamplingFields } from "@/components/frame-sampling-fields";
import { updateCampaignFrameSampling } from "@/lib/video-frames.functions";
import { SchedulerStatsPanel } from "@/components/scheduler-stats-panel";
import { SchedulerItemHistory } from "@/components/scheduler-item-history";
import {
  createSampleCaption,
  deleteSampleCaption,
  listSampleCaptions,
  setSampleCaptionActive,
  updateCampaignSampleCaptionSettings,
  updateSampleCaption,
} from "@/lib/sample-captions.functions";

export const Route = createFileRoute("/_authenticated/campaigns")({ component: CampaignsPage });

const OBJECTIVES = [
  { v: "followers", l: "Followers growth" },
  { v: "likes", l: "Likes" },
  { v: "comments", l: "Comments" },
  { v: "saves", l: "Saves" },
  { v: "shares", l: "Shares" },
  { v: "reach", l: "Reach" },
  { v: "watch_time", l: "Watch time" },
  { v: "ctr", l: "Click-through" },
  { v: "engagement", l: "Overall engagement" },
  { v: "custom", l: "Custom" },
];

function CampaignsPage() {
  const list = useServerFn(listCampaigns);
  const upsert = useServerFn(upsertCampaign);
  const setStatus = useServerFn(setCampaignStatus);
  const del = useServerFn(deleteCampaign);
  const reset = useServerFn(resetCampaign);
  const updatePublishing = useServerFn(updateCampaignPublishing);
  const updateCloudinary = useServerFn(updateCampaignCloudinaryTransform);
  const updateFrameSampling = useServerFn(updateCampaignFrameSampling);

  const listSamples = useServerFn(listSampleCaptions);
  const createSample = useServerFn(createSampleCaption);
  const updateSample = useServerFn(updateSampleCaption);
  const setSampleActive = useServerFn(setSampleCaptionActive);
  const deleteSample = useServerFn(deleteSampleCaption);
  const updateSampleSettings = useServerFn(updateCampaignSampleCaptionSettings);
  const qc = useQueryClient();
  const activeId = useActiveCampaignId();

  const { data: campaigns, isError: campaignsError } = useQuery({ queryKey: ["campaigns"], queryFn: () => list() });
  const activeCampaign = (campaigns ?? []).find((c) => c.id === activeId) as any;
  const { data: samples, isError: samplesError } = useQuery({
    queryKey: ["sample-captions", activeId],
    queryFn: () => listSamples({ data: { campaign_id: activeId! } }),
    enabled: Boolean(activeId),
  });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [objective, setObjective] = useState("engagement");
  const [channelMode, setChannelMode] = useState<"single" | "multi">("single");
  const [customObj, setCustomObj] = useState("");
  const [shareLearning, setShareLearning] = useState(false);
  const [publishMode, setPublishMode] = useState<PublishMode>("addToQueue");
  const [scheduledAt, setScheduledAt] = useState("");
  const [delayMinutes, setDelayMinutes] = useState<number | null>(null);
  const [cloudinaryTransformEnabled, setCloudinaryTransformEnabled] = useState(false);
  const [cloudinaryTransform, setCloudinaryTransform] = useState("");
  const [cloudinaryTransformMode, setCloudinaryTransformMode] = useState<"replace" | "stack">("replace");
  const [frameSampling, setFrameSampling] = useState(10);
  const [sampleText, setSampleText] = useState("");
  const [editingSampleId, setEditingSampleId] = useState<string | null>(null);
  const [editingSampleText, setEditingSampleText] = useState("");

  const create = useMutation({
    mutationFn: () => upsert({ data: {
      name, description: desc || null, objective,
      custom_objective: objective === "custom" ? customObj : null,
      channel_mode: channelMode,
      share_learning: shareLearning,
      publish_mode: publishMode,
      custom_scheduled_at: publishMode === "customScheduled" ? localInputToIso(scheduledAt) : null,
      publish_delay_minutes: publishMode === "customScheduled" ? delayMinutes : null,
      cloudinary_transform_enabled: cloudinaryTransformEnabled,
      cloudinary_transform: cloudinaryTransform,
      cloudinary_transform_mode: cloudinaryTransformMode,
      frame_sampling_seconds: frameSampling,
    } }),
    onSuccess: (r) => {
      toast.success("Campaign created");
      setName(""); setDesc(""); setCustomObj(""); setChannelMode("single"); setCloudinaryTransformEnabled(false); setCloudinaryTransform(""); setCloudinaryTransformMode("replace"); setFrameSampling(10);
      setActiveCampaignId(r.id);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const statusMut = useMutation({
    mutationFn: (p: { id: string; status: "active" | "paused" | "stopped" }) => setStatus({ data: p }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const cloudinaryMut = useMutation({
    mutationFn: (value: { cloudinary_transform_enabled: boolean; cloudinary_transform: string; cloudinary_transform_mode: "replace" | "stack" }) => updateCloudinary({ data: { id: activeId!, ...value } }),
    onSuccess: () => { toast.success("Cloudinary transformation settings saved"); qc.invalidateQueries({ queryKey: ["campaigns"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const frameSamplingMut = useMutation({
    mutationFn: (frame_sampling_seconds: number) => updateFrameSampling({ data: { id: activeId!, frame_sampling_seconds } }),
    onSuccess: () => { toast.success("Frame sampling saved"); qc.invalidateQueries({ queryKey: ["campaigns"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const publishMut = useMutation({
    mutationFn: (p: { id: string; publish_mode: PublishMode; custom_scheduled_at?: string | null; publish_delay_minutes?: number | null }) =>
      updatePublishing({ data: p }),
    onSuccess: () => { toast.success("Publishing updated"); qc.invalidateQueries({ queryKey: ["campaigns"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const resetMut = useMutation({
    mutationFn: (p: { id: string; clear_queue?: boolean; clear_runs?: boolean; clear_memory?: boolean }) => reset({ data: p }),
    onSuccess: () => { toast.success("Campaign reset"); qc.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const sampleSettingsMut = useMutation({
    mutationFn: (v: { use_sample_captions: boolean; sample_caption_mode: "style_reference" | "learning_seed" }) => updateSampleSettings({ data: { campaign_id: activeId!, ...v } }),
    onSuccess: () => { toast.success("Sample caption settings saved"); qc.invalidateQueries({ queryKey: ["campaigns"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const createSampleMut = useMutation({
    mutationFn: (text: string) => createSample({ data: { campaign_id: activeId!, text } }),
    onSuccess: () => { setSampleText(""); toast.success("Sample caption added"); qc.invalidateQueries({ queryKey: ["sample-captions", activeId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const updateSampleMut = useMutation({
    mutationFn: (v: { id: string; text: string }) => updateSample({ data: v }),
    onSuccess: () => { setEditingSampleId(null); setEditingSampleText(""); toast.success("Sample caption updated"); qc.invalidateQueries({ queryKey: ["sample-captions", activeId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const activeSampleMut = useMutation({
    mutationFn: (v: { id: string; is_active: boolean }) => setSampleActive({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sample-captions", activeId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const deleteSampleMut = useMutation({
    mutationFn: (id: string) => deleteSample({ data: { id } }),
    onSuccess: () => { toast.success("Sample caption deleted"); qc.invalidateQueries({ queryKey: ["sample-captions", activeId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (campaignsError || samplesError) {
    return <div className="text-sm text-destructive">Unable to load campaigns. Please try again.</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-muted-foreground">
          A campaign is a fully isolated publishing context — queue, schedule, memory, and learning are scoped to it.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4"/>New campaign</CardTitle>
          <CardDescription>Give it a niche name, pick an objective, and press Create.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2"><Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fitness Reels — August"/>
          </div>
          <div className="space-y-1 md:col-span-2"><Label>Description (optional)</Label>
            <Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Niche, audience, tone…" />
          </div>
          <div className="space-y-1"><Label>Objective</Label>
            <Select value={objective} onValueChange={setObjective}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                {OBJECTIVES.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {objective === "custom" && (
            <div className="space-y-1"><Label>Custom objective</Label>
              <Input value={customObj} onChange={(e) => setCustomObj(e.target.value)} placeholder="Describe the goal" />
            </div>
          )}
          <div className="space-y-1"><Label>Channel mode</Label>
            <Select value={channelMode} onValueChange={(value) => setChannelMode(value as "single" | "multi")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="single">Single-channel (existing behavior)</SelectItem><SelectItem value="multi">Multi-channel</SelectItem></SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Single-channel keeps the current campaign flow unchanged. Multi-channel lets one queue round publish to multiple selected Buffer channels.</p>
          </div>
          <div className="md:col-span-2">
            <PublishModeFields
              mode={publishMode} onModeChange={setPublishMode}
              scheduledAt={scheduledAt} onScheduledAtChange={setScheduledAt}
              delayMinutes={delayMinutes} onDelayMinutesChange={setDelayMinutes}
            />
          </div>
          <div className="md:col-span-2"><CloudinaryTransformFields enabled={cloudinaryTransformEnabled} transformation={cloudinaryTransform} mode={cloudinaryTransformMode} onEnabledChange={setCloudinaryTransformEnabled} onTransformationChange={setCloudinaryTransform} onModeChange={setCloudinaryTransformMode} /></div>
          <div className="md:col-span-2"><FrameSamplingFields value={frameSampling} onChange={setFrameSampling} /></div>
          <div className="flex items-center gap-3 md:col-span-2 pt-2">
            <Switch id="sl" checked={shareLearning} onCheckedChange={setShareLearning}/>
            <Label htmlFor="sl" className="text-sm font-normal">Share learning across all campaigns (default: isolated)</Label>
          </div>
          <div className="md:col-span-2">
            <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
              Create campaign
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeCampaign && <MultiChannelCampaignPanel campaignId={activeCampaign.id} campaignMode={activeCampaign.channel_mode ?? "single"} />}

      <SchedulerStatsPanel source="loop" />

      {activeCampaign && (
        <Card>
          <CardHeader>
            <CardTitle>AI Video Frame Sampling</CardTitle>
            <CardDescription>How often a preview frame is captured from each video in your browser to feed the Vision AI captioning engine.</CardDescription>
          </CardHeader>
          <CardContent>
            <FrameSamplingFields
              value={Number(activeCampaign.frame_sampling_seconds ?? 10) || 10}
              onChange={(seconds) => frameSamplingMut.mutate(seconds)}
            />
          </CardContent>
        </Card>
      )}

      {activeCampaign && <Card><CardHeader><CardTitle>Cloudinary transformation</CardTitle><CardDescription>Applied only to the temporary media URL sent to Buffer. The campaign queue URL is never rewritten.</CardDescription></CardHeader><CardContent><CloudinaryTransformFields enabled={Boolean(activeCampaign.cloudinary_transform_enabled)} transformation={activeCampaign.cloudinary_transform ?? ""} mode={activeCampaign.cloudinary_transform_mode === "stack" ? "stack" : "replace"} onEnabledChange={(cloudinary_transform_enabled) => cloudinaryMut.mutate({ cloudinary_transform_enabled, cloudinary_transform: activeCampaign.cloudinary_transform ?? "", cloudinary_transform_mode: activeCampaign.cloudinary_transform_mode === "stack" ? "stack" : "replace" })} onTransformationChange={(cloudinary_transform) => cloudinaryMut.mutate({ cloudinary_transform_enabled: Boolean(activeCampaign.cloudinary_transform_enabled), cloudinary_transform, cloudinary_transform_mode: activeCampaign.cloudinary_transform_mode === "stack" ? "stack" : "replace" })} onModeChange={(cloudinary_transform_mode) => cloudinaryMut.mutate({ cloudinary_transform_enabled: Boolean(activeCampaign.cloudinary_transform_enabled), cloudinary_transform: activeCampaign.cloudinary_transform ?? "", cloudinary_transform_mode })} /></CardContent></Card>}

      {activeCampaign && (
        <Card>
          <CardHeader>
            <CardTitle>Sample Captions Library</CardTitle>
            <CardDescription>Optional examples for this campaign. Samples are never used while the switch is off.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <div className="font-medium text-sm">Use sample captions</div>
                <p className="text-xs text-muted-foreground">When enabled, up to five active samples are added to the caption workflow.</p>
              </div>
              <Switch checked={Boolean(activeCampaign.use_sample_captions)} onCheckedChange={(checked) => sampleSettingsMut.mutate({ use_sample_captions: checked, sample_caption_mode: activeCampaign.sample_caption_mode === "learning_seed" ? "learning_seed" : "style_reference" })} disabled={sampleSettingsMut.isPending} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Usage mode</Label>
                <Select value={activeCampaign.sample_caption_mode === "learning_seed" ? "learning_seed" : "style_reference"} onValueChange={(value) => sampleSettingsMut.mutate({ use_sample_captions: Boolean(activeCampaign.use_sample_captions), sample_caption_mode: value as "style_reference" | "learning_seed" })} disabled={sampleSettingsMut.isPending}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="style_reference">Style reference</SelectItem><SelectItem value="learning_seed">Learning seed</SelectItem></SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Style reference guides tone. Learning seed is explicitly user-provided and not analytics-backed.</p>
              </div>
              <div className="space-y-1">
                <Label>Add sample caption</Label>
                <Textarea rows={3} maxLength={4000} value={sampleText} onChange={(e) => setSampleText(e.target.value)} placeholder="Paste a caption example…" />
                <Button size="sm" onClick={() => createSampleMut.mutate(sampleText)} disabled={!sampleText.trim() || createSampleMut.isPending}>Add sample</Button>
              </div>
            </div>
            <div className="space-y-2">
              {(samples ?? []).length === 0 ? <div className="text-sm text-muted-foreground">No sample captions yet.</div> : (samples ?? []).map((sample: any) => (
                <div key={sample.id} className="flex flex-wrap items-start gap-3 rounded-md border p-3">
                  <Switch checked={sample.is_active} onCheckedChange={(checked) => activeSampleMut.mutate({ id: sample.id, is_active: checked })} aria-label="Toggle sample caption" />
                  <div className="min-w-0 flex-1">
                    {editingSampleId === sample.id ? <Textarea rows={3} maxLength={4000} value={editingSampleText} onChange={(e) => setEditingSampleText(e.target.value)} /> : <p className={`whitespace-pre-wrap text-sm ${sample.is_active ? "" : "text-muted-foreground line-through"}`}>{sample.text}</p>}
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{sample.is_active ? "Active" : "Inactive"}</div>
                  </div>
                  {editingSampleId === sample.id ? (
                    <div className="flex gap-1"><Button size="icon" variant="ghost" title="Save sample caption" onClick={() => updateSampleMut.mutate({ id: sample.id, text: editingSampleText })}><Check className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Cancel edit" onClick={() => { setEditingSampleId(null); setEditingSampleText(""); }}><X className="h-4 w-4" /></Button></div>
                  ) : (
                    <div className="flex gap-1"><Button size="icon" variant="ghost" title="Edit sample caption" onClick={() => { setEditingSampleId(sample.id); setEditingSampleText(sample.text); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Delete sample caption" onClick={() => deleteSampleMut.mutate(sample.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>All campaigns ({campaigns?.length ?? 0})</CardTitle>
            <CardDescription>Each campaign is its own room — queue, run numbers, schedule, memory and sheet are isolated. The active campaign at top-left scopes every page.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => { qc.invalidateQueries(); toast.success("Refreshed"); }}>
            <RefreshCw className="h-4 w-4 mr-1"/>Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {!campaigns?.length ? (
            <div className="text-sm text-muted-foreground">No campaigns yet. Create one above to start.</div>
          ) : (
            <ul className="divide-y divide-border">
              {campaigns.map((c) => {
                const isActive = c.id === activeId;
                return (
                  <li key={c.id} className="py-3 flex items-center gap-3 text-sm flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium flex items-center gap-2">
                        {c.name}
                        {isActive && <Badge variant="outline" className="text-[10px]"><CircleCheck className="h-3 w-3 mr-1"/>current</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        Objective: {c.custom_objective || c.objective} · {c.share_learning ? "Shared learning" : "Isolated learning"}
                        {c.description ? ` · ${c.description}` : ""}
                      </div>
                    </div>
                    <div className="w-full md:w-auto flex items-center gap-2 order-last md:order-none">
                      <Select
                        value={(c as any).publish_mode ?? "addToQueue"}
                        onValueChange={(v) => publishMut.mutate({
                          id: c.id, publish_mode: v as PublishMode,
                          custom_scheduled_at: v === "customScheduled" ? ((c as any).custom_scheduled_at ?? new Date(Date.now() + 5 * 60000).toISOString()) : null,
                          publish_delay_minutes: v === "customScheduled" ? ((c as any).publish_delay_minutes ?? null) : null,
                        })}
                      >
                        <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue/></SelectTrigger>
                        <SelectContent>
                          {PUBLISH_MODES.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {(c as any).publish_mode === "customScheduled" && (
                        <>
                          <Input
                            type="datetime-local" className="h-8 w-[190px] text-xs"
                            value={isoToLocalInput((c as any).custom_scheduled_at)}
                            onChange={(e) => publishMut.mutate({ id: c.id, publish_mode: "customScheduled", custom_scheduled_at: localInputToIso(e.target.value), publish_delay_minutes: null })}
                          />
                          <Button size="sm" variant="outline" className="h-8 text-xs"
                            onClick={() => publishMut.mutate({ id: c.id, publish_mode: "customScheduled", custom_scheduled_at: null, publish_delay_minutes: 5 })}>
                            +5 min
                          </Button>
                        </>
                      )}
                    </div>
                    <SchedulerItemHistory source="loop" itemId={c.id} />
                    <Badge variant={c.status === "active" ? "default" : c.status === "paused" ? "secondary" : "destructive"} className="capitalize">
                      {c.status}
                    </Badge>
                    {!isActive && (
                      <Button size="sm" variant="outline" onClick={() => setActiveCampaignId(c.id)}>Switch to</Button>
                    )}
                    {c.status !== "active" ? (
                      <Button size="icon" variant="ghost" title="Resume" onClick={() => statusMut.mutate({ id: c.id, status: "active" })}>
                        <Play className="h-4 w-4 text-success"/>
                      </Button>
                    ) : (
                      <Button size="icon" variant="ghost" title="Pause" onClick={() => statusMut.mutate({ id: c.id, status: "paused" })}>
                        <Pause className="h-4 w-4"/>
                      </Button>
                    )}
                    {c.status !== "stopped" && (
                      <Button size="icon" variant="ghost" title="Stop" onClick={() => statusMut.mutate({ id: c.id, status: "stopped" })}>
                        <Square className="h-4 w-4 text-destructive"/>
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" title="Reset runs & requeue videos (starts numbering at 1)"
                      disabled={resetMut.isPending}
                      onClick={() => {
                        if (confirm(`Reset "${c.name}"? Its run history is deleted and its videos go back to pending — numbering restarts at 1. Other campaigns are untouched.`))
                          resetMut.mutate({ id: c.id, clear_runs: true, clear_queue: false });
                      }}>
                      <RotateCcw className="h-4 w-4"/>
                    </Button>
                    <Button size="icon" variant="ghost" title="Wipe everything in this campaign (queue + runs + memory)"
                      disabled={resetMut.isPending}
                      onClick={() => {
                        if (confirm(`Wipe ALL data in "${c.name}" — queue, runs and learned memory? The campaign itself stays.`))
                          resetMut.mutate({ id: c.id, clear_runs: true, clear_queue: true, clear_memory: true });
                      }}>
                      <Eraser className="h-4 w-4 text-warning"/>
                    </Button>
                    <Button size="icon" variant="ghost" title="Delete" onClick={() => {
                      if (confirm(`Delete campaign "${c.name}"? All queue/runs/memory scoped to it will be removed.`)) delMut.mutate(c.id);
                    }}>
                      <Trash2 className="h-4 w-4 text-destructive"/>
                    </Button>
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
