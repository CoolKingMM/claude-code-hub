import { describe, expect, test } from "vitest";
import { app } from "@/app/api/v1/_root/app";
import { buildOpenApiDocument } from "@/app/api/v1/_root/document";

describe("retired management features", () => {
  test.each([
    "/notifications/settings",
    "/webhook-targets",
    "/public/status",
    "/public/status/settings",
    "/dashboard/client-versions",
    "/dashboard/realtime",
    "/dashboard/provider-slots",
    "/providers/cache-effectiveness",
    "/admin/users/1/insights/overview",
    "/users/1/statistics:reset",
  ])("%s cannot start retired tasks", async (path) => {
    const response = await app.request(`http://localhost/api/v1${path}`);
    expect(response.status).toBe(404);
    const document = buildOpenApiDocument(app);
    expect(document.paths).not.toHaveProperty(path);
  });
  test("key list, model expansion, monetary limits and provider controls remain documented", () => {
    const paths = buildOpenApiDocument(app).paths;
    for (const path of [
      "/keys",
      "/keys/{keyId}/model-stats",
      "/keys/{keyId}/limit-usage",
      "/providers/{id}/limit-usage",
      "/system/settings",
    ])
      expect(paths).toHaveProperty(path);
  });
  test("legacy auxiliary URLs return 410 without importing any worker", async () => {
    const { GET } = await import("@/app/api/public-status/route");
    expect(GET().status).toBe(410);
  });
});
