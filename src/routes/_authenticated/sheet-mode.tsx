import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  ExternalLink,
  ArrowLeft,
  Check,
  X,
  Play,
  Settings2,
  Upload,
  Download,
  Eraser,
  Copy,
  RotateCcw,
  Wand2,
} from "lucide-react";
import { CloudinaryUpload } from "@/components/cloudinary-upload";
import { ContentGalleryPanel } from "@/components/content-gallery-panel";
import { SchedulerStatsPanel } from "@/components/scheduler-stats-panel";
import { SchedulerItemHistory } from "@/components/scheduler-item-history";
import { ChannelOptionLabel, ChannelSearchField, filterChannelOptions } from "@/components/channel-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SheetModeCustomizationEditor } from "@/components/sheet-mode-customization-editor";
import { SheetModeSettingsEditor } from "@/components/sheet-mode-settings-editor";
import { AppSchedulerFields } from "@/components/app-scheduler-fields";
import { CloudinaryTransformFields } from "@/components/cloudinary-transform-fields";
import { Textarea } from "@/components/ui/textarea";
import {
  addSheetModeChannelTargets,
  bulkUpdateSheetModeCells,
  createSheetModeRow,
  createSheetModeSheet,
  deleteSheetModeRow,
  deleteSheetModeSheet,
  getSheetModeSheet,
  updateSheetModeSheet,
  importSheetModeRows,
  listSheetModeWorkspace,
  removeDuplicateSheetModeRows,
  removeEmptySheetModeRows,
  removeSheetModeChannelTarget,
  retryFailedSheetModeRows,
  setSheetModeEnabled,
  updateSheetModeChannelCell,
  updateSheetModeRow,
  publishNextSheetMode,
  updateSheetModeChannelCustomization,
  fillSheetModeCaptions,
  fillSheetModeUrls,
  fillAllSheetModeCaptions,
  clearSheetModeRows,
} from "@/lib/sheet-mode.functions";
import { SheetModeImportWizard, parseImportFile, type ParsedImportFile } from "@/components/sheet-mode-import-wizard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";


