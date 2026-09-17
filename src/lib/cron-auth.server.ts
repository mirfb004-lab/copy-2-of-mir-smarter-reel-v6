// Shared authentication for pg_cron-invoked endpoints.
// Accepts either a private cron secret (when configured) or the project's
// publishable/anon key — the canonical pg_cron `apikey` header pattern.
export function isAuthorizedCronRequest(request: Request): boolean {
  const apikey = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!apikey) return false;
  const allowed = [
    process.env["CRON_INVOKE_SECRET"],
    process.env["CRON_SECRET"],
    process.env["LOVABLE_CRON_SECRET"],
    process.env["SUPABASE_PUBLISHABLE_KEY"],
    process.env["SUPABASE_ANON_KEY"],
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  return allowed.some((value) => value === apikey);
}
