// Orchestrator: adaptive learning loop for one video.
// Step-based state machine — resumes from last completed step on retry.
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeAIRequest, resolveCampaignAISettings, type AISettingsSchema } from "./ai-gateway.server";
import {
  withRetry, audit, acquireChannelLock, releaseChannelLock,
  refreshHeartbeat, getActivePromptVersion, makeIdempotencyKey,
} from "./reliability.server";
import { applyCloudinaryTransform, isCloudinaryDeliveryUrl } from "./cloudinary-transform";

import { decideStrategy, type StrategyDecision } from "./strategy-engine.server";
import { predictMetrics, computeBaseline } from "./prediction-engine.server";

type Sb = SupabaseClient;

// Ordered step list. Runs resume from the first step whose output is missing.
type Step = "analyze_previous" | "analyze_video" | "strategy" | "predict" | "generate_caption" | "publish" | "finalize";
const STEP_ORDER: Step[] = ["analyze_previous", "analyze_video", "strategy", "predict", "generate_caption", "publish", "finalize"];

interface StepState {
  analyze_previous?: { done: boolean; report?: unknown };
  analyze_video?: { done: boolean; summary?: any };
  strategy?: { done: boolean; decision?: StrategyDecision; strategyId?: string };
  predict?: { done: boolean; predictionId?: string };
  generate_caption?: { done: boolean; caption?: any };
  publish?: { done: boolean; postId?: string; postedAt?: string };
  finalize?: { done: boolean };
}

// Frames come from the browser (native HTML5 canvas seeking) and are cached on
// the queue row. Cloudinary is a static host only — no transformation credits.
function framesToDataUrls(raw: unknown, limit = 12): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .slice(0, limit)
    .map((f) => (f.startsWith("data:") ? f : `data:image/jpeg;base64,${f}`));
}

async function loadQueueFrames(sb: Sb, queueItemId: string, limit = 12): Promise<string[]> {
  const { data } = await sb.from("video_queue").select("ai_frames").eq("id", queueItemId).maybeSingle();
  return framesToDataUrls((data as { ai_frames?: unknown } | null)?.ai_frames, limit);
}



async function log(sb: Sb, userId: string, runId: string | null, level: string, module: string, message: string, meta?: unknown) {
  await sb.from("logs").insert({ user_id: userId, run_id: runId, level, module, message, meta: (meta ?? null) as never });
}

async function persistStepState(sb: Sb, runId: string, state: StepState, currentStep: string) {
  await sb.from("runs").update({
    step_state: state as never,
    current_step: currentStep,
    heartbeat_at: new Date().toISOString(),
  }).eq("id", runId);
}

// -------- Step implementations --------
const SAMPLE_CAPTION_MAX_CHARS = 4000;
const SAMPLE_CAPTION_MAX_COUNT = 5;

function sanitizeUntrustedPromptText(value: unknown, maxChars = SAMPLE_CAPTION_MAX_CHARS): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, maxChars);
}

async function loadActiveSampleCaptions(sb: Sb, userId: string, campaignId: string | null) {
  if (!campaignId) return { mode: null as string | null, samples: [] as string[] };
  const [{ data: campaign }, { data: rows }] = await Promise.all([
    sb.from("campaigns").select("use_sample_captions,sample_caption_mode").eq("id", campaignId).eq("user_id", userId).maybeSingle(),
    sb.from("sample_captions").select("text").eq("campaign_id", campaignId).eq("user_id", userId).eq("is_active", true).order("created_at", { ascending: false }).limit(SAMPLE_CAPTION_MAX_COUNT),
  ]);
  if (!campaign?.use_sample_captions) return { mode: null as string | null, samples: [] as string[] };
  const mode = campaign.sample_caption_mode === "learning_seed" ? "learning_seed" : "style_reference";
  return { mode, samples: (rows ?? []).map((row: any) => sanitizeUntrustedPromptText(row.text)).filter(Boolean) };
}

