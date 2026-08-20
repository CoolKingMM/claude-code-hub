import { createHash } from "node:crypto";
import type { Provider } from "@/types/provider";
import { normalizeCodexSessionId } from "../codex/session-extractor";
import type { ProxySession } from "./session";

/** Internal opt-in marker sent by the Pi provider configuration. */
export const PI_CLIENT_MARKER_HEADER = "x-cch-client";
export const PI_CLIENT_MARKER_VALUE = "pi";

/** Optional stable UUID supplied by Pi and consumed only by CCH. */
export const PI_INSTALLATION_ID_HEADER = "x-cch-pi-installation-id";

const PI_ORIGINATOR = "pi";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V5_DNS_NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");

export type PiAnyRouterCodexRequestResult =
  | { applied: false }
  | {
      applied: true;
      installationId: string;
      turnId: string;
      windowId: string;
      sessionId: string;
    };

function isAnyRouterHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "anyrouter.top" || normalized.endsWith(".anyrouter.top");
}

function isResponsesPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === "/v1/responses";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

function getInstallationId(
  session: ProxySession,
  body: Record<string, unknown>
): string | null {
  const clientMetadata = isRecord(body.client_metadata) ? body.client_metadata : null;
  const suppliedHeader = session.headers.get(PI_INSTALLATION_ID_HEADER)?.trim();
  const suppliedBody = clientMetadata?.["x-codex-installation-id"];

  if (isUuid(suppliedHeader)) return suppliedHeader.toLowerCase();
  if (isUuid(suppliedBody)) return suppliedBody.trim().toLowerCase();
  return null;
}

function hasPiMarker(session: ProxySession): boolean {
  return (
    session.headers.get(PI_CLIENT_MARKER_HEADER)?.trim().toLowerCase() === PI_CLIENT_MARKER_VALUE
  );
}

function getSessionId(session: ProxySession, body: Record<string, unknown>): string | null {
  const clientMetadata = isRecord(body.client_metadata) ? body.client_metadata : null;

  return (
    normalizeCodexSessionId(session.sessionId) ??
    normalizeCodexSessionId(session.headers.get("session_id")) ??
    normalizeCodexSessionId(session.headers.get("x-session-id")) ??
    normalizeCodexSessionId(session.headers.get("session-id")) ??
    normalizeCodexSessionId(body.prompt_cache_key) ??
    normalizeCodexSessionId(clientMetadata?.session_id)
  );
}

function isAnyRouterResponsesUrl(upstreamUrl: string): boolean {
  try {
    const upstream = new URL(upstreamUrl);
    return isAnyRouterHostname(upstream.hostname) && isResponsesPath(upstream.pathname);
  } catch {
    return false;
  }
}

/**
 * Add the non-secret request metadata that Codex TUI sends to AnyRouter.
 *
 * This is deliberately opt-in and limited to Codex providers on AnyRouter's
 * Responses endpoint. It does not change Claude requests, ordinary Codex
 * requests, or the client's identity/user-agent.
 */
export function applyPiAnyRouterCodexRequest(args: {
  session: ProxySession;
  provider: Provider;
  upstreamUrl: string;
  headers: Headers;
  body: Record<string, unknown>;
}): PiAnyRouterCodexRequestResult {
  const { session, provider, upstreamUrl, headers, body } = args;
  const marked = hasPiMarker(session);

  // These headers are CCH-only and must never be forwarded, including when
  // the request does not match the compatibility target.
  headers.delete(PI_CLIENT_MARKER_HEADER);
  headers.delete(PI_INSTALLATION_ID_HEADER);

  if (!marked || provider.providerType !== "codex" || !isAnyRouterResponsesUrl(upstreamUrl)) {
    return { applied: false };
  }

  const sessionId = getSessionId(session, body);
  const requestSequence = session.requestSequence;
  if (!sessionId || !Number.isSafeInteger(requestSequence) || requestSequence <= 0) {
    return { applied: false };
  }

  const installationId = getInstallationId(session, body);
  if (!installationId) {
    return { applied: false };
  }

  const existingMetadata = {
    ...parseJsonRecord(headers.get("x-codex-turn-metadata")),
    ...(isRecord(body.client_metadata)
      ? parseJsonRecord(
          typeof body.client_metadata["x-codex-turn-metadata"] === "string"
            ? body.client_metadata["x-codex-turn-metadata"]
            : null
        )
      : {}),
  };
  const existingTurnId = existingMetadata.turn_id;
  const turnId = isUuid(existingTurnId)
    ? existingTurnId.trim().toLowerCase()
    : deterministicUuid(
        `cch:pi:anyrouter:turn:v2:${installationId}:${sessionId}:${requestSequence}`
      );
  const existingWindowId = existingMetadata.window_id;
  const windowId =
    typeof existingWindowId === "string" && existingWindowId.startsWith(`${sessionId}:`)
      ? existingWindowId
      : `${sessionId}:${requestSequence}`;

  const turnMetadata = {
    ...existingMetadata,
    installation_id: installationId,
    session_id: sessionId,
    thread_id: sessionId,
    turn_id: turnId,
    window_id: windowId,
    request_kind: "turn",
    thread_source: "user",
    turn_started_at_unix_ms:
      typeof existingMetadata.turn_started_at_unix_ms === "number"
        ? existingMetadata.turn_started_at_unix_ms
        : session.startTime,
  };
  const turnMetadataValue = JSON.stringify(turnMetadata);

  // Keep Pi's own User-Agent and originator value. The compatibility fields
  // describe the request shape; they are not an attempt to forge client
  // software identity or inject OpenAI-internal headers.
  headers.set("originator", PI_ORIGINATOR);
  headers.set("session_id", sessionId);
  headers.set("session-id", sessionId);
  headers.set("x-session-id", sessionId);
  headers.set("thread-id", sessionId);
  headers.set("x-client-request-id", sessionId);
  headers.set("x-codex-window-id", windowId);
  headers.set("x-codex-turn-metadata", turnMetadataValue);

  const clientMetadata = isRecord(body.client_metadata) ? { ...body.client_metadata } : {};
  clientMetadata["x-codex-installation-id"] = installationId;
  clientMetadata["x-codex-turn-metadata"] = turnMetadataValue;
  clientMetadata.session_id = sessionId;
  clientMetadata["x-codex-window-id"] = windowId;
  clientMetadata.turn_id = turnId;
  clientMetadata.thread_id = sessionId;
  body.client_metadata = clientMetadata;

  return { applied: true, installationId, turnId, windowId, sessionId };
}
