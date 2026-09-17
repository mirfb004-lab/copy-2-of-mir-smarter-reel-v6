import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getAllSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaign_id: z.string().uuid().nullable().optional() }).optional().parse(d))
  .handler(async ({ data, context }) => {
    const uid = context.userId;
    const sb = context.supabase;
    const campaignId = data?.campaign_id ?? null;

    let [ai, analysis, general, profile] = await Promise.all([
      sb.from("ai_settings").select("*").eq("user_id", uid).is("campaign_id", null).maybeSingle(),
      sb.from("analysis_settings").select("*").eq("user_id", uid).maybeSingle(),
      sb.from("settings").select("*").eq("user_id", uid).maybeSingle(),
      sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
    ]);

    // Self-heal: accounts created before the defaults trigger (or partially
    // seeded rows) would otherwise leave the settings pages stuck loading.
    if (!ai.data) {
      ai = await sb.from("ai_settings").insert({ user_id: uid }).select().maybeSingle();
      if (ai.error) throw new Error(ai.error.message);
    }
    if (!analysis.data) {
      analysis = await sb.from("analysis_settings").insert({ user_id: uid }).select().maybeSingle();
      if (analysis.error) throw new Error(analysis.error.message);
    }
    if (!general.data) {
      general = await sb.from("settings").insert({ user_id: uid }).select().maybeSingle();
      if (general.error) throw new Error(general.error.message);
    }
    if (!profile.data) {
      profile = await sb.from("profiles").insert({ id: uid }).select().maybeSingle();
      if (profile.error) throw new Error(profile.error.message);
    }

    // Campaign mode: use the campaign override row when it exists, else the global row.
    let aiRow = ai.data;
    let aiIsCampaignOverride = false;
    if (campaignId) {
      const { data: camp } = await sb.from("ai_settings").select("*")
        .eq("user_id", uid).eq("campaign_id", campaignId).maybeSingle();
      if (camp) { aiRow = camp; aiIsCampaignOverride = true; }
    }

    return {
      ai: aiRow,
      ai_is_campaign_override: aiIsCampaignOverride,
      analysis: analysis.data,
      general: general.data,
      profile: profile.data,
    };
  });

const aiSchema = z.object({
  objective: z.enum(["followers","likes","comments","shares","saves","watch_time","profile_visits","ctr","reach","engagement","brand_awareness","custom"]),
  custom_objective: z.string().nullable().optional(),
  brand_tone: z.string(),
  language: z.string(),
  default_hashtags: z.array(z.string()),
  max_caption_length: z.number().int().min(50).max(5000),
  temperature: z.number().min(0).max(2),
  model: z.string(),
  user_instructions: z.string().nullable().optional(),
  campaign_id: z.string().uuid().nullable().optional(),
});
export const updateAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => aiSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { campaign_id: campaignId = null, ...fields } = data;
    const sb = context.supabase;
    const base = sb.from("ai_settings").select("id").eq("user_id", context.userId);
    const { data: existing } = campaignId
      ? await base.eq("campaign_id", campaignId).maybeSingle()
      : await base.is("campaign_id", null).maybeSingle();
    if (existing) {
      const { error } = await sb.from("ai_settings").update(fields).eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    const { error } = await sb.from("ai_settings")
      .insert({ ...fields, user_id: context.userId, campaign_id: campaignId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Removes a campaign's AI override so it inherits the global workspace settings.
export const clearCampaignAiOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaign_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ai_settings")
      .delete().eq("user_id", context.userId).eq("campaign_id", data.campaign_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const analysisSchema = z.object({
  scope: z.enum(["last_n","top_n","highest_engagement","highest_views","highest_saves","all","custom"]),
  n_value: z.number().int().min(1).max(500),
  custom_query: z.string().nullable().optional(),
});
export const updateAnalysisSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => analysisSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("analysis_settings")
      .upsert({ ...data, user_id: context.userId }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const generalSchema = z.object({
  max_retries: z.number().int().min(0).max(10),
  retry_interval_s: z.number().int().min(1).max(3600),
  analytics_delay_h: z.number().int().min(0).max(168),
  rate_limit_per_min: z.number().int().min(1).max(1000),
});
export const updateGeneralSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => generalSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("settings")
      .upsert({ ...data, user_id: context.userId }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const profileSchema = z.object({ display_name: z.string().nullable().optional(), timezone: z.string() });
export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => profileSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .upsert({ ...data, id: context.userId }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