async function stepAnalyzePrevious(
  sb: Sb, userId: string, runId: string, aiSettings: AISettingsSchema, learningPrompt: string,
  scopeCampaignId: string | null, lookback = 5, campaignId: string | null = null, channelId: string | null = null,
) {
  // Previous posts of the SAME campaign (its own queue/room), newest first.
  let prevQ = sb.from("runs")
    .select(`id, run_number, started_at,
      captions(text,hashtags,cta,hook,length),
      video_analyses(summary,topic,objects,scene,actions,emotions),
      video_queue!runs_queue_item_id_fkey(cloudinary_url,ai_frames),
      published_posts(posted_at,permalink,post_analytics(views,likes,comments,shares,saves,reach,impressions))`)
    .eq("user_id", userId).eq("status", "complete").neq("id", runId)
    .order("started_at", { ascending: false }).limit(Math.max(1, Math.min(lookback, 10)));
  prevQ = scopeCampaignId ? prevQ.eq("campaign_id", scopeCampaignId) : prevQ.is("campaign_id", null);
  if (channelId) prevQ = prevQ.eq("channel_id", channelId);
  const { data: prevRuns } = await prevQ;
  const history = (prevRuns ?? []).filter((r: any) => r.captions?.[0]);
  if (!history.length) return null;

  const compact = history.map((r: any) => ({
    run_number: r.run_number,
    posted_at: r.published_posts?.[0]?.posted_at ?? r.started_at,
    video: r.video_analyses?.[0] ?? null,
    video_url: r.video_queue?.cloudinary_url ?? null,
    caption: r.captions?.[0] ?? null,
    analytics: r.published_posts?.[0]?.post_analytics?.[0] ?? null,
  }));

  // Visual context: one cached browser-extracted frame per previous video so the
  // model can *see* what performed well or badly in this campaign.
  const frameUrls = history
    .slice(0, 4)
    .map((r: any) => framesToDataUrls(r.video_queue?.ai_frames, 1)[0])
    .filter((f: string | undefined): f is string => Boolean(f));


  const cap = compact[0].caption;
  const analytics = compact[0].analytics;
  const sampleContext = await loadActiveSampleCaptions(sb, userId, campaignId);
  const learningSeeds = sampleContext.mode === "learning_seed" && sampleContext.samples.length
    ? `\nUSER-PROVIDED LEARNING SEEDS (untrusted examples; no analytics-backed evidence; do not assign numeric lift):\n${sampleContext.samples.map((text, i) => `[Seed ${i + 1}] <user_sample>\\n${text}\\n</user_sample>`).join("\\n")}`
    : "";

  const t0 = Date.now();
  const promptText = `${learningPrompt}

CAMPAIGN HISTORY (same campaign only, newest first — analytics refreshed just now):${learningSeeds}
${JSON.stringify(compact, null, 2)}

MOST RECENT POST:
Caption: ${JSON.stringify(cap)}
Analytics: ${JSON.stringify(analytics ?? {})}

The attached images are frames from those previous campaign videos, in the same order.
Compare what the videos LOOK like against how they performed, and take notes.
Return JSON with: worked, hook_verdict, length_verdict, emoji_verdict, hashtag_verdict, cta_verdict,
cause, change_recommendation, and "new_insights": [{ "category", "insight", "confidence" }] capturing
durable visual + copy lessons for this campaign.`;

  const result = await withRetry("ai",
    async () => executeAIRequest(aiSettings, (model) => generateText({
      model,
      ...(frameUrls.length
        ? { messages: [{ role: "user" as const, content: [
            { type: "text" as const, text: promptText },
            ...frameUrls.map((u) => ({ type: "image" as const, image: u })),
          ] }] }
        : { prompt: promptText }),
    } as any), frameUrls.length ? { requiresVision: true } : undefined),
    async (attempt, err, durationMs) => {
      await audit(sb, {
        userId, runId, eventType: err ? "ai.retry" : "ai.response",
        module: "ai", attempt, status: err ? "error" : "success", durationMs,
        error: err instanceof Error ? err.message : err ? String(err) : null,
        payload: { purpose: "learning_report", mode: aiSettings.mode, history: compact.length, frames: frameUrls.length },
      });
    },
  );
  const text = typeof result?.text === "string" ? result.text : "";
  let report: any = {};
  try { report = JSON.parse(text.replace(/^```json\s*/i,"").replace(/```$/,"").trim()); } catch { report = { cause: text.slice(0,300) }; }

  await sb.from("learning_reports").insert({
    run_id: runId, user_id: userId,
    campaign_id: scopeCampaignId,
    worked: !!report.worked,
    hook_verdict: report.hook_verdict ?? null,
    length_verdict: report.length_verdict ?? null,
    emoji_verdict: report.emoji_verdict ?? null,
    hashtag_verdict: report.hashtag_verdict ?? null,
    cta_verdict: report.cta_verdict ?? null,
    cause: report.cause ?? null,
    change_recommendation: report.change_recommendation ?? null,
    raw: report,
  } as never);

  const insights = (report.new_insights ?? []) as Array<{ category: string; insight: string; confidence: number }>;
  for (const ins of insights) {
    let exQ = sb.from("memory_insights").select("id,support_count,confidence")
      .eq("user_id", userId).eq("category", ins.category as any).ilike("insight", ins.insight);
    exQ = scopeCampaignId ? exQ.eq("campaign_id", scopeCampaignId) : exQ.is("campaign_id", null);
    const { data: existing } = await exQ.maybeSingle();
    if (existing) {
      await sb.from("memory_insights").update({
        support_count: existing.support_count + 1,
        confidence: Math.min(1, (existing.confidence + (ins.confidence ?? 0.5)) / 2 + 0.05),
        last_reinforced_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await sb.from("memory_insights").insert({
        user_id: userId, category: ins.category as any, insight: ins.insight,
        campaign_id: scopeCampaignId,
        confidence: ins.confidence ?? 0.5, support_count: 1,
      } as never);
    }
  }

  await audit(sb, { userId, runId, eventType: "learning.report_saved", module: "orchestrator", status: "success", durationMs: Date.now() - t0 });
  return report;
}

async function stepAnalyzeVideo(sb: Sb, userId: string, runId: string, frames: string[], aiSettings: AISettingsSchema, visionPrompt: string) {
  const promptText = frames.length
    ? visionPrompt
    : `${visionPrompt}\n\nNOTE: No video frames are available for this item yet (open the Loop queue in the browser to prepare them). Infer conservatively from the campaign context and avoid inventing specific visual details.`;

  const result = await withRetry("ai",
    async () => executeAIRequest(aiSettings, (model) => generateText({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: promptText },
          ...frames.map((u) => ({ type: "image" as const, image: u })),
        ],
      }],
    } as any), frames.length ? { requiresVision: true } : undefined),

    async (attempt, err, durationMs) => {
      await audit(sb, {
        userId, runId, eventType: err ? "ai.retry" : "ai.response",
        module: "ai", attempt, status: err ? "error" : "success", durationMs,
        error: err instanceof Error ? err.message : err ? String(err) : null,
        payload: { purpose: "vision", mode: aiSettings.mode },
      });
    },
  );
  const text = typeof result?.text === "string" ? result.text : "";
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(text.replace(/^```json\s*/i,"").replace(/```$/i,"").trim()); }
  catch { parsed = { summary: text.slice(0, 500) }; }

  await sb.from("video_analyses").insert({
    run_id: runId, user_id: userId,
    summary: String(parsed.summary ?? ""),
    objects: (parsed.objects as string[]) ?? [],
    people: (parsed.people as string) ?? null,
    scene: (parsed.scene as string) ?? null,
    actions: (parsed.actions as string[]) ?? [],
    emotions: (parsed.emotions as string[]) ?? [],
    topic: (parsed.topic as string) ?? null,
    story: (parsed.story as string) ?? null,
    message: (parsed.message as string) ?? null,
    raw: parsed as never,
  });
  return parsed;
}

