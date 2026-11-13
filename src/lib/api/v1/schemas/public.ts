import { z } from "@hono/zod-openapi";

export const IpGeoParamSchema = z.object({
  ip: z.string().min(1).describe("IP address to look up."),
});

export const IpGeoQuerySchema = z.object({
  lang: z.string().min(1).optional().describe("Preferred result language."),
});

export const IpGeoLookupResponseSchema = z
  .union([
    z.object({
      status: z.literal("ok"),
      data: z.record(z.string(), z.unknown()).describe("IP geolocation lookup result."),
    }),
    z.object({
      status: z.literal("private"),
      data: z.object({
        ip: z.string().describe("Private IP address."),
        kind: z.literal("private"),
      }),
    }),
    z.object({
      status: z.literal("error"),
      error: z.string().describe("Lookup error."),
    }),
  ])
  .describe("IP geolocation response.");

export type IpGeoLookupResponse = z.infer<typeof IpGeoLookupResponseSchema>;
