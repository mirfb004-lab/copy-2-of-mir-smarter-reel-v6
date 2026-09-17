import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listBufferCreds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaign_id: z.string().uuid().nullable().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("buffer_credentials")
      .select("id,label,graphql_endpoint,status,last_tested_at,created_at,campaign_id")
      .order("created_at", { ascending: false });
    // Campaign mode: campaign-specific tokens plus shared workspace tokens.
    if (data?.campaign_id) q = q.or(`campaign_id.eq.${data.campaign_id},campaign_id.is.null`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(80),
  api_token: z.string().min(10),
  graphql_endpoint: z.string().url().default("https://api.buffer.com"),
  campaign_id: z.string().uuid().nullable().optional(),
});

export const saveBufferCred = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }) => {
    if (data.id) {
      const { error } = await context.supabase
        .from("buffer_credentials")
        .update({
          label: data.label,
          api_token: data.api_token,
          graphql_endpoint: data.graphql_endpoint,
          campaign_id: data.campaign_id ?? null,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("buffer_credentials")
      .insert({
        user_id: context.userId,
        label: data.label,
        api_token: data.api_token,
        graphql_endpoint: data.graphql_endpoint,
        campaign_id: data.campaign_id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteBufferCred = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("buffer_credentials").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const syncBufferChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: cred, error } = await context.supabase
      .from("buffer_credentials")
      .select("api_token,campaign_id")
      .eq("id", data.id)
      .single();
    if (error || !cred) throw new Error("Credential not found");

    const API_URL = "https://api.buffer.com";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cred.api_token}`,
    };

    async function gql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const res = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Buffer ${res.status}: ${text.slice(0, 300)}`);
      const parsed = JSON.parse(text);
      if (parsed?.errors?.length) throw new Error(parsed.errors.map((e: any) => e.message).join("; "));
      return parsed.data as T;
    }

    // Step 1: organizations
    const orgData = await gql<{ account: { organizations: Array<{ id: string; name: string }> } }>(
      `query GetOrganizations { account { organizations { id name } } }`,
    );
    const orgs = orgData?.account?.organizations ?? [];
    if (orgs.length === 0) throw new Error("No organizations found for this Buffer account");

    // Step 2: channels per org
    const channelQuery = `query GetChannels($organizationId: OrganizationId!) {
      channels(input: { organizationId: $organizationId }) {
        id name service type serviceId avatar
      }
    }`;

    const allChannels: Array<{ id: string; name?: string; service?: string; avatar?: string }> = [];
    for (const org of orgs) {
      const chData = await gql<{ channels: Array<{ id: string; name?: string; service?: string; type?: string; serviceId?: string; avatar?: string }> }>(
        channelQuery,
        { organizationId: org.id },
      );
      for (const ch of chData?.channels ?? []) allChannels.push(ch);
    }

    // Existing channels for this credential
    const { data: existing } = await context.supabase
      .from("channels")
      .select("id,buffer_channel_id")
      .eq("user_id", context.userId)
      .eq("credential_id", data.id);
    const existingMap = new Map((existing ?? []).map((c) => [c.buffer_channel_id, c.id]));

    const now = new Date().toISOString();
    const synced: Array<{ id: string; name: string; platform: string; avatar?: string }> = [];
    for (const ch of allChannels) {
      const name = ch.name || ch.service || "Channel";
      const platform = (ch.service || "unknown").toLowerCase();
      if (existingMap.has(ch.id)) {
        await context.supabase.from("channels").update({
          name, platform, campaign_id: (cred as any).campaign_id ?? null,
          last_seen_at: now, missing_since: null, active: true,
        } as never).eq("id", existingMap.get(ch.id)!);
      } else {
        await context.supabase.from("channels").insert({
          user_id: context.userId,
          credential_id: data.id,
          buffer_channel_id: ch.id,
          campaign_id: (cred as any).campaign_id ?? null,
          name,
          platform,
          active: true,
          last_seen_at: now,
        } as never);
      }
      synced.push({ id: ch.id, name, platform, avatar: ch.avatar });
    }

    // Channels this credential used to have but Buffer no longer returns:
    // flag them as missing + inactive so the UI can show them in red and offer delete.
    const liveIds = new Set(allChannels.map((c) => c.id));
    const stale = (existing ?? []).filter((c) => !liveIds.has(c.buffer_channel_id));
    if (stale.length) {
      await context.supabase
        .from("channels")
        .update({ missing_since: now, active: false } as never)
        .in("id", stale.map((c) => c.id));
    }

    await context.supabase
      .from("buffer_credentials")
      .update({ status: "connected", last_tested_at: now })
      .eq("id", data.id);

    return { count: synced.length, channels: synced, missing: stale.length };
  });

