import { resolveDefaultLayoutTimeZone } from "@/lib/layout-site-metadata";
import { readPublicSiteMeta } from "@/lib/public-site-meta";

export async function GET(): Promise<Response> {
  const [metadata, timeZone] = await Promise.all([
    readPublicSiteMeta(),
    resolveDefaultLayoutTimeZone(),
  ]);
  return Response.json(
    { available: true, ...metadata, timeZone, source: "settings" },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } }
  );
}
