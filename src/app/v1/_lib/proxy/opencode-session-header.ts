import { createHash, randomUUID } from "node:crypto";
import type { Provider } from "@/types/provider";
import type { ProxySession } from "./session";

export const OPENCODE_SESSION_HEADER = "x-opencode-session";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V5_DNS_NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");

export type OpenCodeSessionHeaderResult =
  | { applied: false }
  | { applied: true; sessionId: string; source: "client" | "session" | "generated" };

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

function deterministicUuid(seed: string): string {
  const bytes = createHash("sha1")
    .update(UUID_V5_DNS_NAMESPACE)
    .update(seed, "utf8")
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

function isOpenCodeGoUrl(value: string | null | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return (
      (hostname === "opencode.ai" || hostname.endsWith(".opencode.ai")) &&
      (pathname === "/zen/go" || pathname.startsWith("/zen/go/"))
    );
  } catch {
    return false;
  }
}

function isOpenCodeGoProvider(provider: Provider, upstreamUrl: string): boolean {
  return (
    provider.name?.trim().toLowerCase() === "opencode go" ||
    isOpenCodeGoUrl(upstreamUrl) ||
    isOpenCodeGoUrl(provider.url)
  );
}

function resolveSessionUuid(session: ProxySession): {
  sessionId: string;
  source: "session" | "generated";
} {
  const existingSessionUuid = normalizeUuid(session.sessionId);
  if (existingSessionUuid) {
    return { sessionId: existingSessionUuid, source: "session" };
  }

  if (session.sessionId) {
    const keyId = session.authState?.key?.id ?? "unknown";
    return {
      sessionId: deterministicUuid(`cch:opencode-go:session:v1:${keyId}:${session.sessionId}`),
      source: "session",
    };
  }

  return { sessionId: randomUUID(), source: "generated" };
}

/**
 * Add the stable per-conversation UUID required by the OpenCode Go endpoint.
 * The client-provided header is accepted only when it is already a UUID;
 * otherwise the CCH session identity is converted to a deterministic UUID.
 */
export function applyOpenCodeGoSessionHeader(args: {
  session: ProxySession;
  provider: Provider;
  upstreamUrl: string;
  headers: Headers;
}): OpenCodeSessionHeaderResult {
  const { session, provider, upstreamUrl, headers } = args;

  if (!isOpenCodeGoProvider(provider, upstreamUrl)) {
    headers.delete(OPENCODE_SESSION_HEADER);
    return { applied: false };
  }

  const clientSessionId = normalizeUuid(session.headers.get(OPENCODE_SESSION_HEADER));
  if (clientSessionId) {
    headers.set(OPENCODE_SESSION_HEADER, clientSessionId);
    return { applied: true, sessionId: clientSessionId, source: "client" };
  }

  const resolved = resolveSessionUuid(session);
  headers.set(OPENCODE_SESSION_HEADER, resolved.sessionId);
  return { applied: true, ...resolved };
}
