// Browser-only video frame extraction.
// Uses native HTML5 video metadata seeking (HTTP range requests) + an
// off-screen canvas, so Cloudinary serves the raw file as a static host and
// ZERO transformation credits are consumed.

export interface FrameExtractionOptions {
  /** Longest edge of the exported frame, in px. */
  maxWidth?: number;
  /** JPEG quality, 0-1. */
  quality?: number;
  /** Hard cap on frames returned (token-cost guard). */
  maxFrames?: number;
  /** Per-seek timeout. */
  seekTimeoutMs?: number;
}

const DEFAULTS = { maxWidth: 640, quality: 0.75, maxFrames: 12, seekTimeoutMs: 8000 };

/** Timestamp markers for a duration + sampling interval: 5, 15, 25 ... for step 10. */
export function frameTimestamps(duration: number, intervalSeconds: number, maxFrames = DEFAULTS.maxFrames): number[] {
  const step = Math.max(1, Math.floor(intervalSeconds || 10));
  const out: number[] = [];
  for (let t = step / 2; t < duration && out.length < maxFrames; t += step) {
    out.push(Math.min(Math.max(t, 0.1), Math.max(duration - 0.1, 0.1)));
  }
  if (!out.length && duration > 0) out.push(Math.min(0.1, duration / 2));
  return out;
}

function waitFor(video: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(`Video ${event} failed`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Video ${event} timed out`)); }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", fail);
    }
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
  });
}

/**
 * Extract preview frames from a video URL entirely in the browser.
 * Returns clean Base64 JPEG strings (no `data:` prefix).
 */
export async function extractVideoFrames(
  videoUrl: string,
  intervalSeconds = 10,
  options: FrameExtractionOptions = {},
): Promise<string[]> {
  if (typeof document === "undefined") throw new Error("extractVideoFrames is browser-only");
  const { maxWidth, quality, maxFrames, seekTimeoutMs } = { ...DEFAULTS, ...options };

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "metadata";
  video.muted = true;
  (video as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
  video.src = videoUrl;

  try {
    await waitFor(video, "loadedmetadata", seekTimeoutMs);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration) throw new Error("Video duration unavailable");

    const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((video.videoWidth || maxWidth) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || maxWidth) * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    const frames: string[] = [];
    for (const time of frameTimestamps(duration, intervalSeconds, maxFrames)) {
      try {
        video.currentTime = time;
        await waitFor(video, "seeked", seekTimeoutMs);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const base64 = dataUrl.split(",")[1];
        if (base64) frames.push(base64);
      } catch {
        // Skip an unseekable timestamp rather than failing the whole video.
      }
    }
    if (!frames.length) throw new Error("No frames could be extracted from this video");
    return frames;
  } finally {
    video.removeAttribute("src");
    try { video.load(); } catch { /* ignore */ }
  }
}
