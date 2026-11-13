import type { AuthSession } from "@/lib/auth";
import type { ProviderDisplay } from "@/types/provider";
import { afterEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getProvidersMock = vi.hoisted(() => vi.fn());
const addProviderMock = vi.hoisted(() => vi.fn());
const editProviderMock = vi.hoisted(() => vi.fn());
const getWebhookTargetsActionMock = vi.hoisted(() => vi.fn());
const updateWebhookTargetActionMock = vi.hoisted(() => vi.fn());
const getBindingsForTypeActionMock = vi.hoisted(() => vi.fn());
const getNotificationSettingsActionMock = vi.hoisted(() => vi.fn());
const updateNotificationSettingsActionMock = vi.hoisted(() => vi.fn());

const legacyAdminToken = process.env.TEST_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? "admin-token";

const adminSession = {
  user: { id: -1, role: "admin", isEnabled: true },
  key: { id: -1, userId: -1, key: legacyAdminToken, canLoginWebUi: true },
  credentialType: "admin-token",
} as AuthSession;

const provider = {
  id: 1,
  name: "Primary",
  url: "https://main-user:main-pass@api.example.com/v1",
  maskedKey: "sk-...1234",
  proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
  websiteUrl: "https://web-user:web-pass@example.com",
  mcpPassthroughUrl: "https://mcp-user:mcp-pass@mcp.example.com/bridge",
  customHeaders: {
    "Cf-Aig-Authorization": "Bearer upstream-secret",
    "X-Trace": "trace-id",
  },
} as ProviderDisplay;

async function postLegacyAction(moduleName: string, actionName: string, body: unknown) {
  const route = await import("@/app/api/actions/[...route]/route");
  const response = await route.POST(
    new Request(`http://localhost/api/actions/${moduleName}/${actionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${legacyAdminToken}`,
      },
      body: JSON.stringify(body),
    })
  );
  return { response, body: await response.json() };
}

describe("legacy actions API redaction compatibility", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock("@/lib/auth");
    vi.doUnmock("@/actions/providers");
    vi.resetModules();
  });

  test("preserves legacy provider secrets when redacted values are echoed into editProvider", async () => {
    vi.resetModules();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getProvidersMock.mockResolvedValue([provider]);
    editProviderMock.mockResolvedValue({
      ok: true,
      data: { operationId: "op", undoToken: "undo" },
    });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/providers", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/actions/providers")>();
      return {
        ...actual,
        getProviders: getProvidersMock,
        editProvider: editProviderMock,
      };
    });

    const { response } = await postLegacyAction("providers", "editProvider", {
      providerId: 1,
      name: "Renamed",
      url: "https://REDACTED:REDACTED@api.example.com/v1",
      proxy_url: "https://REDACTED:REDACTED@proxy.example.com/",
      website_url: "https://REDACTED:REDACTED@example.com/",
      mcp_passthrough_url: "https://REDACTED:REDACTED@mcp.example.com/bridge",
      custom_headers: {
        "cf-aig-authorization": "[REDACTED]",
        "X-Trace": "changed",
      },
    });

    expect(response.status).toBe(200);
    expect(editProviderMock).toHaveBeenCalledWith(1, {
      name: "Renamed",
      custom_headers: {
        "cf-aig-authorization": "Bearer upstream-secret",
        "X-Trace": "changed",
      },
    });
  }, 20_000);

  test("rejects legacy provider creates that contain redacted placeholders", async () => {
    vi.resetModules();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    addProviderMock.mockResolvedValue({ ok: true, data: { id: 2 } });

    vi.doMock("@/lib/auth", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/auth")>();
      return { ...actual, validateAuthToken: validateAuthTokenMock };
    });
    vi.doMock("@/actions/providers", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/actions/providers")>();
      return { ...actual, addProvider: addProviderMock };
    });

    const { response, body } = await postLegacyAction("providers", "addProvider", {
      name: "Clone",
      url: "https://REDACTED:REDACTED@api.example.com/v1",
      key: "sk-new",
      provider_type: "claude",
    });

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false });
    expect(addProviderMock).not.toHaveBeenCalled();
  }, 20_000);
});
