import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const readCurrentPublicStatusConfigSnapshotMock = vi.hoisted(() => vi.fn());
const readPublicStatusPayloadMock = vi.hoisted(() => vi.fn());
const schedulePublicStatusRebuildMock = vi.hoisted(() => vi.fn());
const savePublicStatusSettingsMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getCachedSystemSettingsMock = vi.hoisted(() => vi.fn());
const lookupIpMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ip-geo/client", () => ({
  lookupIp: lookupIpMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

describe("v1 public status and ip geo endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    readCurrentPublicStatusConfigSnapshotMock.mockResolvedValue({
      configVersion: "cfg-1",
      siteTitle: "CCH",
      siteDescription: "Status page",
      timeZone: "UTC",
      defaultIntervalMinutes: 5,
      defaultRangeHours: 24,
      groups: [{ slug: "default" }],
    });
    readPublicStatusPayloadMock.mockResolvedValue({
      rebuildState: "fresh",
      sourceGeneration: "gen-1",
      generatedAt: "2026-04-28T00:00:00.000Z",
      freshUntil: "2026-04-28T00:05:00.000Z",
      groups: [],
    });
    savePublicStatusSettingsMock.mockResolvedValue({
      ok: true,
      data: {
        updatedGroupCount: 1,
        configVersion: "cfg-1",
        publicStatusProjectionWarningCode: null,
      },
    });
    getCachedSystemSettingsMock.mockResolvedValue({ ipGeoLookupEnabled: true });
    lookupIpMock.mockResolvedValue({
      status: "private",
      data: { ip: "127.0.0.1", kind: "private" },
    });
  });

  test("looks up ip geolocation as a read endpoint", async () => {
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/ip-geo/127.0.0.1?lang=en",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(got.response.status).toBe(200);
    expect(got.json).toEqual({ status: "private", data: { ip: "127.0.0.1", kind: "private" } });
    expect(lookupIpMock).toHaveBeenCalledWith("127.0.0.1", { lang: "en" });
  });

  test("returns problem+json when ip geo is disabled", async () => {
    getCachedSystemSettingsMock.mockResolvedValueOnce({ ipGeoLookupEnabled: false });
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/ip-geo/8.8.8.8",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(got.response.status).toBe(404);
    expect(got.response.headers.get("content-type")).toContain("application/problem+json");
    expect(got.json).toMatchObject({ errorCode: "ip_geo.disabled" });
  });

  test("validates ip geo query parameters before lookup", async () => {
    const got = await callV1Route({
      method: "GET",
      pathname: "/api/v1/ip-geo/8.8.8.8?lang=",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(got.response.status).toBe(400);
    expect(got.json).toMatchObject({ errorCode: "request.validation_failed" });
    expect(lookupIpMock).not.toHaveBeenCalled();
  });

  test("validates ip geo path parameters before lookup", async () => {
    const handlers = await import("@/app/api/v1/resources/public/handlers");
    const got = await handlers.lookupIpGeo({
      req: {
        url: "http://localhost/api/v1/ip-geo/",
        param: () => "",
        query: () => undefined,
      },
    } as never);

    expect(got.status).toBe(400);
    await expect(got.json()).resolves.toMatchObject({
      errorCode: "request.validation_failed",
    });
    expect(lookupIpMock).not.toHaveBeenCalled();
  });

  test("documents public status and ip geo REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/ip-geo/{ip}");
  });
});
