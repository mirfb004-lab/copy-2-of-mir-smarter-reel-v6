import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listQueueItemsNeedingFrames, saveQueueItemFrames } from "@/lib/video-frames.functions";
import { extractVideoFrames } from "@/utils/videoFrameExtractor";
import { useCampaignScope } from "@/components/campaign-context";
import { Loader2, ImageIcon } from "lucide-react";

/**
 * Loop Learner only. Extracts AI preview frames in the browser for queued
 * videos that don't have them yet, then stores the Base64 frames so the
 * captioning run can "see" the video without any Cloudinary transformation.
 */
export function FrameExtractionRunner() {
  const { scopedCampaignId, activeCampaign } = useCampaignScope();
  const list = useServerFn(listQueueItemsNeedingFrames);
  const save = useServerFn(saveQueueItemFrames);
  const interval = Number((activeCampaign as { frame_sampling_seconds?: number } | null)?.frame_sampling_seconds ?? 10) || 10;

  const [status, setStatus] = useState<string | null>(null);
  const busy = useRef(false);

  const { data: pending, refetch } = useQuery({
    queryKey: ["queue-frames-missing", scopedCampaignId],
    queryFn: () => list({ data: { campaign_id: scopedCampaignId } }),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const items = (pending ?? []) as Array<{ id: string; cloudinary_url: string }>;
    if (!items.length || busy.current) return;
    busy.current = true;
    let cancelled = false;

    (async () => {
      let done = 0;
      for (const item of items) {
        if (cancelled) break;
        setStatus(`Extracting frames ${done + 1}/${items.length}…`);
        try {
          const frames = await extractVideoFrames(item.cloudinary_url, interval);
          await save({ data: { id: item.id, frames } });
          done += 1;
        } catch {
          // Leave it for the next pass — a run without frames still works text-only.
        }
      }
      if (!cancelled) {
        setStatus(done ? `Prepared AI frames for ${done} video${done === 1 ? "" : "s"}.` : null);
        busy.current = false;
        void refetch();
      }
    })();

    return () => { cancelled = true; busy.current = false; };
  }, [pending, interval, save, refetch]);

  if (!status) return null;
  const working = status.startsWith("Extracting");
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
      {status}
    </p>
  );
}
