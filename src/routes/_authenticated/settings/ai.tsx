import { createFileRoute } from "@tanstack/react-router";
import { useScopedCampaignId } from "@/components/campaign-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAllSettings, updateAiSettings } from "@/lib/settings.functions";
import {
  getProviderCatalog, updateAIProviders, runHealthCheck, runKeyPoolHealthCheck, getResolvedAISettings,
  discoverGeminiModels,
} from "@/lib/ai-providers.functions";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, XCircle, Loader2, Sparkles, Eye, RefreshCw, Clock, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/ai")({ component: AiSettings });

const objectives = [
  { v: "followers", d: "Grow follower count" },
  { v: "likes", d: "Maximize likes" },
  { v: "comments", d: "Spark conversations" },
  { v: "shares", d: "Get shared widely" },
  { v: "saves", d: "Encourage saves (value)" },
  { v: "watch_time", d: "Increase watch time" },
  { v: "profile_visits", d: "Drive profile visits" },
  { v: "ctr", d: "Click-through to link" },
  { v: "reach", d: "Maximize reach" },
  { v: "engagement", d: "Overall engagement" },
  { v: "brand_awareness", d: "Brand awareness" },
  { v: "custom", d: "Custom (describe below)" },
];

type ProviderId = "google" | "lovable" | "openai" | "openrouter" | "cloudflare" | "groq" | "deepseek";

