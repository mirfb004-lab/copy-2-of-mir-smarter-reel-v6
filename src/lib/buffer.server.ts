// Buffer GraphQL client (server-only). Uses the user's API token & endpoint.
export interface BufferPostMetrics {
  id: string;
  text: string | null;
  sentAt: string | null;
  metricsUpdatedAt: string | null;
  metrics: Record<string, number>;
  raw: unknown;
}
export type PublishMode = "addToQueue" | "shareNow" | "customScheduled";
/** A single Buffer PostMetric, kept verbatim so the UI can render whatever Buffer returns. */
export interface BufferMetricEntry {
  type: string | null;
  name: string | null;
  value: number | string | null;
  unit: string | null;
}
export { getBufferPlatformCapabilities, normalizeBufferPlatform } from "./buffer-platforms";
import { getBufferPlatformCapabilities, normalizeBufferPlatform } from "./buffer-platforms";

export interface BufferPostProof {
  postId: string;
  status: string | null;
  dueAt: string | null;
  sentAt: string | null;
  permalink: string | null;
  channelId: string | null;
  shareMode: string | null;
  verified: boolean;
  raw: unknown;
}

export interface BufferClient {
  gql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  verifySchema(): Promise<{ ok: boolean; hasCreatePost: boolean; mutationName: string | null; inputFields: string[]; message: string }>;
  getOrganizationId(): Promise<string | null>;
  createPost(input: {
    channelId: string; text: string; mediaUrl: string;
    mode?: PublishMode; dueAt?: string | null; platform?: string | null;
    formula?: {
      postType?: string | null; shareToFeed?: boolean; thumbnailTimestamp?: number;
      firstComment?: string | null; isAiGenerated?: boolean; title?: string | null;
      link?: string | null; geolocation?: { id: string; text: string } | null;
      facebookType?: string | null; linkAttachment?: { url: string; title?: string; description?: string; thumbnail?: { url: string } } | null;
      youtubeTitle?: string | null; youtubePrivacy?: "public" | "unlisted" | "private"; categoryId?: string | null;
      madeForKids?: boolean; notifySubscribers?: boolean; embeddable?: boolean; license?: "youtube" | "creativeCommon";
      boardServiceId?: string | null;
    };
  }): Promise<BufferPostProof>;
  getPost(id: string): Promise<{ analytics: Record<string, number>; raw: any } | null>;
  getPostProof(id: string): Promise<BufferPostProof | null>;
  getChannelPostsMetrics(channelId: string, limit?: number): Promise<BufferPostMetrics[]>;
  /** Raw Buffer metrics for one post, rendered generically (no hardcoded metric list). */
  getPostMetricEntries(id: string): Promise<{ metrics: BufferMetricEntry[]; metricsUpdatedAt: string | null } | null>;
}

// Normalize Buffer metric names/types to our canonical keys.
export function normalizeBufferMetrics(metrics: Array<{ type?: string | null; name?: string | null; value?: number | string | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  const keyMap: Record<string, string> = {
    views: "views", view: "views", videoviews: "views", plays: "views",
    impressions: "impressions", impression: "impressions",
    likes: "likes", like: "likes", reactions: "likes", favorites: "likes",
    comments: "comments", comment: "comments", replies: "comments",
    shares: "shares", share: "shares", reposts: "shares", retweets: "shares",
    saves: "saves", save: "saves", bookmarks: "saves",
    reach: "reach",
  };
  for (const m of metrics ?? []) {
    const raw = String(m.name ?? m.type ?? "").toLowerCase().replace(/[\s_-]/g, "");
    const key = keyMap[raw];
    if (!key) continue;
    const val = Number(m.value ?? 0);
    if (!Number.isFinite(val)) continue;
    out[key] = (out[key] ?? 0) + val;
  }
  if (out.views == null && out.impressions != null) out.views = out.impressions;
  return out;
}

const POST_FIELDS = `id status dueAt sentAt text channelId shareMode externalLink createdAt metricsUpdatedAt`;

function isVideoUrl(url: string) {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url) || /\/video\/upload\//i.test(url);
}

