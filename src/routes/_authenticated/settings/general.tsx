import { createFileRoute } from "@tanstack/react-router";
import { useScopedCampaignId } from "@/components/campaign-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAllSettings, updateGeneralSettings, updateProfile } from "@/lib/settings.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { ThemeSettings } from "@/components/theme-settings";

export const Route = createFileRoute("/_authenticated/settings/general")({ component: GeneralSettings });

function GeneralSettings() {
  const get = useServerFn(getAllSettings);
  const updG = useServerFn(updateGeneralSettings);
  const updP = useServerFn(updateProfile);
  const qc = useQueryClient();
  const campaignId = useScopedCampaignId();
  const { data, isError: settingsError } = useQuery({ queryKey: ["settings", campaignId], queryFn: () => get({ data: { campaign_id: campaignId } }) });

  const [g, setG] = useState<any>(null);
  const [p, setP] = useState<any>(null);
  useEffect(() => { if (data?.general) setG(data.general); if (data?.profile) setP(data.profile); }, [data]);

  const gMut = useMutation({
    mutationFn: () => updG({ data: {
      max_retries: Number(g.max_retries), retry_interval_s: Number(g.retry_interval_s),
      analytics_delay_h: Number(g.analytics_delay_h), rate_limit_per_min: Number(g.rate_limit_per_min),
    } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const pMut = useMutation({
    mutationFn: () => updP({ data: { display_name: p.display_name ?? null, timezone: p.timezone } }),
    onSuccess: () => { toast.success("Profile saved"); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (settingsError) return <div className="text-sm text-destructive">Unable to load general settings. Please try again.</div>;
  if (!g || !p) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">General</h1>
        <p className="text-sm text-muted-foreground">Retry, rate limits, analytics delay, profile.</p>
      </div>

      <ThemeSettings />

      <Card>
        <CardHeader><CardTitle>Runtime</CardTitle><CardDescription>How the loop handles failures & pacing.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1"><Label>Max retries</Label><Input type="number" value={g.max_retries} onChange={e => setG({ ...g, max_retries: e.target.value })}/></div>
          <div className="space-y-1"><Label>Retry interval (seconds)</Label><Input type="number" value={g.retry_interval_s} onChange={e => setG({ ...g, retry_interval_s: e.target.value })}/></div>
          <div className="space-y-1"><Label>Analytics fetch delay (hours after post)</Label><Input type="number" value={g.analytics_delay_h} onChange={e => setG({ ...g, analytics_delay_h: e.target.value })}/></div>
          <div className="space-y-1"><Label>Rate limit / min</Label><Input type="number" value={g.rate_limit_per_min} onChange={e => setG({ ...g, rate_limit_per_min: e.target.value })}/></div>
          <div className="md:col-span-2"><Button onClick={() => gMut.mutate()}>Save runtime</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1"><Label>Display name</Label><Input value={p.display_name ?? ""} onChange={e => setP({ ...p, display_name: e.target.value })}/></div>
          <div className="space-y-1"><Label>Timezone</Label><Input value={p.timezone} onChange={e => setP({ ...p, timezone: e.target.value })} placeholder="UTC"/></div>
          <div className="md:col-span-2"><Button onClick={() => pMut.mutate()}>Save profile</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
