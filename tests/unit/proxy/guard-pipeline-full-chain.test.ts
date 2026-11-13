import { describe, expect, test, vi } from "vitest";

const callOrder: string[] = [];
const replayResult: Response | null = null;

vi.mock("@/app/v1/_lib/proxy/auth-guard", () => ({
  ProxyAuthenticator: {
    ensure: async () => {
      callOrder.push("auth");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/client-guard", () => ({
  ProxyClientGuard: {
    ensure: async () => {
      callOrder.push("client");
      return null;
    },
  },
}));

vi.mock("@/app/v1/_lib/proxy/model-guard", () => ({
  ProxyModelGuard: {
    ensure: async () => {
      callOrder.push("model");
      return null;
    },
  },
}));

test("默认对话及辅助端点保留鉴权、客户端和渠道守卫", async () => {
  const { CHAT_PIPELINE, RAW_PASSTHROUGH_PIPELINE, RAW_SAFE_SESSION_PIPELINE } = await import(
    "@/app/v1/_lib/proxy/guard-pipeline"
  );
  for (const preset of [CHAT_PIPELINE, RAW_PASSTHROUGH_PIPELINE, RAW_SAFE_SESSION_PIPELINE]) {
    expect(preset.steps).toContain("auth");
    expect(preset.steps).toContain("client");
    expect(preset.steps).toContain("provider");
    expect(preset.steps).not.toContain("version");
  }
});
