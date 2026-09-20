/**
 * Shared Buffer channel-sync logic used by single and bulk credential flows.
 * Server-only: never import at module scope of a *.functions.ts file.
 */
type AnySupabase = any;

export type SyncedChannel = { id: string; name: string; platform: string; avatar?: string };

export async function syncChannelsForCredential(
  supabase: AnySupabase,
  userId: string,
  credentialId: string,
): Promise<{ count: number; channels: SyncedChannel[]; missing: number }> {
  const { data: cred, error } = await supabase
    .from("buffer_credentials")
    .select("api_token,campaign_id")
    .eq("id", credentialId)
    .single();
  if (error || !cred) throw new Error("Credential not found");

  const API_URL = "https://api.buffer.com";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cred.api_token}`,
  };

  async function gql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Buffer ${res.status}: ${text.slice(0, 300)}`);
    const parsed = JSON.parse(text);
    if (parsed?.errors?.length) throw new Error(parsed.errors.map((e: any) => e.message).join("; "));
    return parsed.data as T;
  }

  const orgData = await gql<{ account: { organizations: Array<{ id: string; name: string }> } }>(
    `query GetOrganizations { account { organizations { id name } } }`,
  );
  const orgs = orgData?.account?.organizations ?? [];
  if (orgs.length === 0) throw new Error("No organizations found for this Buffer account");

  const channelQuery = `query GetChannels($organizationId: OrganizationId!) {
    channels(input: { organizationId: $organizationId }) {
      id name service type serviceId avatar
    }
  }`;

  const allChannels: Array<{ id: string; name?: string; service?: string; avatar?: string }> = [];
  for (const org of orgs) {
    const chData = await gql<{ channels: Array<{ id: string; name?: string; service?: string; avatar?: string }> }>(
      channelQuery,
      { organizationId: org.id },
    );
    for (const ch of chData?.channels ?? []) allChannels.push(ch);
  }

  const { data: existing } = await supabase
    .from("channels")
    .select("id,buffer_channel_id")
    .eq("user_id", userId)
    .eq("credential_id", credentialId);
  const existingMap = new Map((existing ?? []).map((c: any) => [c.buffer_channel_id, c.id]));

  const now = new Date().toISOString();
  const synced: SyncedChannel[] = [];
  for (const ch of allChannels) {
    const name = ch.name || ch.service || "Channel";
    const platform = (ch.service || "unknown").toLowerCase();
    if (existingMap.has(ch.id)) {
      await supabase.from("channels").update({
        name, platform, campaign_id: cred.campaign_id ?? null,
        last_seen_at: now, missing_since: null, active: true,
      }).eq("id", existingMap.get(ch.id)!);
    } else {
      await supabase.from("channels").insert({
        user_id: userId,
        credential_id: credentialId,
        buffer_channel_id: ch.id,
        campaign_id: cred.campaign_id ?? null,
        name,
        platform,
        active: true,
        last_seen_at: now,
      });
    }
    synced.push({ id: ch.id, name, platform, avatar: ch.avatar });
  }

  const liveIds = new Set(allChannels.map((c) => c.id));
  const stale = (existing ?? []).filter((c: any) => !liveIds.has(c.buffer_channel_id));
  if (stale.length) {
    await supabase
      .from("channels")
      .update({ missing_since: now, active: false })
      .in("id", stale.map((c: any) => c.id));
  }

  await supabase
    .from("buffer_credentials")
    .update({ status: "connected", last_tested_at: now })
    .eq("id", credentialId);

  return { count: synced.length, channels: synced, missing: stale.length };
}

/**
 * Parse a raw pasted blob into Buffer credentials.
 * Accepts one entry per line (or comma/semicolon/tab separated), in any of:
 *   token
 *   Label, token
 *   token, Label
 *   Label: token
 *   {"label":"x","api_token":"y"} / JSON arrays
 */
export function parseBulkBufferTokens(raw: string): Array<{ label: string; api_token: string }> {
  const out: Array<{ label: string; api_token: string }> = [];
  const seen = new Set<string>();
  const push = (api_token: string, label?: string | null) => {
    const token = api_token.trim().replace(/^["']|["',;]+$/g, "").trim();
    if (token.length < 10 || seen.has(token)) return;
    seen.add(token);
    const name = (label ?? "").trim().replace(/^["']|["']$/g, "");
    out.push({ label: (name || `Buffer account ${out.length + 1}`).slice(0, 80), api_token: token });
  };

  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        if (typeof item === "string") push(item);
        else if (item && typeof item === "object") {
          const token = item.api_token ?? item.token ?? item.access_token ?? item.key;
          if (typeof token === "string") push(token, item.label ?? item.name ?? null);
        }
      }
      if (out.length) return out;
    } catch {
      /* fall through to line parsing */
    }
  }

  const looksLikeToken = (s: string) => /^[A-Za-z0-9._\-/|:+=]{10,}$/.test(s) && /[0-9A-Za-z]/.test(s);

  for (const line of raw.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const parts = clean.split(/[,;\t]|\s{2,}/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 1) {
      const colon = clean.match(/^(.+?)\s*:\s*(\S+)$/);
      if (colon && !looksLikeToken(clean)) push(colon[2]!, colon[1]!);
      else push(clean);
      continue;
    }
    const tokenPart = parts.find((p) => looksLikeToken(p) && p.includes("/")) ?? parts.find(looksLikeToken);
    if (!tokenPart) continue;
    const labelPart = parts.filter((p) => p !== tokenPart)[0] ?? null;
    push(tokenPart, labelPart);
  }
  return out;
}