function AiSettings() {
  const get = useServerFn(getAllSettings);
  const upd = useServerFn(updateAiSettings);
  const getCatalog = useServerFn(getProviderCatalog);
  const getResolved = useServerFn(getResolvedAISettings);
  const updProviders = useServerFn(updateAIProviders);
  const health = useServerFn(runHealthCheck);
  const poolHealth = useServerFn(runKeyPoolHealthCheck);
  const discover = useServerFn(discoverGeminiModels);

  const qc = useQueryClient();
  const campaignId = useScopedCampaignId();

  const { data, isError: settingsError } = useQuery({ queryKey: ["settings", campaignId], queryFn: () => get({ data: { campaign_id: campaignId } }) });
  const { data: catalog, isError: catalogError } = useQuery({ queryKey: ["ai-catalog"], queryFn: () => getCatalog() });
  const { data: resolved, isError: resolvedError } = useQuery({ queryKey: ["ai-resolved", campaignId], queryFn: () => getResolved({ data: { campaign_id: campaignId } }) });

  const [state, setState] = useState<any>(null);
  useEffect(() => { if (data?.ai) setState(data.ai); }, [data]);

  const mut = useMutation({
    mutationFn: () => upd({ data: {
      objective: state.objective, custom_objective: state.custom_objective ?? null,
      brand_tone: state.brand_tone, language: state.language,
      default_hashtags: state.default_hashtags ?? [], max_caption_length: state.max_caption_length,
      temperature: Number(state.temperature), model: state.model,
      user_instructions: state.user_instructions ?? null,
      campaign_id: campaignId,
    } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (settingsError || catalogError || resolvedError) return <div className="text-sm text-destructive">Unable to load AI settings. Please try again.</div>;
  if (!state) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Objective & Providers</h1>
        <p className="text-sm text-muted-foreground">
          {campaignId
            ? "Campaign override — saving here creates AI settings just for the selected campaign. Switch to Global Mode to edit the shared workspace defaults."
            : "Global workspace defaults — used by every campaign without its own override."}
        </p>
      </div>

      <Tabs defaultValue="objective">
        <TabsList>
          <TabsTrigger value="objective">Objective & Voice</TabsTrigger>
          <TabsTrigger value="providers">AI Providers</TabsTrigger>
        </TabsList>

        <TabsContent value="objective" className="space-y-6 pt-4">
          <Card>
            <CardHeader><CardTitle>Objective</CardTitle><CardDescription>What should Loop optimize for?</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1"><Label>Primary objective</Label>
                  <Select value={state.objective} onValueChange={(v) => setState({ ...state, objective: v })}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>{objectives.map(o => <SelectItem key={o.v} value={o.v}>{o.d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Language</Label><Input value={state.language} onChange={(e) => setState({ ...state, language: e.target.value })}/></div>
              </div>
              {state.objective === "custom" && (
                <div className="space-y-1"><Label>Custom objective</Label>
                  <Input value={state.custom_objective ?? ""} onChange={(e) => setState({ ...state, custom_objective: e.target.value })} placeholder="e.g. drive newsletter signups"/></div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Voice</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1"><Label>Brand tone</Label>
                <Input value={state.brand_tone} onChange={(e) => setState({ ...state, brand_tone: e.target.value })} placeholder="witty, direct, curious"/></div>
              <div className="space-y-1"><Label>Default hashtags (comma-separated)</Label>
                <Input value={(state.default_hashtags ?? []).join(", ")} onChange={(e) => setState({ ...state, default_hashtags: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} placeholder="#growth, #startup"/></div>
              <div className="space-y-1"><Label>Extra instructions</Label>
                <Textarea rows={4} value={state.user_instructions ?? ""} onChange={(e) => setState({ ...state, user_instructions: e.target.value })} placeholder="Anything else the AI should always know."/></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Generation</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center justify-between"><Label>Creativity (temperature)</Label><span className="text-xs text-muted-foreground">{Number(state.temperature).toFixed(2)}</span></div>
                <Slider min={0} max={1.5} step={0.05} value={[Number(state.temperature)]} onValueChange={([v]) => setState({ ...state, temperature: v })}/>
              </div>
              <div className="space-y-1"><Label>Max caption length</Label>
                <Input type="number" value={state.max_caption_length} onChange={(e) => setState({ ...state, max_caption_length: Number(e.target.value) })}/></div>
            </CardContent>
          </Card>

          <Button onClick={() => mut.mutate()}>Save AI settings</Button>
        </TabsContent>

        <TabsContent value="providers" className="pt-4">
          {catalog && resolved ? (
            <ProvidersPanel
              catalog={catalog}
              initial={resolved}
              onSave={async (payload) => {
                await updProviders({ data: { ...payload, campaign_id: campaignId } });
                toast.success("Providers saved");
                qc.invalidateQueries({ queryKey: ["ai-resolved"] });
              }}
              onHealth={async (cfg) => health({ data: cfg })}
              onPoolHealth={async (cfg) => poolHealth({ data: cfg })}
              onDiscover={async (apiKey) => (await discover({ data: { apiKey, verify: true } })).models}

            />
          ) : (
            <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin"/>Loading provider catalog…</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface ProviderCfg { id: ProviderId; apiKey: string; apiKeys?: string[]; selectedModel: string; baseUrl?: string | null; accountId?: string | null }
interface ResolvedAI {
  mode: "strict" | "fallback";
  activeProvider: ProviderId;
  fallbackChain: ProviderId[];
  providers: Partial<Record<ProviderId, ProviderCfg>>;
}
interface Catalog {
  meta: Record<ProviderId, { name: string; needsAccountId?: boolean; note?: string }>;
  models: Record<ProviderId, Array<{ id: string; name: string; vision: boolean; isRecommended?: boolean }>>;
}

interface DiscoveredModel {
  id: string; displayName: string;
  status: "working" | "failed" | "untested";
  latencyMs: number; error: string | null; supportsVision: boolean;
}

function ProvidersPanel({
  catalog, initial, onSave, onHealth, onPoolHealth, onDiscover,
}: {
  catalog: Catalog; initial: ResolvedAI;
  onSave: (p: ResolvedAI) => Promise<void>;
  onHealth: (c: ProviderCfg) => Promise<{ ok: boolean; latencyMs: number; error?: string; sample?: string }>;
  onPoolHealth: (c: ProviderCfg) => Promise<{ results: Array<{ index: number; ok: boolean; latencyMs: number; error?: string }> }>;
  onDiscover: (apiKey: string) => Promise<DiscoveredModel[]>;
}) {
  const [mode, setMode] = useState<"strict" | "fallback">(initial.mode);
  const [active, setActive] = useState<ProviderId>(initial.activeProvider);
  const [chain, setChain] = useState<ProviderId[]>(initial.fallbackChain);
  const [providers, setProviders] = useState<Partial<Record<ProviderId, ProviderCfg>>>(initial.providers);
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<Record<string, { ok: boolean; latencyMs: number; error?: string; sample?: string; loading?: boolean }>>({});
  const [keyHealth, setKeyHealth] = useState<Record<string, { loading?: boolean; results?: Array<{ index: number; ok: boolean; latencyMs: number; error?: string }> }>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [lastDiscoveredKey, setLastDiscoveredKey] = useState<string>("");

  const allProviderIds = useMemo(() => Object.keys(catalog.meta) as ProviderId[], [catalog]);



  const ensureCfg = (id: ProviderId): ProviderCfg => providers[id] ?? {
    id, apiKey: "", apiKeys: [], selectedModel: catalog.models[id]?.[0]?.id ?? "",
  };

  const patch = (id: ProviderId, next: Partial<ProviderCfg>) => {
    setProviders({ ...providers, [id]: { ...ensureCfg(id), ...next } });
  };

  // Key pool helpers — index 0 is the primary key, the rest are ordered backups.
  const keysOf = (cfg: ProviderCfg): string[] => [cfg.apiKey ?? "", ...(cfg.apiKeys ?? [])];
  const setKeys = (id: ProviderId, arr: string[]) => {
    const list = arr.length ? arr : [""];
    patch(id, { apiKey: list[0] ?? "", apiKeys: list.slice(1) });
  };

  const moveChain = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= chain.length) return;
    const c = [...chain];
    [c[idx], c[j]] = [c[j], c[idx]];
    setChain(c);
  };

  const toggleInChain = (id: ProviderId) => {
    setChain(chain.includes(id) ? chain.filter((x) => x !== id) : [...chain, id]);
  };

  const runHealth = async (id: ProviderId) => {
    const cfg = ensureCfg(id);
    setHealth((h) => ({ ...h, [id]: { ...(h[id] ?? { ok: false, latencyMs: 0 }), loading: true } }));
    try {
      const res = await onHealth(cfg);
      setHealth((h) => ({ ...h, [id]: { ...res, loading: false } }));
    } catch (e) {
      setHealth((h) => ({ ...h, [id]: { ok: false, latencyMs: 0, error: e instanceof Error ? e.message : "failed", loading: false } }));
    }
  };

  const runKeyPoolHealth = async (id: ProviderId) => {
    const cfg = ensureCfg(id);
    setKeyHealth((h) => ({ ...h, [id]: { ...(h[id] ?? {}), loading: true } }));
    try {
      const res = await onPoolHealth(cfg);
      setKeyHealth((h) => ({ ...h, [id]: { loading: false, results: res.results } }));
      const ok = res.results.filter((r) => r.ok).length;
      toast.success(`${ok}/${res.results.length} ${catalog.meta[id].name} keys working`);
    } catch (e) {
      setKeyHealth((h) => ({ ...h, [id]: { loading: false } }));
      toast.error(e instanceof Error ? e.message : "Key test failed");
    }
  };

  const googleKey = providers.google?.apiKey ?? "";

  const runDiscovery = async (apiKey: string) => {
    if (!apiKey) return;
    setDiscovering(true);
    setDiscoverError(null);
    setLastDiscoveredKey(apiKey);
    try {
      const models = await onDiscover(apiKey);
      setDiscovered(models);
      const working = models.filter((m) => m.status === "working");
      toast.success(`Discovered ${models.length} models — ${working.length} verified working`);
      // Auto-select a working model if the current one isn't verified.
      const current = providers.google?.selectedModel;
      if (working.length && !working.some((m) => m.id === current)) {
        const best = working.find((m) => m.supportsVision) ?? working[0];
        patch("google", { selectedModel: best.id });
      }
    } catch (e) {
      setDiscovered(null);
      setDiscoverError(e instanceof Error ? e.message : "Discovery failed");
      toast.error(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  };

  // Auto-discover shortly after the Google key is entered/updated.
  useEffect(() => {
    if (!googleKey || googleKey.length < 20 || googleKey === lastDiscoveredKey) return;
    const t = setTimeout(() => { void runDiscovery(googleKey); }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleKey]);


  const save = async () => {
    setSaving(true);
    try {
      await onSave({ mode, activeProvider: active, fallbackChain: chain, providers });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Execution Mode</CardTitle>
          <CardDescription>Strict uses only your active provider. Fallback tries the ranked chain until one succeeds.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button variant={mode === "strict" ? "default" : "outline"} onClick={() => setMode("strict")}>Strict (Single Provider)</Button>
            <Button variant={mode === "fallback" ? "default" : "outline"} onClick={() => setMode("fallback")}>Fallback Chain (Resilient)</Button>
          </div>
          {mode === "strict" ? (
            <div className="space-y-1 max-w-sm">
              <Label>Active provider</Label>
              <Select value={active} onValueChange={(v) => setActive(v as ProviderId)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  {allProviderIds.map((id) => <SelectItem key={id} value={id}>{catalog.meta[id].name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Fallback order</Label>
              <div className="space-y-1">
                {chain.map((id, idx) => (
                  <div key={id} className="flex items-center gap-2 rounded-md border p-2">
                    <span className="text-xs font-mono text-muted-foreground w-6">{idx + 1}.</span>
                    <span className="flex-1 text-sm">{catalog.meta[id].name}</span>
                    <Button size="icon" variant="ghost" onClick={() => moveChain(idx, -1)}><ArrowUp className="h-4 w-4"/></Button>
                    <Button size="icon" variant="ghost" onClick={() => moveChain(idx, 1)}><ArrowDown className="h-4 w-4"/></Button>
                    <Button size="sm" variant="outline" onClick={() => toggleInChain(id)}>Remove</Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {allProviderIds.filter((id) => !chain.includes(id)).map((id) => (
                  <Button key={id} size="sm" variant="outline" onClick={() => toggleInChain(id)}>+ {catalog.meta[id].name}</Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Providers & API keys</h2>
        {allProviderIds.map((id) => {
          const meta = catalog.meta[id];
          const cfg = ensureCfg(id);
          const isGoogle = id === "google";
          const models = isGoogle && discovered?.length
            ? discovered.map((m) => ({
                id: m.id,
                name: m.displayName,
                vision: m.supportsVision,
                isRecommended: m.status === "working",
                status: m.status,
                latencyMs: m.latencyMs,
              }))
            : (catalog.models[id] ?? []).map((m) => ({ ...m, status: undefined as undefined | string, latencyMs: 0 }));
          const h = health[id];

          return (
            <Card key={id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {meta.name}
                      {id === "lovable" && <Badge variant="secondary">Default</Badge>}
                      {mode === "strict" && active === id && <Badge>Active</Badge>}
                      {mode === "fallback" && chain.includes(id) && <Badge variant="outline">#{chain.indexOf(id) + 1}</Badge>}
                    </CardTitle>
                    {meta.note && <CardDescription>{meta.note}</CardDescription>}
                  </div>
                  <div className="flex items-center gap-2">
                    {h && !h.loading && (
                      h.ok
                        ? <Badge className="gap-1"><CheckCircle2 className="h-3 w-3"/>OK · {h.latencyMs}ms</Badge>
                        : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3"/>Failed</Badge>
                    )}
                    <Button size="sm" variant="outline" disabled={h?.loading} onClick={() => runHealth(id)}>
                      {h?.loading ? <Loader2 className="h-4 w-4 animate-spin"/> : "Run Health Check"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label>
                      API Keys{" "}
                      {id === "lovable"
                        ? <span className="text-xs text-muted-foreground">(auto — leave blank to use workspace key)</span>
                        : <span className="text-xs text-muted-foreground">(tried top-to-bottom — next key is used if one fails or hits its quota)</span>}
                    </Label>
                    <div className="flex items-center gap-2">
                      {keysOf(cfg).filter(Boolean).length > 1 && (
                        <Button size="sm" variant="outline" disabled={keyHealth[id]?.loading}
                          onClick={() => runKeyPoolHealth(id)}>
                          {keyHealth[id]?.loading ? <Loader2 className="h-4 w-4 animate-spin"/> : "Test all keys"}
                        </Button>
                      )}
                      <Button size="icon" variant="outline" onClick={() => setShowKey({ ...showKey, [id]: !showKey[id] })}>
                        <Eye className="h-4 w-4"/>
                      </Button>
                    </div>
                  </div>
                  {keysOf(cfg).map((k, ki) => {
                    const kh = keyHealth[id]?.results?.find((r) => r.index === ki);
                    const keys = keysOf(cfg);
                    return (
                      <div key={ki} className="space-y-1">
                        <div className="flex gap-2 items-center">
                          <span className="text-xs font-mono text-muted-foreground w-10 shrink-0">
                            {ki === 0 ? "#1" : `#${ki + 1}`}
                          </span>
                          <Input
                            type={showKey[id] ? "text" : "password"}
                            value={k}
                            onChange={(e) => {
                              const next = [...keys];
                              next[ki] = e.target.value;
                              setKeys(id, next);
                            }}
                            placeholder={id === "lovable" ? "Uses LOVABLE_API_KEY from workspace" : ki === 0 ? "Primary key" : `Backup key #${ki + 1}`}
                          />
                          {kh && (kh.ok
                            ? <Badge className="gap-1 shrink-0"><CheckCircle2 className="h-3 w-3"/>{kh.latencyMs}ms</Badge>
                            : <Badge variant="destructive" className="gap-1 shrink-0"><XCircle className="h-3 w-3"/>Failed</Badge>)}
                          {keys.length > 1 && (
                            <Button size="icon" variant="ghost" className="shrink-0"
                              onClick={() => setKeys(id, keys.filter((_, i) => i !== ki))}>
                              <Trash2 className="h-4 w-4"/>
                            </Button>
                          )}
                        </div>
                        {kh && !kh.ok && kh.error && (
                          <p className="text-[11px] text-destructive pl-12 break-words">{kh.error}</p>
                        )}
                      </div>
                    );
                  })}
                  <Button size="sm" variant="outline" onClick={() => setKeys(id, [...keysOf(cfg), ""])}>
                    <Plus className="h-4 w-4 mr-1"/>Add another {meta.name} key
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="flex items-center gap-2">
                    Model
                    {isGoogle && discovered?.length ? (
                      <span className="text-[10px] text-muted-foreground">(auto-discovered)</span>
                    ) : null}
                  </Label>
                  <Select value={cfg.selectedModel} onValueChange={(v) => patch(id, { selectedModel: v })}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span className="flex items-center gap-2">
                            {m.name}
                            {m.vision && <Badge variant="outline" className="h-4 text-[10px]">Vision</Badge>}
                            {m.status === "working" && <CheckCircle2 className="h-3 w-3 text-primary"/>}
                            {m.status === "failed" && <XCircle className="h-3 w-3 text-destructive"/>}
                            {m.status === "untested" && <Clock className="h-3 w-3 text-muted-foreground"/>}
                            {!m.status && m.isRecommended && <Sparkles className="h-3 w-3 text-primary"/>}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {isGoogle && (
                  <div className="md:col-span-2 space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm font-medium">Model auto-discovery & live verification</p>
                        <p className="text-xs text-muted-foreground">
                          Lists every model your key can call and pings each one to confirm it really works.
                        </p>
                      </div>
                      <Button size="sm" variant="outline" disabled={discovering || !cfg.apiKey}
                        onClick={() => runDiscovery(cfg.apiKey)}>
                        {discovering
                          ? <><Loader2 className="h-4 w-4 animate-spin mr-2"/>Verifying…</>
                          : <><RefreshCw className="h-4 w-4 mr-2"/>Discover & verify</>}
                      </Button>
                    </div>
                    {discoverError && (
                      <div className="text-xs text-destructive rounded border border-destructive/30 bg-destructive/5 p-2">{discoverError}</div>
                    )}
                    {discovered && (
                      <div className="max-h-64 overflow-auto rounded border divide-y">
                        {discovered.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => patch("google", { selectedModel: m.id })}
                            className={`w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/60 ${cfg.selectedModel === m.id ? "bg-muted" : ""}`}
                          >
                            {m.status === "working" && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0"/>}
                            {m.status === "failed" && <XCircle className="h-3.5 w-3.5 text-destructive shrink-0"/>}
                            {m.status === "untested" && <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0"/>}
                            <span className="font-mono truncate flex-1">{m.id}</span>
                            {m.supportsVision && <Badge variant="outline" className="h-4 text-[10px]">Vision</Badge>}
                            <span className="text-muted-foreground w-14 text-right">
                              {m.status === "working" ? `${m.latencyMs}ms` : m.status === "failed" ? "failed" : "—"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {meta.needsAccountId && (
                  <div className="space-y-1">
                    <Label>Account ID</Label>
                    <Input value={cfg.accountId ?? ""} onChange={(e) => patch(id, { accountId: e.target.value })} placeholder="Cloudflare Account ID"/>
                  </div>
                )}
                {h && !h.ok && h.error && (
                  <div className="md:col-span-2 text-xs text-destructive rounded border border-destructive/30 bg-destructive/5 p-2">
                    {h.error}
                  </div>
                )}
                {h && h.ok && h.sample && (
                  <div className="md:col-span-2 text-xs text-muted-foreground">Sample response: <span className="font-mono">{h.sample}</span></div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2"/> : null}
        Save providers
      </Button>
    </div>
  );
}
