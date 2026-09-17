// Server-only helpers for per-campaign reset / delete. Keeps campaigns fully isolated.
type Sb = any;

export async function purgeCampaignRuns(sb: Sb, campaignId: string) {
  const { data: runs } = await sb.from("runs").select("id").eq("campaign_id", campaignId);
  const runIds = (runs ?? []).map((r: any) => r.id);
  if (!runIds.length) return;
  const { data: posts } = await sb.from("published_posts").select("id").in("run_id", runIds);
  const postIds = (posts ?? []).map((p: any) => p.id);
  if (postIds.length) await sb.from("post_analytics").delete().in("published_post_id", postIds);
  await sb.from("published_posts").delete().in("run_id", runIds);
  await sb.from("captions").delete().in("run_id", runIds);
  await sb.from("video_analyses").delete().in("run_id", runIds);
  await sb.from("learning_reports").delete().in("run_id", runIds);
  await sb.from("runs").update({ prediction_id: null, strategy_id: null }).in("id", runIds);
  await sb.from("predictions").delete().in("run_id", runIds);
  await sb.from("strategies").delete().in("run_id", runIds);
  const { error } = await sb.from("runs").delete().in("id", runIds);
  if (error) throw new Error(error.message);
}

/** Renumber a campaign's queue so positions run 1..n. */
export async function resequenceCampaignQueue(sb: Sb, campaignId: string) {
  const { data: items } = await sb.from("video_queue")
    .select("id,position").eq("campaign_id", campaignId).order("position", { ascending: true });
  const updates: Array<{ id: string; position: number }> = [];
  (items ?? []).forEach((it: any, index: number) => {
    const position = index + 1;
    if (it.position !== position) updates.push({ id: it.id, position });
  });

  for (let start = 0; start < updates.length; start += 500) {
    const { error } = await sb.from("video_queue").upsert(updates.slice(start, start + 500), { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}

export async function resetCampaignData(
  sb: Sb,
  campaignId: string,
  opts: { clearQueue: boolean; clearRuns: boolean; clearMemory: boolean },
) {
  if (opts.clearRuns) await purgeCampaignRuns(sb, campaignId);
  await sb.from("multi_channel_rounds").delete().eq("campaign_id", campaignId);
  await sb.from("multi_channel_schedules").update({ last_error: null }).eq("campaign_id", campaignId);

  if (opts.clearQueue) {
    const { error } = await sb.from("video_queue").delete().eq("campaign_id", campaignId);
    if (error) throw new Error(error.message);
  } else {
    await sb.from("video_queue").update({
      status: "pending", error: null, attempts: 0, processed_at: null,
      dead_letter_at: null, last_error_module: null,
    }).eq("campaign_id", campaignId);
    await resequenceCampaignQueue(sb, campaignId);
  }

  if (opts.clearMemory) {
    await sb.from("memory_insights").delete().eq("campaign_id", campaignId);
    await sb.from("insight_trends").delete().eq("campaign_id", campaignId);
  }

  // Release lingering channel locks so the next run can start clean.
  await sb.from("channels").update({ active_run_id: null, lock_expires_at: null }).eq("campaign_id", campaignId);
  const { data: selectedTargets } = await sb.from("campaign_channel_targets").select("channel_id").eq("campaign_id", campaignId);
  const selectedChannelIds = (selectedTargets ?? []).map((target: any) => target.channel_id);
  if (selectedChannelIds.length) await sb.from("channels").update({ active_run_id: null, lock_expires_at: null }).in("id", selectedChannelIds);
}

/** Full teardown before deleting the campaign row itself. */
export async function purgeCampaignEverything(sb: Sb, campaignId: string) {
  await purgeCampaignRuns(sb, campaignId);
  await sb.from("video_queue").delete().eq("campaign_id", campaignId);
  await sb.from("memory_insights").delete().eq("campaign_id", campaignId);
  await sb.from("insight_trends").delete().eq("campaign_id", campaignId);
  await sb.from("post_analytics").delete().eq("campaign_id", campaignId);
  await sb.from("published_posts").delete().eq("campaign_id", campaignId);
  await sb.from("schedules").delete().eq("campaign_id", campaignId);
  await sb.from("multi_channel_schedules").delete().eq("campaign_id", campaignId);
  await sb.from("multi_channel_rounds").delete().eq("campaign_id", campaignId);
  await sb.from("campaign_channel_targets").delete().eq("campaign_id", campaignId);
  await sb.from("channels").update({ campaign_id: null, active_run_id: null, lock_expires_at: null }).eq("campaign_id", campaignId);
  await sb.from("ai_settings").delete().eq("campaign_id", campaignId);
  await sb.from("sample_captions").delete().eq("campaign_id", campaignId);
  await sb.from("buffer_credentials").delete().eq("campaign_id", campaignId);
}