async function stepGenerateCaption(
  sb: Sb, userId: string, runId: string, aiSettings: AISettingsSchema, videoSummary: any, captionPrompt: string,
  strategy: StrategyDecision | null, scopeCampaignId: string | null = null, campaignId: string | null = null, channelId: string | null = null, lookbackOverride: number | null = null,
) {
  const memQ = sb.from("memory_insights").select("category,insight,confidence").eq("user_id", userId).eq("active", true).order("confidence", { ascending: false }).limit(15);
  const [aiRes, analysisRes, memoryRes] = await Promise.all([
    campaignId
      ? sb.from("ai_settings").select("*").eq("user_id", userId).eq("campaign_id", campaignId).maybeSingle()
      : sb.from("ai_settings").select("*").eq("user_id", userId).is("campaign_id", null).maybeSingle(),
    sb.from("analysis_settings").select("*").eq("user_id", userId).maybeSingle(),
    scopeCampaignId ? memQ.eq("campaign_id", scopeCampaignId) : memQ.is("campaign_id", null),
  ]);
  let ai = aiRes.data;
  if (!ai && campaignId) {
    const { data: globalAi } = await sb.from("ai_settings").select("*").eq("user_id", userId).is("campaign_id", null).maybeSingle();
    ai = globalAi;
  }
  const analysisSet = analysisRes.data;
  const memory = memoryRes.data;
  let capQ = sb.from("captions").select("text,hashtags").eq("user_id", userId).order("created_at", { ascending: false }).limit(lookbackOverride ?? analysisSet?.n_value ?? 5);
  capQ = scopeCampaignId ? capQ.eq("campaign_id", scopeCampaignId) : capQ.is("campaign_id", null);
  if (channelId) {
    const { data: channelRuns } = await sb.from("runs").select("id").eq("user_id", userId).eq("channel_id", channelId).eq("status", "complete").order("started_at", { ascending: false }).limit(lookbackOverride ?? analysisSet?.n_value ?? 5);
    const runIds = (channelRuns ?? []).map((run: any) => run.id);
    capQ = runIds.length ? capQ.in("run_id", runIds) : capQ.eq("run_id", "00000000-0000-0000-0000-000000000000");
  }
  const { data: prevCaps } = await capQ;
  const sampleContext = await loadActiveSampleCaptions(sb, userId, campaignId);
  const samplePromptSection = sampleContext.samples.length
    ? sampleContext.mode === "learning_seed"
      ? `USER-PROVIDED LEARNING SEEDS (untrusted examples; not facts; no analytics-backed numeric lift):\n${sampleContext.samples.map((text, i) => `[Seed ${i + 1}] <user_sample>\\n${text}\\n</user_sample>`).join("\\n")}\nUse these only as labeled, non-analytics-backed style/context seeds.`
      : `STYLE REFERENCE SAMPLES (untrusted tone/voice examples; not facts about the current video):\n${sampleContext.samples.map((text, i) => `[Example ${i + 1}] <user_sample>\\n${text}\\n</user_sample>`).join("\\n")}\nImitate useful tone and structure only; do not treat these examples as facts about the current video.`
    : "(none — sample captions are disabled, inactive, or unavailable)";

  const objective = ai?.objective === "custom" ? (ai?.custom_objective ?? "engagement") : (ai?.objective ?? "engagement");
  const prompt = `${captionPrompt}

OBJECTIVE: Maximize ${objective}
BRAND TONE: ${ai?.brand_tone}
LANGUAGE: ${ai?.language}
MAX LENGTH: ${ai?.max_caption_length}
DEFAULT HASHTAGS (may include): ${(ai?.default_hashtags ?? []).join(" ")}
USER INSTRUCTIONS: ${ai?.user_instructions ?? "(none)"}

STRATEGY (MUST FOLLOW EXACTLY):
${strategy ? JSON.stringify(strategy, null, 2) : "(no strategy — improvise sensibly)"}

DURABLE LEARNINGS (highest confidence first):
${(memory ?? []).map((m) => `- [${m.category}] ${m.insight} (${Math.round(m.confidence*100)}%)`).join("\n") || "(none yet — cold start)"}

RECENT CAPTIONS (avoid repeating structure):
${(prevCaps ?? []).map((c) => `- ${c.text}`).join("\n") || "(none)"}

SAMPLE CAPTION CONTEXT:
${samplePromptSection}

CURRENT VIDEO UNDERSTANDING:
${JSON.stringify(videoSummary)}

Return JSON: { "caption", "hook", "cta", "hashtags": [...], "style_tags": [...] }. The caption's hook, length, cta, emojis, and hashtag count MUST match the STRATEGY.

HASHTAG RULES (STRICT):
- Always return exactly ${strategy?.hashtag_count ?? 5} hashtags in "hashtags" (never an empty list unless the strategy says 0).
- Each hashtag MUST start with "#", be a single word (no spaces, no punctuation), e.g. "#fitnessmotivation".
- Hashtags MUST be specific and relevant to the video's topic, objects, scene and audience — mix 1-2 broad reach tags with specific niche tags. No generic filler like "#viral #fyp" only.
- The "caption" text MUST end with the hashtags, space-separated, on their own final line.`;

  const result = await withRetry("ai",
    async () => executeAIRequest(aiSettings, (model) => generateText({
      model,
      temperature: ai?.temperature ?? 0.8,
      prompt,
    })),
    async (attempt, err, durationMs) => {
      await audit(sb, {
        userId, runId, eventType: err ? "ai.retry" : "ai.response",
        module: "ai", attempt, status: err ? "error" : "success", durationMs,
        error: err instanceof Error ? err.message : err ? String(err) : null,
        payload: { purpose: "caption", mode: aiSettings.mode },
      });
    },
  );
  const captionText = typeof result?.text === "string" ? result.text : "";
  let out: any = {};
  try { out = JSON.parse(captionText.replace(/^```json\s*/i,"").replace(/```$/,"").trim()); }
  catch { out = { caption: captionText.slice(0, ai?.max_caption_length ?? 2200) }; }

  // ---- Normalize hashtags: "#" prefix, single word, unique, non-empty ----
  const wanted = strategy?.hashtag_count ?? 5;
  const normalize = (tags: unknown): string[] => {
    const arr = Array.isArray(tags) ? tags : typeof tags === "string" ? String(tags).split(/[\s,]+/) : [];
    const seen = new Set<string>();
    const outTags: string[] = [];
    for (const raw of arr) {
      const cleaned = String(raw ?? "")
        .replace(/[#\s]+/g, " ").trim()
        .replace(/[^\p{L}\p{N}\s_]/gu, "")
        .split(/\s+/).join("");
      if (!cleaned) continue;
      const tag = `#${cleaned}`;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      outTags.push(tag);
    }
    return outTags;
  };

  let hashtags = normalize(out.hashtags);
  // Pull any hashtags already written inside the caption text.
  const inCaption = normalize(String(out.caption ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? []);
  for (const t of inCaption) if (!hashtags.some((h) => h.toLowerCase() === t.toLowerCase())) hashtags.push(t);
  // Top up from configured defaults if the model returned too few.
  if (wanted > 0 && hashtags.length < wanted) {
    for (const t of normalize(ai?.default_hashtags ?? [])) {
      if (hashtags.length >= wanted) break;
      if (!hashtags.some((h) => h.toLowerCase() === t.toLowerCase())) hashtags.push(t);
    }
  }
  if (wanted > 0) hashtags = hashtags.slice(0, Math.max(wanted, Math.min(hashtags.length, 10)));

  // Ensure the caption body ends with the hashtag block exactly once.
  let body = String(out.caption ?? "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (hashtags.length) body = `${body}\n\n${hashtags.join(" ")}`.trim();
  out.caption = body;
  out.hashtags = hashtags;

  await sb.from("captions").insert({
    run_id: runId, user_id: userId,
    text: String(out.caption ?? ""),
    hook: out.hook ?? null,
    cta: out.cta ?? null,
    hashtags,
    length: String(out.caption ?? "").length,
    style_tags: out.style_tags ?? [],
  });

  return out;
}

type PublishPlan = { mode: "addToQueue" | "shareNow" | "customScheduled"; dueAt: string | null };

// Resolve publishing mode from the schedule (overrides) then the campaign.
async function resolvePublishPlan(sb: Sb, campaignId: string | null, channelId: string): Promise<PublishPlan> {
  const pick = (row: any): PublishPlan | null => {
    if (!row?.publish_mode) return null;
    let dueAt: string | null = row.custom_scheduled_at ?? null;
    if (row.publish_delay_minutes) dueAt = new Date(Date.now() + row.publish_delay_minutes * 60_000).toISOString();
    // A past custom time is meaningless — push it a few minutes out.
    if (row.publish_mode === "customScheduled" && (!dueAt || new Date(dueAt).getTime() <= Date.now())) {
      dueAt = new Date(Date.now() + 5 * 60_000).toISOString();
    }
    return { mode: row.publish_mode, dueAt };
  };

  let schedQ = sb.from("schedules")
    .select("publish_mode,custom_scheduled_at,publish_delay_minutes")
    .eq("channel_id", channelId).limit(1);
  if (campaignId) schedQ = schedQ.eq("campaign_id", campaignId);
  const { data: sched } = await schedQ.maybeSingle();
  const fromSched = pick(sched);
  if (fromSched) return fromSched;

  if (campaignId) {
    const { data: camp } = await sb.from("campaigns")
      .select("publish_mode,custom_scheduled_at,publish_delay_minutes").eq("id", campaignId).maybeSingle();
    const fromCamp = pick(camp);
    if (fromCamp) return fromCamp;
  }
  return { mode: "addToQueue", dueAt: null };
}

async function stepPublish(
  sb: Sb, userId: string, runId: string, channel: any, caption: any, videoUrl: string,
  plan: PublishPlan = { mode: "addToQueue", dueAt: null },
  campaignId: string | null = null,
) {
  const { makeBufferClient, resolveBufferCredential } = await import("./buffer.server");
  const cred = await resolveBufferCredential(sb, userId, campaignId, channel.buffer_credentials);
  const buffer = makeBufferClient(cred.api_token, cred.graphql_endpoint);

  let publishMediaUrl = videoUrl;
  if (campaignId && isCloudinaryDeliveryUrl(videoUrl)) {
    const { data: campaign } = await sb.from("campaigns").select("cloudinary_transform_enabled,cloudinary_transform,cloudinary_transform_mode").eq("id", campaignId).eq("user_id", userId).maybeSingle();
    if (campaign?.cloudinary_transform_enabled) {
      const transformed = applyCloudinaryTransform(videoUrl, campaign.cloudinary_transform, campaign.cloudinary_transform_mode);
      if (transformed.error) throw new Error(`Cloudinary transformation failed: ${transformed.error}`);
      publishMediaUrl = transformed.url;
    }
  }
  const t0 = Date.now();
  const published = await withRetry("buffer",
    async () => buffer.createPost({
      channelId: channel.buffer_channel_id,
      text: caption.caption,
      mediaUrl: publishMediaUrl,
      mode: plan.mode,
      dueAt: plan.dueAt,
      platform: channel.platform,
    }),
    async (attempt, err, durationMs) => {
      await audit(sb, {
        userId, runId, eventType: err ? "publish.retry" : "publish.response",
        module: "buffer", attempt, status: err ? "error" : "success", durationMs,
        error: err instanceof Error ? err.message : err ? String(err) : null,
      });
    },
  );

  if (!published?.postId) throw new Error("Buffer did not confirm the post — no post id returned");

  const postedAt = published.sentAt ?? new Date().toISOString();
  await sb.from("published_posts").insert({
    run_id: runId, user_id: userId, channel_id: channel.id,
    buffer_post_id: published.postId, platform: channel.platform,
    posted_at: postedAt, raw: published.raw as never,
    source: "app", text_content: caption.caption,
    buffer_status: published.status, due_at: published.dueAt,
    permalink: published.permalink,
    verified_at: published.verified ? new Date().toISOString() : null,
  } as never);
  await audit(sb, {
    userId, runId, eventType: "publish.saved", module: "orchestrator", status: "success",
    durationMs: Date.now() - t0,
    payload: {
      post_id: published.postId, publish_mode: plan.mode, due_at: published.dueAt,
      buffer_status: published.status, verified: published.verified, permalink: published.permalink,
    },
  });
  return { postId: published.postId, postedAt, status: published.status, verified: published.verified };
}


// -------- Main entry --------

export async function executeQueueItemForChannel({
  supabase: sb, userId, campaignId, channelId, queueItem, analysisLookback,
}: { supabase: Sb; userId: string; campaignId: string; channelId: string; queueItem: { id: string; cloudinary_url: string }; analysisLookback?: number | null }) {
  const { data: channel } = await sb.from("channels").select("*, buffer_credentials(*)").eq("id", channelId).eq("user_id", userId).maybeSingle();
  if (!channel) throw new Error("Selected channel not found");
  const idemKey = makeIdempotencyKey(["multi", queueItem.id, channelId]);
  const { data: existing } = await sb.from("runs").select("*, channels(*, buffer_credentials(*))").eq("user_id", userId).eq("idempotency_key", idemKey).maybeSingle();
  if (existing?.status === "complete") return { runId: existing.id, postId: (existing.step_state as any)?.publish?.postId, alreadyComplete: true };

  let run: any = existing;
  if (!run) {
    let lastRunQ = sb.from("runs").select("run_number").eq("user_id", userId).eq("campaign_id", campaignId).order("run_number", { ascending: false }).limit(1);
    const { data: lastRun } = await lastRunQ.maybeSingle();
    const promptVer = await getActivePromptVersion(sb, userId);
    const { data: created, error } = await sb.from("runs").insert({
      user_id: userId, channel_id: channelId, queue_item_id: queueItem.id, campaign_id: campaignId,
      run_number: (lastRun?.run_number ?? 0) + 1, status: "analyzing", idempotency_key: idemKey,
      current_step: "analyze_previous", step_state: {} as never, heartbeat_at: new Date().toISOString(), attempts: 1,
      prompt_version_id: promptVer.id === "builtin-default" ? null : promptVer.id,
    }).select("*").single();
    if (error || !created) throw new Error(error?.message ?? "Failed to create multi-channel run");
    run = created;
  } else {
    await sb.from("runs").update({ status: "analyzing", error: null, attempts: (run.attempts ?? 0) + 1, heartbeat_at: new Date().toISOString() }).eq("id", run.id);
  }

  const gotLock = await acquireChannelLock(sb, channelId, run.id);
  if (!gotLock) throw new Error(`Channel ${channelId} is already being processed.`);
  run.queue_url = queueItem.cloudinary_url;
  return await executeSteps(sb, userId, run, channel, (run.step_state as StepState) ?? {}, {
    channelOnly: true, finalizeQueue: false, requeueQueueOnFailure: false, analysisLookback: analysisLookback ?? null,
  });
}

export async function runOrchestrator({
  supabase: sb, userId, channelId, resumeRunId, campaignId: campaignIdOverride,
}: { supabase: Sb; userId: string; channelId: string; resumeRunId?: string; campaignId?: string | null }) {

  // ----- Resume path -----
  if (resumeRunId) {
    const { data: existing } = await sb.from("runs").select("*, channels(*, buffer_credentials(*))").eq("id", resumeRunId).maybeSingle();
    if (!existing) throw new Error("Run to resume not found");
    if (existing.status === "complete") return { runId: resumeRunId, resumed: true, alreadyComplete: true };
    return await executeSteps(sb, userId, existing as any, (existing as any).channels, existing.step_state as StepState);
  }


  // ----- Claim next pending queue item (optionally scoped to a campaign) -----
  let qQuery = sb.from("video_queue")
    .select("id, cloudinary_url, attempts, max_attempts, idempotency_key, campaign_id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("position", { ascending: true })
    .limit(1);
  if (campaignIdOverride) qQuery = qQuery.eq("campaign_id", campaignIdOverride);
  const { data: qItem, error: qErr } = await qQuery.maybeSingle();
  if (qErr) throw new Error(qErr.message);
  if (!qItem) throw new Error("Queue is empty. Add Cloudinary URLs first.");
  const campaignId = campaignIdOverride ?? (qItem as any).campaign_id ?? null;


  // ----- Idempotency: if a run already exists for this queue item, reuse it -----
  const idemKey = qItem.idempotency_key ?? makeIdempotencyKey([qItem.id, channelId]);
  if (!qItem.idempotency_key) {
    await sb.from("video_queue").update({ idempotency_key: idemKey }).eq("id", qItem.id);
  }
  const { data: existingRun } = await sb.from("runs")
    .select("*, channels(*, buffer_credentials(*))")
    .eq("user_id", userId).eq("idempotency_key", idemKey)
    .maybeSingle();
  const STALE_MS = 10 * 60 * 1000;
  if (existingRun && existingRun.status !== "failed" && existingRun.status !== "stale") {
    if (existingRun.status === "complete") return { runId: existingRun.id, alreadyComplete: true };
    const hb = existingRun.heartbeat_at ? new Date(existingRun.heartbeat_at).getTime() : 0;
    const isStuck = Date.now() - hb > STALE_MS;
    if (!isStuck) {
      // Genuinely in-flight — refuse to double-publish.
      throw new Error(`Run ${existingRun.id} already in-flight for this queue item (${existingRun.status})`);
    }
    // Stuck run: release its lock and take it over (resumes from step_state).
    if (existingRun.channel_id) {
      await sb.rpc("release_channel_lock", { _channel_id: existingRun.channel_id, _run_id: existingRun.id });
    }
    await audit(sb, { userId, runId: existingRun.id, eventType: "run.takeover", module: "orchestrator", status: "info", error: `stale ${existingRun.status}` });
  }


  // ----- Get channel + credentials -----
  const { data: channel } = await sb.from("channels")
    .select("*, buffer_credentials(*)").eq("id", channelId).maybeSingle();
  if (!channel) throw new Error("Channel not found");
  if (!(channel as any).buffer_credentials) throw new Error("This channel has no Buffer credential attached.");

  // ----- Create or reuse run row -----
  let runId: string;
  if (existingRun) {
    runId = existingRun.id;
    await sb.from("runs").update({
      status: "analyzing", error: null, attempts: (existingRun.attempts ?? 0) + 1,
      heartbeat_at: new Date().toISOString(),
    }).eq("id", runId);
  } else {
    // Run numbers are per-campaign — every campaign counts from 1 independently.
    let lastRunQ = sb.from("runs").select("run_number").eq("user_id", userId)
      .order("run_number", { ascending: false }).limit(1);
    lastRunQ = campaignId ? lastRunQ.eq("campaign_id", campaignId) : lastRunQ.is("campaign_id", null);
    const { data: lastRun } = await lastRunQ.maybeSingle();
    const nextNum = (lastRun?.run_number ?? 0) + 1;
    const promptVer = await getActivePromptVersion(sb, userId);
    const { data: run, error: runErr } = await sb.from("runs").insert({
      user_id: userId, channel_id: channelId, queue_item_id: qItem.id,
      campaign_id: campaignId,
      run_number: nextNum, status: "analyzing",
      idempotency_key: idemKey,
      current_step: "analyze_previous",
      step_state: {} as never,
      heartbeat_at: new Date().toISOString(),
      attempts: 1,
      prompt_version_id: promptVer.id === "builtin-default" ? null : promptVer.id,
    }).select("*").single();
    if (runErr || !run) throw new Error(runErr?.message ?? "Failed to create run");
    runId = run.id;
  }


  // ----- Acquire channel lock (reclaim it when the holder is dead) -----
  let gotLock = await acquireChannelLock(sb, channelId, runId);
  if (!gotLock) {
    const { data: chLock } = await sb.from("channels").select("active_run_id").eq("id", channelId).maybeSingle();
    const holderId = chLock?.active_run_id ?? null;
    let reclaimable = !holderId || holderId === runId;
    if (holderId && holderId !== runId) {
      const { data: holder } = await sb.from("runs").select("status,heartbeat_at").eq("id", holderId).maybeSingle();
      const hb = holder?.heartbeat_at ? new Date(holder.heartbeat_at).getTime() : 0;
      reclaimable = !holder
        || ["complete", "failed", "stale"].includes(holder.status ?? "")
        || Date.now() - hb > 10 * 60 * 1000;
    }
    if (reclaimable && holderId) {
      await sb.rpc("release_channel_lock", { _channel_id: channelId, _run_id: holderId });
    }
    gotLock = reclaimable ? await acquireChannelLock(sb, channelId, runId) : false;
  }
  if (!gotLock) {
    await sb.from("runs").update({ status: "failed", error: "Channel locked by another in-flight run", finished_at: new Date().toISOString() }).eq("id", runId);
    await audit(sb, { userId, runId, eventType: "lock.denied", module: "orchestrator", status: "error" });
    throw new Error("Channel is already being processed by another run.");
  }

  await audit(sb, { userId, runId, eventType: "lock.acquired", module: "orchestrator", status: "success", payload: { channel_id: channelId } });

  // ----- Mark queue item processing (increment attempts) -----
  await sb.from("video_queue").update({
    status: "processing",
    attempts: (qItem.attempts ?? 0) + 1,
  }).eq("id", qItem.id);
  await audit(sb, { userId, runId, queueItemId: qItem.id, eventType: "queue.claimed", module: "orchestrator", status: "success", attempt: (qItem.attempts ?? 0) + 1 });

  const { data: freshRun } = await sb.from("runs").select("*").eq("id", runId).maybeSingle();
  const initialState = (freshRun?.step_state as StepState) ?? {};
  (freshRun as any).queue_item_id = qItem.id;
  (freshRun as any).queue_url = qItem.cloudinary_url;
  return await executeSteps(sb, userId, freshRun as any, channel, initialState);
}

type ExecutionOptions = { channelOnly?: boolean; finalizeQueue?: boolean; requeueQueueOnFailure?: boolean; analysisLookback?: number | null };

async function executeSteps(sb: Sb, userId: string, run: any, channel: any, state: StepState, options: ExecutionOptions = {}) {
  const runId = run.id;
  const channelId = channel.id;
  const campaignId: string | null = run.campaign_id ?? null;
  const t0 = Date.now();
  // Campaign-scoped AI keys with global workspace fallback.
  const aiSettings = await resolveCampaignAISettings(sb, userId, campaignId);
  const { data: aiSet } = campaignId
    ? (await sb.from("ai_settings").select("*").eq("user_id", userId).eq("campaign_id", campaignId).maybeSingle()).data
      ? await sb.from("ai_settings").select("*").eq("user_id", userId).eq("campaign_id", campaignId).maybeSingle()
      : await sb.from("ai_settings").select("*").eq("user_id", userId).is("campaign_id", null).maybeSingle()
    : await sb.from("ai_settings").select("*").eq("user_id", userId).is("campaign_id", null).maybeSingle();

  // Determine learning scope. By default, learning is isolated per campaign.
  // If the campaign has share_learning=true (or the run has no campaign), fall back to user-wide learning.
  let scopeCampaignId: string | null = campaignId;
  if (campaignId) {
    const { data: camp } = await sb.from("campaigns").select("share_learning").eq("id", campaignId).maybeSingle();
    if (camp?.share_learning) scopeCampaignId = null;
  }


  // Load queue item info if not already on run row.
  let queueItemId: string | undefined = run.queue_item_id;
  let queueUrl: string | undefined = run.queue_url;
  if (!queueUrl && queueItemId) {
    const { data: q } = await sb.from("video_queue").select("cloudinary_url").eq("id", queueItemId).maybeSingle();
    queueUrl = q?.cloudinary_url;
  }
  if (!queueUrl) throw new Error("Queue URL missing for run");

  // Load prompt version bound to this run (falls back to active).
  let promptVer;
  if (run.prompt_version_id) {
    const { data } = await sb.from("prompt_versions")
      .select("id,name,version,vision_prompt,learning_prompt,caption_prompt")
      .eq("id", run.prompt_version_id).maybeSingle();
    promptVer = data;
  }
  if (!promptVer) promptVer = await getActivePromptVersion(sb, userId);

  try {
    await log(sb, userId, runId, "info", "orchestrator", `Run started/resumed at step ${run.current_step ?? "analyze_previous"}`);

    // Step: refresh this campaign's post analytics so the Sheet + learning use live numbers.
    try {
      const analytics = await import("./analytics-sync.server");
      const res = options.channelOnly
        ? await analytics.refreshChannelAnalytics(sb, { userId, channelId, campaignId })
        : await analytics.refreshCampaignAnalytics(sb, { userId, campaignId });
      await audit(sb, { userId, runId, eventType: "analytics.refreshed", module: "orchestrator", status: "success", payload: res });
    } catch (e) {
      await log(sb, userId, runId, "warn", "orchestrator", `Analytics refresh skipped: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Step: analyze previous
    if (!state.analyze_previous?.done) {
      await persistStepState(sb, runId, state, "analyze_previous");
      await refreshHeartbeat(sb, runId, channelId);
      const { data: aSet } = await sb.from("analysis_settings").select("n_value").eq("user_id", userId).maybeSingle();
      const lookback = options.analysisLookback ?? aSet?.n_value ?? 5;
      const report = await stepAnalyzePrevious(
        sb, userId, runId, aiSettings, promptVer.learning_prompt, scopeCampaignId, lookback, campaignId, options.channelOnly ? channelId : null,
      );
      state.analyze_previous = { done: true, report };
      await persistStepState(sb, runId, state, "analyze_video");
    }


    // Step: analyze video
    if (!state.analyze_video?.done) {
      await refreshHeartbeat(sb, runId, channelId);
      const cachedFrames = queueItemId ? await loadQueueFrames(sb, queueItemId) : [];
      const summary = await stepAnalyzeVideo(sb, userId, runId, cachedFrames, aiSettings, promptVer.vision_prompt);

      state.analyze_video = { done: true, summary };
      await persistStepState(sb, runId, state, "strategy");
    }

    // Step: strategy — decide structured direction before writing anything.
    if (!state.strategy?.done) {
      await refreshHeartbeat(sb, runId, channelId);
      const objective = aiSet?.objective ?? "engagement";
      const memQ = sb.from("memory_insights").select("category,insight,confidence").eq("user_id", userId).eq("active", true).order("confidence", { ascending: false }).limit(15);
      const trQ = sb.from("insight_trends").select("dimension,value,metric,lift_pct,human_summary").eq("user_id", userId).order("confidence", { ascending: false }).limit(12);
      const rpQ = sb.from("learning_reports").select("worked,cause,change_recommendation").eq("user_id", userId).order("created_at", { ascending: false }).limit(3);
      const [memRes, trendRes, reportsRes] = await Promise.all([
        scopeCampaignId ? memQ.eq("campaign_id", scopeCampaignId) : memQ,
        scopeCampaignId ? trQ.eq("campaign_id", scopeCampaignId) : trQ,
        scopeCampaignId ? rpQ.eq("campaign_id", scopeCampaignId) : rpQ,
      ]);

      const { decision, strategyId } = await decideStrategy({
        sb, userId, runId, aiSettings, objective,
        videoSummary: state.analyze_video!.summary,
        memoryTop: memRes.data ?? [],
        trends: trendRes.data ?? [],
        recentReports: reportsRes.data ?? [],
      });
      state.strategy = { done: true, decision, strategyId };
      await persistStepState(sb, runId, state, "predict");
    }

    // Step: predict — forecast metrics before publishing so we can score later.
    if (!state.predict?.done) {
      await refreshHeartbeat(sb, runId, channelId);
      const baseline = await computeBaseline(sb, userId);
      const { predictionId } = await predictMetrics({
        sb, userId, runId, aiSettings,
        strategy: state.strategy!.decision,
        videoSummary: state.analyze_video!.summary,
        baseline,
      });
      state.predict = { done: true, predictionId };
      await persistStepState(sb, runId, state, "generate_caption");
    }

    // Step: generate caption (strategy-directed)
    if (!state.generate_caption?.done) {
      await sb.from("runs").update({ status: "generating" }).eq("id", runId);
      await refreshHeartbeat(sb, runId, channelId);
      const caption = await stepGenerateCaption(sb, userId, runId, aiSettings, state.analyze_video!.summary, promptVer.caption_prompt, state.strategy?.decision ?? null, scopeCampaignId, campaignId, options.channelOnly ? channelId : null, options.analysisLookback);
      state.generate_caption = { done: true, caption };
      await persistStepState(sb, runId, state, "publish");
    }

    // Step: publish
    if (!state.publish?.done) {
      await sb.from("runs").update({ status: "publishing" }).eq("id", runId);
      await refreshHeartbeat(sb, runId, channelId);
      const plan = await resolvePublishPlan(sb, campaignId, channelId);
      await audit(sb, { userId, runId, eventType: "publish.mode", module: "orchestrator", status: "info", payload: { publish_mode: plan.mode, due_at: plan.dueAt } });
      const pub = await stepPublish(sb, userId, runId, channel, state.generate_caption!.caption, queueUrl, plan, campaignId);
      state.publish = { done: true, postId: pub.postId, postedAt: pub.postedAt };
      await persistStepState(sb, runId, state, "finalize");
    }

    // Step: finalize
    if (queueItemId && options.finalizeQueue !== false) {
      // Cached browser-extracted frames are temporary: drop them once the caption
      // is written and the post is published, so they don't accumulate storage.
      await sb.from("video_queue").update({
        status: "done", processed_at: new Date().toISOString(), error: null,
        ai_frames: null, ai_frames_at: null,
      }).eq("id", queueItemId);
    } else if (queueItemId) {
      await sb.from("video_queue").update({ ai_frames: null, ai_frames_at: null }).eq("id", queueItemId);
    }

    await sb.from("runs").update({
      status: "complete", finished_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      strategy_used: `objective=${aiSet?.objective ?? "engagement"};prompt=${promptVer.name}-v${promptVer.version}`,
      current_step: "complete",
      step_state: { ...state, finalize: { done: true } } as never,
    }).eq("id", runId);
    await releaseChannelLock(sb, channelId, runId);
    await audit(sb, { userId, runId, eventType: "run.completed", module: "orchestrator", status: "success", durationMs: Date.now() - t0, payload: { post_id: state.publish?.postId } });
    await log(sb, userId, runId, "info", "orchestrator", `Run complete`);
    return { runId, postId: state.publish?.postId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("runs").update({
      status: "failed", error: msg,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      step_state: state as never,
    }).eq("id", runId);

    // Dead-letter or requeue based on max_attempts.
    if (queueItemId && options.requeueQueueOnFailure !== false) {
      const { data: q } = await sb.from("video_queue").select("attempts, max_attempts").eq("id", queueItemId).maybeSingle();
      const attempts = q?.attempts ?? 1;
      const maxAttempts = q?.max_attempts ?? 3;
      if (attempts >= maxAttempts) {
        await sb.from("video_queue").update({
          status: "dead_letter",
          dead_letter_at: new Date().toISOString(),
          error: msg,
          last_error_module: classifyErrorModule(msg),
        }).eq("id", queueItemId);
        await audit(sb, { userId, runId, queueItemId, eventType: "queue.dead_letter", module: "orchestrator", status: "error", error: msg, attempt: attempts });
      } else {
        // Return item to pending so scheduler can retry (resume-aware).
        await sb.from("video_queue").update({
          status: "pending", error: msg,
          last_error_module: classifyErrorModule(msg),
        }).eq("id", queueItemId);
        await audit(sb, { userId, runId, queueItemId, eventType: "queue.requeued", module: "orchestrator", status: "error", error: msg, attempt: attempts });
      }
    }

    await releaseChannelLock(sb, channelId, runId);
    await log(sb, userId, runId, "error", "orchestrator", msg);
    throw e;
  }
}

function classifyErrorModule(msg: string): string {
  const s = msg.toLowerCase();
  if (s.includes("ai") || s.includes("model") || s.includes("gemini") || s.includes("gateway")) return "ai";
  if (s.includes("buffer") || s.includes("graphql") || s.includes("publish")) return "buffer";
  if (s.includes("cloudinary") || s.includes("upload")) return "cloudinary";
  return "orchestrator";
}
