import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const ALLOWED_IMAGE = /^image\/(jpeg|png|webp|gif)$/i;
const ALLOWED_VIDEO = /^video\/(mp4|quicktime|webm|x-matroska)$/i;

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  return { cloudName, apiKey, apiSecret };
}

function signature(params: Record<string, string>, secret: string) {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const body = Object.entries(params).filter(([, value]) => value !== "").sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
  return crypto.createHash("sha1").update(body + secret).digest("hex");
}

export const uploadCloudinaryFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as FormData)
  .handler(async ({ data, context }) => {
    const file = data.get("file");
    if (!(file instanceof File)) throw new Error("A file is required");
    const isImage = ALLOWED_IMAGE.test(file.type);
    const isVideo = ALLOWED_VIDEO.test(file.type);
    if (!isImage && !isVideo) throw new Error("Only JPEG, PNG, WebP, GIF, MP4, MOV, WebM, or MKV files are supported");
    const limit = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (file.size > limit) throw new Error(`File exceeds the ${isImage ? "25MB image" : "500MB video"} limit`);
    const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const params = { timestamp };
    const form = new FormData();
    form.append("file", file);
    form.append("api_key", apiKey);
    form.append("timestamp", timestamp);
    form.append("signature", signature(params, apiSecret));
    const resource = isVideo ? "video" : "image";
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resource}/upload`, { method: "POST", body: form });
    const body = await response.json() as { secure_url?: string; error?: { message?: string } };
    if (!response.ok || !body.secure_url) throw new Error(body.error?.message ?? "Cloudinary upload failed");
    const { error: galleryError } = await context.supabase.from("content_gallery_items").insert({
      user_id: context.userId,
      url: body.secure_url,
      label: null,
      media_type: resource === "video" ? "video" : "image",
    });
    if (galleryError) throw new Error(`Cloudinary upload succeeded, but saving to the content gallery failed: ${galleryError.message}`);
    return { url: body.secure_url, resourceType: resource, bytes: file.size, contentType: file.type, gallery_saved: true };
  });

export const cloudinaryUploadLimits = { maxImageBytes: MAX_IMAGE_BYTES, maxVideoBytes: MAX_VIDEO_BYTES } as const;