export const Route = createFileRoute("/_authenticated/sheet-mode")({ component: SheetModePage });
type Settings = {
  name: string;
  publish_mode: "shareNow" | "addToQueue" | "customScheduled";
  custom_schedule_offset_minutes: number | null;
  custom_schedule_at: string | null;
  rows_per_run: number;
  schedule_label: string;
  selection_rule: string;
  after_publish_mark_status: boolean;
  after_publish_save_post_id: boolean;
  after_publish_save_time: boolean;
  after_publish_save_url: boolean;
  retry_failed: boolean;
  scheduler_mode: "every_x_hours" | "daily_times" | "manual";
  scheduler_interval_hours: number;
  daily_times: string[];
  cloudinary_transform_enabled: boolean;
  cloudinary_transform: string;
  cloudinary_transform_mode: "replace" | "stack";
};
type Target = {
  id: string;
  channel_id: string;
  channel_label: string;
  platform: string;
  is_active: boolean;
  backfill_applied: boolean;
  customization?: Record<string, unknown>;
};
type Cell = {
  id: string;
  channel_target_id: string;
  status: "F" | "T";
  published_url: string | null;
};
type Row = {
  id: string;
  status: "pending" | "partial" | "complete";
  caption: string;
  video_url: string;
  priority: number | null;
  weight: number | null;
  channel_statuses: Cell[];
};
type ImportRow = {
  caption: string;
  video_url: string;
  priority?: number | null;
  weight?: number | null;
};
type Column = "caption" | "video_url" | "status" | "published_url";
const DEFAULT: Settings = {
  name: "",
  publish_mode: "shareNow",
  custom_schedule_offset_minutes: null,
  custom_schedule_at: null,
  rows_per_run: 1,
  schedule_label: "",
  selection_rule: "first_ready",
  after_publish_mark_status: true,
  after_publish_save_post_id: true,
  after_publish_save_time: true,
  after_publish_save_url: true,
  retry_failed: true,
  scheduler_mode: "every_x_hours",
  scheduler_interval_hours: 1,
  daily_times: ["09:00"],
  cloudinary_transform_enabled: false,
  cloudinary_transform: "",
  cloudinary_transform_mode: "replace",
};
const RULES = [
  ["first_ready", "First ready"],
  ["random_ready", "Random ready"],
  ["highest_priority", "Highest priority"],
  ["lowest_priority", "Lowest priority"],
  ["newest_created", "Newest created"],
  ["oldest_created", "Oldest created"],
  ["round_robin", "Round robin"],
  ["weighted_random", "Weighted random"],
  ["ai_smart_score", "AI smart score (reserved)"],
] as const;
function msg(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}
function validate(kind: Column, value: string) {
  const v = value.trim();
  if ((kind === "video_url" || kind === "published_url") && v && !/^https?:\/\//i.test(v))
    return "Must start with http:// or https://";
  if (kind === "caption" && v && /^https?:\/\/\S+$/i.test(v))
    return "Caption cannot be only a bare URL";
  if (kind === "status" && v !== "F" && v !== "T") return "Status must be F or T";
  return null;
}
function csvEscape(value: unknown) {
  const v = String(value ?? "");
  return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}
function download(name: string, data: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function parseDelimited(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) =>
      line.split(/\t|,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map((v) => v.trim().replace(/^"|"$/g, "")),
    );
}
function detect(matrix: unknown[][]) {
  const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const first = (matrix[0] ?? []).map(normalize);
  const captionAliases = ["caption", "text", "description", "copy", "captiontext", "posttext"];
  const urlAliases = ["url", "videourl", "link", "mediaurl", "cloudinaryurl", "videolink"];
  const header = first.some((v) => captionAliases.includes(v) || urlAliases.includes(v) || v === "status" || v === "state");
  const start = header ? 1 : 0;
  let ci = first.findIndex((v) => captionAliases.includes(v));
  let ui = first.findIndex((v) => urlAliases.includes(v));
  const width = Math.max(0, ...matrix.map((r) => r.length));
  const scores = Array.from({ length: width }, (_, c) => {
    const vals = matrix.slice(start).map((r) => String(r[c] ?? "").trim()).filter(Boolean);
    const urlShare = vals.length ? vals.filter((v) => /^https?:\/\//i.test(v)).length / vals.length : 0;
    const textShare = vals.length ? vals.filter((v) => !/^https?:\/\//i.test(v) && v.length >= 8).length / vals.length : 0;
    const averageTextLength = vals.length ? vals.reduce((sum, v) => sum + v.length, 0) / vals.length : 0;
    return { c, vals, urlShare, textShare, averageTextLength };
  });
  if (ui < 0) ui = scores.filter((s) => s.urlShare >= 0.5).sort((a, b) => b.urlShare - a.urlShare)[0]?.c ?? -1;
  if (ci < 0)
    ci = scores
      .filter((s) => s.c !== ui && s.textShare >= 0.5 && s.averageTextLength >= 8)
      .sort((a, b) => b.textShare * b.averageTextLength - a.textShare * a.averageTextLength)[0]?.c ?? -1;
  const warnings: string[] = [];
  if (ui < 0) warnings.push("URL column not found — please map manually");
  if (ci < 0) warnings.push("Caption column not found — please map manually");
  const rows: ImportRow[] = [];
  for (let i = start; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    const caption = ci >= 0 ? String(r[ci] ?? "").trim() : "";
    const video_url = ui >= 0 ? String(r[ui] ?? "").trim() : "";
    if (!caption && !video_url) continue;
    if (ci < 0 || ui < 0) continue;
    const issue = validate("video_url", video_url) ?? (caption && validate("caption", caption));
    if (issue || !video_url) {
      warnings.push(`Row ${i + 1}: ${issue ?? "Video URL is required"}`);
      continue;
    }
    rows.push({ caption, video_url });
  }
  return {
    rows,
    mapping: `URL → column ${ui >= 0 ? String.fromCharCode(65 + ui) : "?"}; Caption → column ${ci >= 0 ? String.fromCharCode(65 + ci) : "?"}`,
    warnings,
  };
}

function SheetModePage() {
  const list = useServerFn(listSheetModeWorkspace),
    create = useServerFn(createSheetModeSheet),
    del = useServerFn(deleteSheetModeSheet),
    toggle = useServerFn(setSheetModeEnabled),
    get = useServerFn(getSheetModeSheet),
    updateSettings = useServerFn(updateSheetModeSheet);
  const qc = useQueryClient();
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [settings, setSettings] = useState(DEFAULT);
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [channelSearch, setChannelSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const workspace = useQuery({ queryKey: ["sheet-mode-workspace"], queryFn: () => list() });
  const detail = useQuery({
    queryKey: ["sheet-mode-sheet", sheetId],
    queryFn: () => get({ data: { id: sheetId! } }),
    enabled: Boolean(sheetId),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["sheet-mode-workspace"] });
    void qc.invalidateQueries({ queryKey: ["sheet-mode-sheet", sheetId] });
  };
  const channels = workspace.data?.channels ?? [],
    sheets = workspace.data?.sheets ?? [];
  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          ...settings,
          schedule_label: settings.schedule_label || null,
          selection_rule: settings.selection_rule as any,
          targets: channelIds.map((channel_id) => ({ channel_id, backfill_applied: true })),
        },
      }),
    onSuccess: (r) => {
      toast.success("Sheet created");
      setSettings(DEFAULT);
      setChannelIds([]);
      setChannelSearch("");
      setCreating(false);
      setSheetId(r.id);
      refresh();
    },
    onError: (e) => toast.error(msg(e)),
  });
  if (sheetId && detail.data?.sheet)
    return (
      <div className="space-y-4">
        <SheetGrid
          sheet={detail.data.sheet}
          targets={(detail.data.channel_targets ?? []) as Target[]}
          rows={(detail.data.rows ?? []) as Row[]}
          channels={channels as any[]}
          onBack={() => setSheetId(null)}
          refresh={refresh}
          onSettingsSaved={(values) => updateSettings({ data: { id: sheetId, ...values } })}
        />
        <ContentGalleryPanel />
        <SchedulerStatsPanel source="sheet_mode" />
      </div>
    );
  const action = (p: Promise<unknown>, text?: string) =>
    p
      .then(() => {
        if (text) toast.success(text);
        refresh();
      })
      .catch((e) => toast.error(msg(e)));
  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sheet Mode</h1>
          <p className="text-sm text-muted-foreground">
            A standalone, non-AI bulk publisher for ready-to-post captions and videos.
          </p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="h-4 w-4 mr-2" /> New Sheet
        </Button>
      </div>
      {creating && (
        <Card>
          <CardHeader>
            <CardTitle>Create a sheet</CardTitle>
            <CardDescription>
              Configure sheet-level defaults and initial connected Buffer channels.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label>Name</Label>
              <Input
                value={settings.name}
                onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                placeholder="August Reels Batch"
              />
            </div>
            <div className="space-y-1">
              <Label>Publish mode</Label>
              <Select
                value={settings.publish_mode}
                onValueChange={(v) => setSettings({ ...settings, publish_mode: v as Settings["publish_mode"] })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="shareNow">Publish immediately</SelectItem>
                  <SelectItem value="addToQueue">Add to Buffer queue</SelectItem>
                  <SelectItem value="customScheduled">Custom schedule</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {settings.publish_mode === "customScheduled" && (
              <div className="space-y-1">
                <Label>Custom schedule</Label>
                <Select
                  value={settings.custom_schedule_offset_minutes == null ? "absolute" : String(settings.custom_schedule_offset_minutes)}
                  onValueChange={(v) =>
                    setSettings({
                      ...settings,
                      custom_schedule_offset_minutes: v === "absolute" ? null : Number(v),
                      custom_schedule_at: v === "absolute" ? settings.custom_schedule_at : null,
                    })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">In 5 minutes</SelectItem>
                    <SelectItem value="15">In 15 minutes</SelectItem>
                    <SelectItem value="30">In 30 minutes</SelectItem>
                    <SelectItem value="60">In 60 minutes</SelectItem>
                    <SelectItem value="absolute">Choose date/time</SelectItem>
                  </SelectContent>
                </Select>
                {settings.custom_schedule_offset_minutes == null && (
                  <Input
                    type="datetime-local"
                    value={settings.custom_schedule_at ? settings.custom_schedule_at.slice(0, 16) : ""}
                    onChange={(e) => setSettings({ ...settings, custom_schedule_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                  />
                )}
              </div>
            )}
            <AppSchedulerFields mode={settings.scheduler_mode} intervalHours={settings.scheduler_interval_hours} dailyTimes={settings.daily_times} onModeChange={(scheduler_mode) => setSettings({ ...settings, scheduler_mode })} onIntervalChange={(scheduler_interval_hours) => setSettings({ ...settings, scheduler_interval_hours })} onDailyTimesChange={(daily_times) => setSettings({ ...settings, daily_times })} />
            <CloudinaryTransformFields enabled={settings.cloudinary_transform_enabled} transformation={settings.cloudinary_transform} mode={settings.cloudinary_transform_mode} onEnabledChange={(cloudinary_transform_enabled) => setSettings({ ...settings, cloudinary_transform_enabled })} onTransformationChange={(cloudinary_transform) => setSettings({ ...settings, cloudinary_transform })} onModeChange={(cloudinary_transform_mode) => setSettings({ ...settings, cloudinary_transform_mode })} />
            <div className="space-y-1">
              <Label>Rows per run</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={settings.rows_per_run}
                onChange={(e) =>
                  setSettings({ ...settings, rows_per_run: Number(e.target.value) || 1 })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Schedule label</Label>
              <Input
                value={settings.schedule_label}
                onChange={(e) => setSettings({ ...settings, schedule_label: e.target.value })}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>Selection rule</Label>
              <Select
                value={settings.selection_rule}
                onValueChange={(v) => setSettings({ ...settings, selection_rule: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULES.map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 rounded-md border p-3 space-y-3">
              <div className="font-medium text-sm">After publish</div>
              {[
                ["after_publish_mark_status", "Mark status complete"],
                ["after_publish_save_post_id", "Save Buffer post ID"],
                ["after_publish_save_time", "Save publish time"],
                ["after_publish_save_url", "Save published URL"],
                ["retry_failed", "Retry failed channel publishes"],
              ].map(([key, label]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span>{label}</span>
                  <Switch
                    checked={Boolean(settings[key as keyof Settings])}
                    onCheckedChange={(v) => setSettings({ ...settings, [key]: v })}
                  />
                </div>
              ))}
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label>Initial Buffer channels</Label>
              <ChannelSearchField value={channelSearch} onChange={setChannelSearch} />
              <div className="flex flex-wrap gap-2">
                {channels.length ? (
                  filterChannelOptions(channels as any[], channelSearch).map((c: any) => (
                    <Button
                      key={c.id}
                      type="button"
                      size="sm"
                      variant={channelIds.includes(c.id) ? "default" : "outline"}
                      onClick={() =>
                        setChannelIds((ids) =>
                          ids.includes(c.id) ? ids.filter((id) => id !== c.id) : [...ids, c.id],
                        )
                      }
                    >
                      {channelIds.includes(c.id) && <Check className="h-3 w-3 mr-1" />}
                      <ChannelOptionLabel channel={c} />
                    </Button>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No active connected channels. Sync Buffer first.
                  </span>
                )}
              </div>
            </div>
            <div className="md:col-span-2 flex gap-2">
              <Button
                onClick={() => createMut.mutate()}
                disabled={!settings.name.trim() || createMut.isPending}
              >
                Create Sheet
              </Button>
              <Button variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Your sheets</h2>
          <Badge variant="secondary">{sheets.length}</Badge>
        </div>
        {sheets.length ? (
          sheets.map((s: any) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex gap-2 items-center">
                    <span className="font-medium">{s.name}</span>
                    <Badge variant={s.is_enabled ? "default" : "secondary"}>
                      {s.is_enabled ? "Enabled" : "Paused"}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(s.channel_targets ?? []).map((t: any) => (
                      <Badge variant="outline" key={t.id}>
                        {t.channel_label}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-3">
                    <SchedulerItemHistory source="sheet_mode" itemId={s.id} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={s.is_enabled}
                    onCheckedChange={(v) => action(toggle({ data: { id: s.id, is_enabled: v } }))}
                  />
                  <Button variant="outline" size="sm" onClick={() => setSheetId(s.id)}>
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      window.confirm(`Delete ${s.name}?`) &&
                      action(del({ data: { id: s.id } }), "Sheet deleted")
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No sheets yet. Create one to start.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function SheetGrid({
  sheet,
  targets,
  rows,
  channels,
  onBack,
  refresh,
  onSettingsSaved,
}: {
  sheet: any;
  targets: Target[];
  rows: Row[];
  channels: any[];
  onBack: () => void;
  refresh: () => void;
  onSettingsSaved: (values: any) => Promise<unknown>;
}) {
  const addTarget = useServerFn(addSheetModeChannelTargets),
    removeTarget = useServerFn(removeSheetModeChannelTarget),
    addRow = useServerFn(createSheetModeRow),
    updateRow = useServerFn(updateSheetModeRow),
    deleteRow = useServerFn(deleteSheetModeRow),
    updateCell = useServerFn(updateSheetModeChannelCell),
    publishNext = useServerFn(publishNextSheetMode),
    importRows = useServerFn(importSheetModeRows),
    removeEmpty = useServerFn(removeEmptySheetModeRows),
    removeDuplicates = useServerFn(removeDuplicateSheetModeRows),
    retry = useServerFn(retryFailedSheetModeRows),
    bulk = useServerFn(bulkUpdateSheetModeCells),
    saveCustomization = useServerFn(updateSheetModeChannelCustomization),
    fillCaptions = useServerFn(fillSheetModeCaptions),
    fillUrls = useServerFn(fillSheetModeUrls);
  const fileRef = useRef<HTMLInputElement>(null);
  const [newChannel, setNewChannel] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [backfillNewChannel, setBackfillNewChannel] = useState(false);
  const [preview, setPreview] = useState<{
    rows: ImportRow[];
    mapping: string;
    warnings: string[];
  } | null>(null);
  const [raw, setRaw] = useState("");
  const [google, setGoogle] = useState("");
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [bulkColumn, setBulkColumn] = useState<Column>("caption");
  const [bulkMode, setBulkMode] = useState<"clear" | "overwrite" | "add">("overwrite");
  const [bulkValue, setBulkValue] = useState("");
  const [fillMode, setFillMode] = useState<"caption" | "video_url" | null>(null);
  const [fillValue, setFillValue] = useState("");
  const [customizationTarget, setCustomizationTarget] = useState<string | null>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [customizationDraft, setCustomizationDraft] = useState<Record<string, any>>({});
  const [editingSettings, setEditingSettings] = useState(false);
  const [importFile, setImportFile] = useState<ParsedImportFile | null>(null);
  const [fillAllOpen, setFillAllOpen] = useState(false);
  const [fillAllValue, setFillAllValue] = useState("");
  const [fillAllScope, setFillAllScope] = useState<"empty" | "all">("empty");
  const [clearOpen, setClearOpen] = useState(false);
  const fillAll = useServerFn(fillAllSheetModeCaptions);
  const clearRows = useServerFn(clearSheetModeRows);

  const active = targets.filter((t) => t.is_active);
  const run = (p: Promise<unknown>, text?: string) =>
    p
      .then(() => {
        if (text) toast.success(text);
        refresh();
      })
      .catch((e) => toast.error(msg(e)));
  const select = (column: string, id: string, checked: boolean) =>
    setSelected((s) => {
      const next = { ...s, [column]: new Set(s[column] ?? []) };
      checked ? next[column].add(id) : next[column].delete(id);
      return next;
    });
  const all = (column: string, checked: boolean) =>
    setSelected((s) => ({ ...s, [column]: checked ? new Set(rows.map((r) => r.id)) : new Set() }));
  const selectedIds = [...(selected[bulkColumn] ?? new Set())];
  const parseFile = async (file: File) => {
    try {
      setImportFile(await parseImportFile(file));
    } catch (e) {
      toast.error(msg(e));
    }
  };

  const parseRaw = () => setPreview(detect(parseDelimited(raw)));
  const parseGoogle = async () => {
    try {
      const r = await fetch(google);
      if (!r.ok) throw new Error("Could not fetch URL");
      setPreview(detect(parseDelimited(await r.text())));
    } catch (e) {
      toast.error(`${msg(e)}. Use a published CSV URL.`);
    }
  };
  const exportCsv = () => {
    const header = [
      "STATUS",
      "CAPTION",
      "VIDEO URL",
      ...active.flatMap((t) => [`${t.channel_label} STATUS`, `${t.channel_label} PUBLISHED URL`]),
    ];
    const lines = [
      header,
      ...rows.map((r) => [
        r.status,
        r.caption,
        r.video_url,
        ...active.flatMap((t) => {
          const c = r.channel_statuses.find((x) => x.channel_target_id === t.id);
          return [c?.status ?? "F", c?.published_url ?? ""];
        }),
      ]),
    ].map((line) => line.map(csvEscape).join(","));
    download(`${sheet.name.replace(/\W+/g, "-")}.csv`, lines.join("\n"));
  };
  return (
    <div className="space-y-5 max-w-[1500px]">
      {importFile && (
        <SheetModeImportWizard
          parsed={importFile}
          onCancel={() => setImportFile(null)}
          onConfirm={(importedRows) =>
            importRows({ data: { sheet_id: sheet.id, rows: importedRows, allow_partial: true } })
              .then((result) => {
                toast.success(`Imported ${result.inserted} rows${result.skipped ? `, skipped ${result.skipped}` : ""}`);
                setImportFile(null);
                refresh();
              })
              .catch((e) => toast.error(msg(e)))
          }
        />
      )}
      <Dialog open={fillAllOpen} onOpenChange={setFillAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fill all Captions</DialogTitle>
            <DialogDescription>Apply one caption across the rows in this sheet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Caption</Label>
              <Textarea value={fillAllValue} onChange={(e) => setFillAllValue(e.target.value)} placeholder="Follow for more" />
            </div>
            <RadioGroup value={fillAllScope} onValueChange={(v) => setFillAllScope(v as "empty" | "all")} className="gap-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="empty" id="fill-empty" />
                <Label htmlFor="fill-empty">Fill empty caption cells only</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="all" id="fill-all" />
                <Label htmlFor="fill-all">Overwrite every caption cell</Label>
              </div>
            </RadioGroup>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFillAllOpen(false)}>Cancel</Button>
            <Button
              disabled={!fillAllValue.trim()}
              onClick={() =>
                fillAll({ data: { sheet_id: sheet.id, caption: fillAllValue.trim(), scope: fillAllScope } })
                  .then((result) => {
                    toast.success(`Filled ${result.filled} caption${result.filled === 1 ? "" : "s"}`);
                    setFillAllOpen(false);
                    refresh();
                  })
                  .catch((e) => toast.error(msg(e)))
              }
            >
              Apply
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Entire Sheet?</DialogTitle>
            <DialogDescription>This will permanently remove all rows from this sheet.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">Rows to delete: {rows.length}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setClearOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() =>
                clearRows({ data: { sheet_id: sheet.id } })
                  .then((result) => {
                    toast.success(`Deleted ${result.removed} row${result.removed === 1 ? "" : "s"}`);
                    setClearOpen(false);
                    refresh();
                  })
                  .catch((e) => toast.error(msg(e)))
              }
            >
              Delete All Rows
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {editingSettings && <SheetModeSettingsEditor initial={{ name: sheet.name, publish_mode: sheet.publish_mode, custom_schedule_offset_minutes: sheet.custom_schedule_offset_minutes, custom_schedule_at: sheet.custom_schedule_at, rows_per_run: sheet.rows_per_run, schedule_label: sheet.schedule_label, selection_rule: sheet.selection_rule, after_publish_mark_status: sheet.after_publish_mark_status, after_publish_save_post_id: sheet.after_publish_save_post_id, after_publish_save_time: sheet.after_publish_save_time, after_publish_save_url: sheet.after_publish_save_url, retry_failed: sheet.retry_failed, scheduler_mode: sheet.scheduler_mode ?? "every_x_hours", scheduler_interval_hours: sheet.scheduler_interval_hours ?? 1, daily_times: sheet.daily_times ?? ["09:00"], cloudinary_transform_enabled: sheet.cloudinary_transform_enabled ?? false, cloudinary_transform: sheet.cloudinary_transform ?? "", cloudinary_transform_mode: sheet.cloudinary_transform_mode ?? "replace" }} sampleUrl={rows.find((row) => row.status !== "complete" && /^https:\/\/res\.cloudinary\.com\//i.test(row.video_url))?.video_url} onCancel={() => setEditingSettings(false)} onSave={(values) => { onSettingsSaved(values).then(() => { toast.success("Sheet settings saved"); setEditingSettings(false); refresh(); }).catch((error) => toast.error(msg(error))); }} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> All sheets
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{sheet.name}</h1>
          <p className="text-sm text-muted-foreground">
            {sheet.schedule_label || "No schedule label"} ·{" "}
            {sheet.selection_rule.replaceAll("_", " ")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditingSettings((value) => !value)}><Settings2 className="h-4 w-4 mr-2" /> Settings</Button>
          <Button
            onClick={() =>
              run(
                publishNext({ data: { sheet_id: sheet.id } }).then((result) => {
                  const summary = result.noEligiblePendingChannel
                    ? "No rows had an eligible pending channel"
                    : `Publish cycle complete: ${result.succeeded ?? 0} succeeded, ${result.failed ?? 0} failed`;
                  toast[result.failed ? "error" : "success"](summary);
                  return result;
                }),
              )
            }
          >
            <Play className="h-4 w-4 mr-2" /> Publish next
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import and data tools</CardTitle>
          <CardDescription>
            Preview mappings and shape warnings before committing rows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {fillMode && (
            <div className="rounded-md border p-3 space-y-2">
              <Label>{fillMode === "caption" ? "Fill Captions" : "Fill URLs"} — one per line</Label>
              <Textarea value={fillValue} onChange={(e) => setFillValue(e.target.value)} placeholder={fillMode === "caption" ? "Caption one\nCaption two" : "https://example.com/one.mp4\nhttps://example.com/two.mp4"} />
              <div className="flex gap-2">
                <Button onClick={() => {
                  const lines = fillValue.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
                  const request = fillMode === "caption" ? fillCaptions({ data: { sheet_id: sheet.id, lines } }) : fillUrls({ data: { sheet_id: sheet.id, lines } });
                  request.then((result) => { toast.success(`Filled ${result.filled}, created ${result.created}, skipped ${result.skipped}`); setFillMode(null); refresh(); }).catch((e) => toast.error(msg(e)));
                }} disabled={!fillValue.trim()}>Apply</Button>
                <Button variant="outline" onClick={() => setFillMode(null)}>Cancel</Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void parseFile(e.target.files[0])}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" /> Import CSV/XLSX
            </Button>
            <Button variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-2" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => { setFillMode("caption"); setFillValue(""); }}>
              Fill Captions
            </Button>
            <Button variant="outline" onClick={() => { setFillMode("video_url"); setFillValue(""); }}>
              Fill URLs
            </Button>
            <Button variant="outline" onClick={() => { setFillAllValue(""); setFillAllScope("empty"); setFillAllOpen(true); }}>
              <Wand2 className="h-4 w-4 mr-2" /> Fill all Captions
            </Button>
            <Button variant="outline" className="text-destructive" onClick={() => setClearOpen(true)}>
              <Trash2 className="h-4 w-4 mr-2" /> Clear Entire Sheet
            </Button>

            <Button
              variant="outline"
              onClick={() =>
                run(removeEmpty({ data: { sheet_id: sheet.id } }), "Empty rows removed")
              }
            >
              <Eraser className="h-4 w-4 mr-2" /> Remove Empty
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                run(removeDuplicates({ data: { sheet_id: sheet.id } }), "Duplicates removed")
              }
            >
              <Copy className="h-4 w-4 mr-2" /> Remove Duplicates
            </Button>
            <Button
              variant="outline"
              onClick={() => run(retry({ data: { sheet_id: sheet.id } }), "Failed statuses reset")}
            >
              <RotateCcw className="h-4 w-4 mr-2" /> Retry Failed
            </Button>
          </div>
          <div className="flex gap-2">
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Smart Import (Raw): paste mixed captions and URLs…"
            />
            <Button variant="outline" onClick={parseRaw} disabled={!raw.trim()}>
              Preview raw
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={google}
              onChange={(e) => setGoogle(e.target.value)}
              placeholder="Published Google Sheets CSV URL"
            />
            <Button variant="outline" onClick={() => void parseGoogle()} disabled={!google.trim()}>
              Preview Google URL
            </Button>
          </div>
          {preview && (
            <div className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <b>Mapping preview:</b> {preview.mapping}. {preview.rows.length} rows ready;{" "}
                  {preview.warnings.length} skipped/warnings.
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      run(
                        importRows({ data: { sheet_id: sheet.id, rows: preview.rows } }),
                        "Import committed",
                      )
                    }
                  >
                    <Check className="h-4 w-4 mr-1" /> Commit import
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
              {preview.warnings.length > 0 && (
                <div className="mt-2 text-xs text-destructive">
                  {preview.warnings.slice(0, 5).join("; ")}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Content grid</CardTitle>
            <CardDescription>
              Each column has independent selection. Inline edits save on blur or Enter.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() =>
              run(
                addRow({
                  data: {
                    sheet_id: sheet.id,
                    caption: "",
                    video_url: "",
                    priority: null,
                    weight: null,
                  },
                }),
                "Row added",
              )
            }
          >
            <Plus className="h-4 w-4 mr-1" /> Add row
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div ref={gridScrollRef} className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <Header
                    label="STATUS"
                    column="status"
                    rows={rows}
                    selected={selected}
                    all={all}
                  />
                  <Header
                    label="CAPTION"
                    column="caption"
                    rows={rows}
                    selected={selected}
                    all={all}
                  />
                  <Header
                    label="VIDEO URL"
                    column="video_url"
                    rows={rows}
                    selected={selected}
                    all={all}
                  />
                  {active.map((t) => (
                    <>
                      <Header
                        key={`s-${t.id}`}
                        label={`${t.channel_label} · STATUS`}
                        column={`status:${t.id}`}
                        rows={rows}
                        selected={selected}
                        all={all}
                      />
                      <Header
                        key={`u-${t.id}`}
                        label={`${t.channel_label} · PUBLISHED URL`}
                        column={`published_url:${t.id}`}
                        rows={rows}
                        selected={selected}
                        all={all}
                      />
                    </>
                  ))}
                  <th className="w-12 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                <VirtualizedGridBody
                  scrollRef={gridScrollRef}
                  rows={rows}
                  targets={active}
                  selected={selected}
                  select={select}
                  updateRow={(data) => run(updateRow({ data }))}
                  deleteRow={(id) => run(deleteRow({ data: { id } }), "Row deleted")}
                  updateCell={(data) => run(updateCell({ data }))}
                  colSpan={4 + active.length * 2}
                />
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bulk operations</CardTitle>
          <CardDescription>
            Delete/Clear, Overwrite, and Add line-by-line use the same shape validation as imports.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Column</Label>
            <Select value={bulkColumn} onValueChange={(v) => setBulkColumn(v as Column)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="caption">CAPTION</SelectItem>
                <SelectItem value="video_url">VIDEO URL</SelectItem>
                <SelectItem value="status">STATUS</SelectItem>
                <SelectItem value="published_url">PUBLISHED URL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Action</Label>
            <Select value={bulkMode} onValueChange={(v) => setBulkMode(v as any)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clear">Delete / Clear</SelectItem>
                <SelectItem value="overwrite">Overwrite</SelectItem>
                <SelectItem value="add">Add lines</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Textarea
            className="min-w-[240px]"
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            placeholder={bulkMode === "add" ? "one value per line" : "one value"}
          />
          <Button
            disabled={!selectedIds.length || (bulkMode !== "clear" && !bulkValue)}
            onClick={() =>
              run(
                bulk({
                  data: {
                    sheet_id: sheet.id,
                    column: bulkColumn,
                    row_ids: selectedIds,
                    mode: bulkMode,
                    value: bulkValue,
                  },
                }),
                "Bulk operation applied",
              )
            }
          >
            <Wand2 className="h-4 w-4 mr-2" /> Apply to {selectedIds.length}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active channels</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {active.map((t) => (
            <Badge key={t.id} variant="outline">
              {t.channel_label}
              <button
                className="ml-2"
                title="Edit Buffer customization"
                onClick={() => { setCustomizationTarget(t.id); setCustomizationDraft((t.customization && typeof t.customization === "object" ? t.customization : {}) as Record<string, any>); }}
              >
                <Settings2 className="inline h-3 w-3" />
              </button>
              <button
                className="ml-1"
                title="Remove channel"
                onClick={() =>
                  run(
                    removeTarget({ data: { sheet_id: sheet.id, target_id: t.id } }),
                    "Channel removed",
                  )
                }
              >
                <X className="inline h-3 w-3" />
              </button>
            </Badge>
          ))}
          {customizationTarget && (() => {
            const target = active.find((item) => item.id === customizationTarget);
            if (!target) return null;
            return (
              <SheetModeCustomizationEditor
                platform={target.platform}
                value={customizationDraft}
                onChange={setCustomizationDraft}
                onSave={() => saveCustomization({ data: { sheet_id: sheet.id, target_id: target.id, customization: customizationDraft } }).then(() => { toast.success("Channel customization saved"); setCustomizationTarget(null); refresh(); }).catch((e) => toast.error(msg(e)))}
                onCancel={() => setCustomizationTarget(null)}
              />
            );
          })()}
          <div className="flex items-center gap-2 text-sm">
            <input
              id="sheet-mode-backfill"
              type="checkbox"
              checked={backfillNewChannel}
              onChange={(event) => setBackfillNewChannel(event.target.checked)}
            />
            <Label htmlFor="sheet-mode-backfill">Backfill existing rows</Label>
          </div>
          <div className="w-56">
            <ChannelSearchField value={channelSearch} onChange={setChannelSearch} />
            <Select
              value={newChannel}
              onValueChange={(v) => {
                setNewChannel("");
                setChannelSearch("");
                run(
                  addTarget({
                    data: {
                      sheet_id: sheet.id,
                      targets: [{ channel_id: v, backfill_applied: backfillNewChannel }],
                    },
                  }),
                  "Channel added",
                );
              }}
            >
              <SelectTrigger className="mt-1 w-full">
                <SelectValue placeholder="Add channel" />
              </SelectTrigger>
              <SelectContent>
                {filterChannelOptions(channels.filter((c: any) => !active.some((t) => t.channel_id === c.id)), channelSearch).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    <ChannelOptionLabel channel={c} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
const ESTIMATED_GRID_ROW_HEIGHT = 190;

function VirtualizedGridBody({
  scrollRef,
  rows,
  targets,
  selected,
  select,
  updateRow,
  deleteRow,
  updateCell,
  colSpan,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rows: Row[];
  targets: Target[];
  selected: Record<string, Set<string>>;
  select: (column: string, id: string, checked: boolean) => void;
  updateRow: (r: { id: string; caption: string; video_url: string; priority: number | null; weight: number | null }) => void;
  deleteRow: (id: string) => void;
  updateCell: (c: { id: string; status: "F" | "T"; published_url: string | null }) => void;
  colSpan: number;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(700);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const onRowHeight = useCallback((id: string, height: number) => {
    setHeights((current) => current[id] === height ? current : { ...current, [id]: height });
  }, []);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      setScrollTop(element.scrollTop);
      setViewportHeight(element.clientHeight || 700);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollRef]);
  const offsets = useMemo(() => {
    const values = [0];
    for (const row of rows) values.push(values[values.length - 1] + (heights[row.id] ?? ESTIMATED_GRID_ROW_HEIGHT));
    return values;
  }, [rows, heights]);
  if (!rows.length) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 py-10 text-center text-muted-foreground">
          No rows yet. Add a row or import content.
        </td>
      </tr>
    );
  }
  const findIndex = (position: number) => {
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (offsets[middle + 1] <= position) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, rows.length - 1);
  };
  const overscan = 5;
  const start = Math.max(0, findIndex(scrollTop) - overscan);
  const end = Math.min(rows.length, findIndex(scrollTop + viewportHeight) + overscan + 1);
  const topSpacer = offsets[start];
  const bottomSpacer = offsets[rows.length] - offsets[end];
  return (
    <>
      {topSpacer > 0 && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: topSpacer, padding: 0 }} /></tr>}
      {rows.slice(start, end).map((row) => (
        <GridRow
          key={row.id}
          row={row}
          targets={targets}
          selected={selected}
          select={select}
          updateRow={updateRow}
          deleteRow={deleteRow}
          updateCell={updateCell}
          onHeightChange={onRowHeight}
        />
      ))}
      {bottomSpacer > 0 && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: bottomSpacer, padding: 0 }} /></tr>}
    </>
  );
}

function Header({
  label,
  column,
  rows,
  selected,
  all,
}: {
  label: string;
  column: string;
  rows: Row[];
  selected: Record<string, Set<string>>;
  all: (column: string, checked: boolean) => void;
}) {
  const count = selected[column]?.size ?? 0;
  return (
    <th className="min-w-[170px] px-3 py-2 text-left font-medium">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={rows.length > 0 && count === rows.length}
          onChange={(e) => all(column, e.target.checked)}
        />
        <span>{label}</span>
      </div>
      <div className="text-[10px] font-normal text-muted-foreground">{count} selected</div>
    </th>
  );
}
function GridRow({
  row,
  targets,
  selected,
  select,
  updateRow,
  deleteRow,
  updateCell,
  onHeightChange,
}: {
  row: Row;
  targets: Target[];
  selected: Record<string, Set<string>>;
  select: (column: string, id: string, checked: boolean) => void;
  updateRow: (r: {
    id: string;
    caption: string;
    video_url: string;
    priority: number | null;
    weight: number | null;
  }) => void;
  deleteRow: (id: string) => void;
  updateCell: (c: { id: string; status: "F" | "T"; published_url: string | null }) => void;
  onHeightChange?: (id: string, height: number) => void;
}) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [caption, setCaption] = useState(row.caption);
  const [url, setUrl] = useState(row.video_url);
  useEffect(() => {
    const element = rowRef.current;
    if (!element || !onHeightChange) return;
    const report = () => onHeightChange(row.id, element.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [row.id, onHeightChange]);
  const save = () => {
    const issue = validate("caption", caption) ?? validate("video_url", url);
    if (issue) {
      toast.error(issue);
      return;
    }
    updateRow({ id: row.id, caption, video_url: url, priority: row.priority, weight: row.weight });
  };
  return (
    <tr ref={rowRef} className="border-b align-top">
      <td className="px-3 py-3">
        <div className="flex gap-2">
          <input
            type="checkbox"
            checked={selected.status?.has(row.id) ?? false}
            onChange={(e) => select("status", row.id, e.target.checked)}
          />
          <Badge
            variant={
              row.status === "complete"
                ? "default"
                : row.status === "partial"
                  ? "secondary"
                  : "outline"
            }
          >
            {row.status}
          </Badge>
        </div>
      </td>
      <td className="px-3 py-2">
        <Textarea
          rows={3}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={save}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex gap-2">
          <input
            type="checkbox"
            checked={selected.video_url?.has(row.id) ?? false}
            onChange={(e) => select("video_url", row.id, e.target.checked)}
          />
          <div className="min-w-0 flex-1 space-y-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={save}
              placeholder="https://…"
            />
            <CloudinaryUpload onUploaded={(uploadedUrl) => { setUrl(uploadedUrl); updateRow({ id: row.id, caption, video_url: uploadedUrl, priority: row.priority, weight: row.weight }); }} onSelectExisting={(uploadedUrl) => { setUrl(uploadedUrl); updateRow({ id: row.id, caption, video_url: uploadedUrl, priority: row.priority, weight: row.weight }); }} />
          </div>
        </div>
      </td>
      {targets.map((t) => {
        const cell = row.channel_statuses.find((c) => c.channel_target_id === t.id);
        if (!cell)
          return (
            <td key={t.id} colSpan={2} className="px-3 py-3 text-muted-foreground">
              Not initialized
            </td>
          );
        const sk = `status:${t.id}`,
          uk = `published_url:${t.id}`;
        return (
          <>
            <td key={`${t.id}-s`} className="px-3 py-3">
              <div className="flex gap-2">
                <input
                  type="checkbox"
                  checked={selected[sk]?.has(row.id) ?? false}
                  onChange={(e) => select(sk, row.id, e.target.checked)}
                />
                <button
                  className={`rounded border px-2 py-1 text-xs font-semibold ${cell.status === "T" ? "bg-primary text-primary-foreground" : "bg-background"}`}
                  onClick={() =>
                    updateCell({
                      id: cell.id,
                      status: cell.status === "T" ? "F" : "T",
                      published_url: cell.published_url,
                    })
                  }
                >
                  {cell.status}
                </button>
              </div>
            </td>
            <td key={`${t.id}-u`} className="px-3 py-2">
              <div className="flex gap-2">
                <input
                  type="checkbox"
                  checked={selected[uk]?.has(row.id) ?? false}
                  onChange={(e) => select(uk, row.id, e.target.checked)}
                />
                <Input
                  defaultValue={cell.published_url ?? ""}
                  onBlur={(e) => {
                    const issue = validate("published_url", e.target.value);
                    if (issue) {
                      toast.error(issue);
                      e.target.value = cell.published_url ?? "";
                      return;
                    }
                    updateCell({
                      id: cell.id,
                      status: cell.status,
                      published_url: e.target.value || null,
                    });
                  }}
                  placeholder="https://…"
                />
              </div>
            </td>
          </>
        );
      })}
      <td className="px-3 py-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.confirm("Delete this row?") && deleteRow(row.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}
