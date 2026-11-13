import type { Context } from "hono";
import { createProblemResponse, fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { jsonResponse } from "@/lib/api/v1/_shared/response-helpers";
import { IpGeoParamSchema, IpGeoQuerySchema } from "@/lib/api/v1/schemas/public";

export async function lookupIpGeo(c: Context): Promise<Response> {
  const params = IpGeoParamSchema.safeParse({ ip: c.req.param("ip") });
  if (!params.success) return fromZodError(params.error, new URL(c.req.url).pathname);
  const query = IpGeoQuerySchema.safeParse({ lang: c.req.query("lang") });
  if (!query.success) return fromZodError(query.error, new URL(c.req.url).pathname);

  const [{ getCachedSystemSettings }, { lookupIp }] = await Promise.all([
    import("@/lib/config/system-settings-cache"),
    import("@/lib/ip-geo/client"),
  ]);
  const settings = await getCachedSystemSettings();
  if (!settings.ipGeoLookupEnabled) {
    return createProblemResponse({
      status: 404,
      instance: new URL(c.req.url).pathname,
      errorCode: "ip_geo.disabled",
      detail: "IP geolocation lookup is disabled.",
    });
  }

  const result = await lookupIp(params.data.ip, { lang: query.data.lang });
  return jsonResponse(result, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
