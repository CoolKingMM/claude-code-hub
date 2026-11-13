import { describe, expect, test, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";

const callOrder: string[] = [];

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