// Only emit platform metadata whose shape is documented by Buffer.
function platformMetadata(platform: string | null | undefined, video: boolean, formula?: Record<string, unknown> | null): Record<string, unknown> | null {
  const p = normalizeBufferPlatform(platform);
  const f = (formula ?? {}) as Record<string, unknown>;
  if (p === "instagram") {
    return { instagram: {
      type: typeof f.postType === "string" ? f.postType : video ? "reel" : "post",
      shouldShareToFeed: f.shareToFeed !== false,
      ...(typeof f.firstComment === "string" && f.firstComment ? { firstComment: f.firstComment } : {}),
      ...(typeof f.isAiGenerated === "boolean" ? { isAiGenerated: f.isAiGenerated } : {}),
      ...(typeof f.link === "string" && f.link ? { link: f.link } : {}),
      ...(f.geolocation && typeof f.geolocation === "object" ? { geolocation: f.geolocation } : {}),
    } };
  }
  if (p === "tiktok") return {
    tiktok: {
      ...(typeof f.isAiGenerated === "boolean" ? { isAiGenerated: f.isAiGenerated } : {}),
      ...(typeof f.title === "string" && f.title ? { title: f.title } : {}),
    },
  };
  if (p === "facebook") return { facebook: {
    type: typeof f.facebookType === "string"
      ? f.facebookType
      : typeof f.postType === "string"
        ? f.postType
        : video
          ? "reel"
          : "post",
    ...(f.linkAttachment && typeof f.linkAttachment === "object" ? { linkAttachment: f.linkAttachment } : {}),
    ...(typeof f.firstComment === "string" && f.firstComment ? { firstComment: f.firstComment } : {}),
  } };
  if (p === "youtube") return { youtube: {
    ...(typeof f.youtubeTitle === "string" && f.youtubeTitle ? { title: f.youtubeTitle } : {}),
    ...(typeof f.youtubePrivacy === "string" ? { privacy: f.youtubePrivacy } : {}),
    ...(typeof f.categoryId === "string" && f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(typeof f.madeForKids === "boolean" ? { madeForKids: f.madeForKids } : {}),
    ...(typeof f.notifySubscribers === "boolean" ? { notifySubscribers: f.notifySubscribers } : {}),
    ...(typeof f.embeddable === "boolean" ? { embeddable: f.embeddable } : {}),
    ...(typeof f.license === "string" ? { license: f.license } : {}),
  } };
  if (p === "pinterest") return { pinterest: {
    ...(typeof f.boardServiceId === "string" && f.boardServiceId ? { boardServiceId: f.boardServiceId } : {}),
    ...(typeof f.title === "string" && f.title ? { title: f.title } : {}),
  } };
  return null;
}

export function makeBufferClient(token: string, endpoint: string): BufferClient {
  const url = endpoint || "https://graphql.buffer.com";
  let orgIdCache: string | null = null;

  async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Buffer ${res.status}: ${body}`);
    const parsed = JSON.parse(body) as { data?: T; errors?: Array<{ message: string }> };
    if (parsed.errors?.length) throw new Error("Buffer error: " + parsed.errors.map((e) => e.message).join("; "));
    return parsed.data as T;
  }

  async function getOrganizationId(): Promise<string | null> {
    if (orgIdCache) return orgIdCache;
    try {
      const d = await gql<{ account: { organizations: Array<{ id: string }> } }>(
        `query { account { id organizations { id name } } }`,
      );
      orgIdCache = d.account?.organizations?.[0]?.id ?? null;
      return orgIdCache;
    } catch {
      return null;
    }
  }

  async function getPostProof(id: string): Promise<BufferPostProof | null> {
    try {
      const d = await gql<{ post: any }>(`query P($id: PostId!) { post(input: { id: $id }) { ${POST_FIELDS} } }`, { id });
      const p = d?.post;
      if (!p?.id) return null;
      return {
        postId: p.id, status: p.status ?? null, dueAt: p.dueAt ?? null, sentAt: p.sentAt ?? null,
        permalink: p.externalLink ?? null, channelId: p.channelId ?? null, shareMode: p.shareMode ?? null,
        verified: true, raw: p,
      };
    } catch {
      return null;
    }
  }

  return {
    gql,
    getOrganizationId,
    async testConnection() {
      try {
        const d = await gql<{ account: { id: string; email: string | null } }>(`query { account { id email } }`);
        return { ok: true, message: `Connected as ${d.account?.email ?? d.account?.id ?? "Buffer account"}` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
    async verifySchema() {
      try {
        const data = await gql<{ __schema: { mutationType: { fields: Array<{ name: string }> } }; createPostInput: { inputFields: Array<{ name: string }> } | null }>(
          `query { __schema { mutationType { fields { name } } } createPostInput: __type(name: "CreatePostInput") { inputFields { name } } }`,
        );
        const fields = data.__schema?.mutationType?.fields ?? [];
        const found = fields.find((f) => f.name === "createPost");
        if (!found) {
          return { ok: false, hasCreatePost: false, mutationName: null, inputFields: [], message: `No createPost mutation found. Available: ${fields.map((f) => f.name).slice(0, 15).join(", ")}` };
        }
        const inputFields = data.createPostInput?.inputFields?.map((field) => field.name) ?? [];
        return { ok: true, hasCreatePost: true, mutationName: "createPost", inputFields, message: `Found mutation "createPost"${inputFields.length ? ` with input fields: ${inputFields.join(", ")}` : ""}` };
      } catch (e) {
        return { ok: false, hasCreatePost: false, mutationName: null, inputFields: [], message: e instanceof Error ? e.message : String(e) };
      }
    },

    async createPost({ channelId, text, mediaUrl, mode = "addToQueue", dueAt = null, platform = null, formula = null }) {
      const video = isVideoUrl(mediaUrl);
      const input: Record<string, unknown> = {
        channelId,
        text,
        mode,
        schedulingType: "automatic",
        needsApproval: false,
        // AssetInput is a OneOf union — video/image must be nested.
        assets: [video ? { video: { url: mediaUrl, ...(formula?.thumbnailTimestamp != null && getBufferPlatformCapabilities(platform).supportsNestedThumbnailOffset ? { metadata: { thumbnailOffset: Math.round(formula.thumbnailTimestamp * 1000) } } : {}) } } : { image: { url: mediaUrl } }],
      };
      const meta = platformMetadata(platform, video, formula);
      if (meta) input.metadata = meta;
      if (mode === "customScheduled") {
        if (!dueAt) throw new Error("customScheduled publishing requires a due date");
        input.dueAt = new Date(dueAt).toISOString();
      }

      const data = await gql<{ createPost: any }>(
        `mutation CreatePost($input: CreatePostInput!) {
          createPost(input: $input) {
            __typename
            ... on PostActionSuccess { post { ${POST_FIELDS} } }
            ... on InvalidInputError { message }
            ... on UnexpectedError { message }
            ... on UnauthorizedError { message }
            ... on NotFoundError { message }
            ... on LimitReachedError { message }
            ... on RestProxyError { message code }
          }
        }`,
        { input },
      );

      const payload = data?.createPost;
      if (!payload) throw new Error("Buffer returned no response for createPost");
      if (payload.__typename !== "PostActionSuccess") {
        throw new Error(`Buffer rejected the post (${payload.__typename}): ${payload.message ?? "unknown error"}`);
      }
      const post = payload.post;
      if (!post?.id) throw new Error("Buffer accepted the post but returned no post id");

      // Proof of success: re-read the post from Buffer.
      const proof = await getPostProof(post.id);
      return {
        postId: post.id,
        status: proof?.status ?? post.status ?? null,
        dueAt: proof?.dueAt ?? post.dueAt ?? null,
        sentAt: proof?.sentAt ?? post.sentAt ?? null,
        permalink: proof?.permalink ?? post.externalLink ?? null,
        channelId: post.channelId ?? channelId,
        shareMode: post.shareMode ?? mode,
        verified: Boolean(proof),
        raw: { created: post, verified: proof?.raw ?? null },
      };
    },

    getPostProof,

    async getPostMetricEntries(id) {
      const d = await gql<{ post: any }>(
        `query PostMetrics($id: PostId!) { post(input: { id: $id }) { id metricsUpdatedAt metrics { type name value unit } } }`,
        { id },
      );
      if (!d?.post) return null;
      const metrics: BufferMetricEntry[] = (d.post.metrics ?? []).map((m: any) => ({
        type: m?.type ?? null,
        name: m?.name ?? null,
        value: m?.value ?? null,
        unit: m?.unit ?? null,
      }));
      return { metrics, metricsUpdatedAt: d.post.metricsUpdatedAt ?? null };
    },

    async getPost(id) {
      try {
        const d = await gql<{ post: any }>(
          `query P($id: PostId!) { post(input: { id: $id }) { ${POST_FIELDS} metrics { name type value unit } } }`,
          { id },
        );
        if (!d?.post) return null;
        return { analytics: normalizeBufferMetrics(d.post.metrics ?? []), raw: d.post };
      } catch {
        return null;
      }
    },

    async getChannelPostsMetrics(channelId, limit = 50) {
      const organizationId = await getOrganizationId();
      if (!organizationId) return [];
      try {
        const data = await gql<{ posts: { edges: Array<{ node: any }> } }>(
          `query ChannelPosts($org: OrganizationId!, $ch: ChannelId!, $n: Int!) {
            posts(first: $n, input: { organizationId: $org, filter: { channelIds: [$ch], status: [sent] } }) {
              edges { node { ${POST_FIELDS} metrics { name type value unit } } }
            }
          }`,
          { org: organizationId, ch: channelId, n: limit },
        );
        return (data.posts?.edges ?? []).map((e) => e.node).filter(Boolean).map((n: any) => ({
          id: n.id,
          text: n.text ?? null,
          sentAt: n.sentAt ?? null,
          metricsUpdatedAt: n.metricsUpdatedAt ?? null,
          metrics: normalizeBufferMetrics(n.metrics ?? []),
          raw: n,
        }));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Campaign-aware Buffer credential resolution.
 * Order: campaign-specific credential → the channel's own credential →
 * a shared workspace credential (campaign_id IS NULL).
 */
export async function resolveBufferCredential(
  sb: any,
  userId: string,
  campaignId: string | null | undefined,
  channelCredential?: { api_token: string; graphql_endpoint: string } | null,
): Promise<{ api_token: string; graphql_endpoint: string }> {
  if (campaignId) {
    const { data } = await sb.from("buffer_credentials")
      .select("api_token,graphql_endpoint")
      .eq("user_id", userId).eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (data?.api_token) return data;
  }
  if (channelCredential?.api_token) return channelCredential;
  const { data } = await sb.from("buffer_credentials")
    .select("api_token,graphql_endpoint")
    .eq("user_id", userId).is("campaign_id", null)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (data?.api_token) return data;
  throw new Error("No Buffer credential available for this campaign.");
}
