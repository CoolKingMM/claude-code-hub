import { describe, expect, it } from "vitest";
import {
  applyPiAnyRouterCodexRequest,
  PI_CLIENT_MARKER_HEADER,
  PI_INSTALLATION_ID_HEADER,
} from "@/app/v1/_lib/proxy/pi-anyrouter-codex-headers";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

const DEFAULT_SESSION_ID = "019ea62d-bd1e-7ae0-85fa-f5885477e977";
const DEFAULT_INSTALLATION_ID = "e3aa4cb3-82e2-4585-ac99-ae1a4b983972";
const PI_USER_AGENT = "OpenAI/JS 6.40.0";

function createSession(
  overrides: {
    marker?: string;
    installationId?: string | null;
    sessionId?: string | null;
    headerSessionId?: string | null;
    requestSequence?: number;
  } = {}
): ProxySession {
  const sessionId =
    overrides.sessionId === undefined ? DEFAULT_SESSION_ID : overrides.sessionId;
  const headerSessionId =
    overrides.headerSessionId === undefined ? sessionId : overrides.headerSessionId;
  const headers = new Headers([["user-agent", PI_USER_AGENT]]);

  if (overrides.marker !== undefined) {
    headers.set(PI_CLIENT_MARKER_HEADER, overrides.marker);
  }
  if (overrides.installationId !== null) {
    headers.set(
      PI_INSTALLATION_ID_HEADER,
      overrides.installationId ?? DEFAULT_INSTALLATION_ID
    );
  }
  if (headerSessionId) {
    headers.set("session_id", headerSessionId);
    headers.set("x-session-id", headerSessionId);
  }

  return Object.assign(Object.create(ProxySession.prototype), {
    startTime: 1_787_196_155_462,
    headers,
    sessionId,
    requestSequence: overrides.requestSequence ?? 28,
    authState: null,
    messageContext: null,
  }) as ProxySession;
}

function createProvider(providerType: Provider["providerType"]): Provider {
  return {
    id: 115,
    name: providerType === "codex" ? "AnyRouter-codex" : "AnyRouter",
    providerType,
  } as Provider;
}

function applyRequest(args: {
  session: ProxySession;
  providerType?: Provider["providerType"];
  upstreamUrl?: string;
  headers?: Headers;
  body?: Record<string, unknown>;
}) {
  return applyPiAnyRouterCodexRequest({
    session: args.session,
    provider: createProvider(args.providerType ?? "codex"),
    upstreamUrl: args.upstreamUrl ?? "https://anyrouter.top/v1/responses",
    headers: args.headers ?? new Headers(),
    body:
      args.body ??
      ({
        model: "gpt-5.6-sol",
        prompt_cache_key: DEFAULT_SESSION_ID,
        client_metadata: { custom: "preserved" },
      } satisfies Record<string, unknown>),
  });
}

describe("Pi AnyRouter Codex-compatible request metadata", () => {
  it("adds matching headers and client_metadata without impersonating Codex TUI", () => {
    const session = createSession({ marker: "pi" });
    const headers = new Headers([
      ["user-agent", PI_USER_AGENT],
      [PI_CLIENT_MARKER_HEADER, "pi"],
      [PI_INSTALLATION_ID_HEADER, DEFAULT_INSTALLATION_ID],
    ]);
    const body = {
      model: "gpt-5.6-sol",
      prompt_cache_key: DEFAULT_SESSION_ID,
      client_metadata: { custom: "preserved" },
    };

    const result = applyRequest({ session, headers, body });

    expect(result.applied).toBe(true);
    expect(headers.get(PI_CLIENT_MARKER_HEADER)).toBeNull();
    expect(headers.get(PI_INSTALLATION_ID_HEADER)).toBeNull();
    expect(headers.get("originator")).toBe("pi");
    expect(headers.get("user-agent")).toBe(PI_USER_AGENT);
    expect(headers.get("session_id")).toBe(DEFAULT_SESSION_ID);
    expect(headers.get("session-id")).toBe(DEFAULT_SESSION_ID);
    expect(headers.get("x-session-id")).toBe(DEFAULT_SESSION_ID);
    expect(headers.get("thread-id")).toBe(DEFAULT_SESSION_ID);
    expect(headers.get("x-client-request-id")).toBe(DEFAULT_SESSION_ID);
    expect(headers.get("x-codex-window-id")).toBe(`${DEFAULT_SESSION_ID}:28`);
    expect(headers.get("x-openai-internal-codex-responses-lite")).toBeNull();

    const headerMetadata = JSON.parse(headers.get("x-codex-turn-metadata") ?? "{}");
    expect(headerMetadata).toMatchObject({
      installation_id: DEFAULT_INSTALLATION_ID,
      session_id: DEFAULT_SESSION_ID,
      thread_id: DEFAULT_SESSION_ID,
      turn_id: result.applied ? result.turnId : undefined,
      window_id: `${DEFAULT_SESSION_ID}:28`,
      request_kind: "turn",
      thread_source: "user",
      turn_started_at_unix_ms: session.startTime,
    });

    expect(body.client_metadata).toMatchObject({
      custom: "preserved",
      "x-codex-installation-id": DEFAULT_INSTALLATION_ID,
      "x-codex-turn-metadata": headers.get("x-codex-turn-metadata"),
      session_id: DEFAULT_SESSION_ID,
      "x-codex-window-id": `${DEFAULT_SESSION_ID}:28`,
      turn_id: result.applied ? result.turnId : undefined,
      thread_id: DEFAULT_SESSION_ID,
    });
  });

  it("keeps installation id stable while changing generated turn metadata per request", () => {
    const firstSession = createSession({ marker: "pi", requestSequence: 28 });
    const secondSession = createSession({ marker: "pi", requestSequence: 29 });

    const first = applyRequest({
      session: firstSession,
      upstreamUrl: "https://api.anyrouter.top/v1/responses/",
    });
    const second = applyRequest({
      session: secondSession,
      upstreamUrl: "https://api.anyrouter.top/v1/responses/",
    });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(true);
    if (!first.applied || !second.applied) return;

    expect(second.installationId).toBe(first.installationId);
    expect(second.turnId).not.toBe(first.turnId);
    expect(second.windowId).toBe(`${DEFAULT_SESSION_ID}:29`);
  });

  it("preserves valid existing turn metadata and unrelated client metadata", () => {
    const existingTurnId = "01a01d61-341d-7b52-a55f-448dfdcb4470";
    const session = createSession({ marker: "pi", installationId: null });
    const body = {
      prompt_cache_key: DEFAULT_SESSION_ID,
      client_metadata: {
        "x-codex-installation-id": DEFAULT_INSTALLATION_ID,
        "x-codex-turn-metadata": JSON.stringify({
          agent_name: "pi-agent",
          turn_id: existingTurnId,
          window_id: `${DEFAULT_SESSION_ID}:custom`,
        }),
        custom: "preserved",
      },
    };
    const headers = new Headers([["user-agent", PI_USER_AGENT]]);

    const result = applyRequest({ session, headers, body });

    expect(result.applied).toBe(true);
    if (!result.applied) return;

    expect(result.turnId).toBe(existingTurnId);
    expect(result.windowId).toBe(`${DEFAULT_SESSION_ID}:custom`);
    expect(body.client_metadata.custom).toBe("preserved");
    expect(JSON.parse(headers.get("x-codex-turn-metadata") ?? "{}")).toMatchObject({
      agent_name: "pi-agent",
      turn_id: existingTurnId,
    });
  });

  it("recovers the logical session id from headers for hedge shadow sessions", () => {
    const session = createSession({
      marker: "pi",
      sessionId: null,
      headerSessionId: DEFAULT_SESSION_ID,
    });
    const headers = new Headers();
    const body = { model: "gpt-5.6-sol" };

    const result = applyRequest({ session, headers, body });

    expect(result.applied).toBe(true);
    expect(headers.get("session_id")).toBe(DEFAULT_SESSION_ID);
    expect(headers.get("thread-id")).toBe(DEFAULT_SESSION_ID);
    expect(headers.get("x-codex-window-id")).toBe(`${DEFAULT_SESSION_ID}:28`);
  });

  it("does not modify Claude AnyRouter requests", () => {
    const session = createSession({ marker: "pi" });
    const headers = new Headers([
      [PI_CLIENT_MARKER_HEADER, "pi"],
      [PI_INSTALLATION_ID_HEADER, DEFAULT_INSTALLATION_ID],
    ]);
    const body = { model: "claude-sonnet" };

    const result = applyRequest({ session, providerType: "claude", headers, body });

    expect(result).toEqual({ applied: false });
    expect(headers.get(PI_CLIENT_MARKER_HEADER)).toBeNull();
    expect(headers.get(PI_INSTALLATION_ID_HEADER)).toBeNull();
    expect(headers.get("originator")).toBeNull();
    expect(headers.get("x-codex-turn-metadata")).toBeNull();
    expect(body).toEqual({ model: "claude-sonnet" });
  });

  it("does not modify non-AnyRouter Codex requests", () => {
    const session = createSession({ marker: "pi" });
    const headers = new Headers();
    const body = { model: "gpt-5.6-sol" };

    const result = applyRequest({
      session,
      upstreamUrl: "https://rawchat.example.com/v1/responses",
      headers,
      body,
    });

    expect(result).toEqual({ applied: false });
    expect(headers.get("originator")).toBeNull();
    expect(headers.get("x-codex-turn-metadata")).toBeNull();
    expect(body).toEqual({ model: "gpt-5.6-sol" });
  });

  it("requires the exact Responses endpoint path", () => {
    const session = createSession({ marker: "pi" });

    const result = applyRequest({
      session,
      upstreamUrl: "https://anyrouter.top/proxy/v1/responses",
    });

    expect(result).toEqual({ applied: false });
  });

  it("rejects hostnames outside the AnyRouter domain boundary", () => {
    const session = createSession({ marker: "pi" });

    const result = applyRequest({
      session,
      upstreamUrl: "https://anyrouter.top.evil.example/v1/responses",
    });

    expect(result).toEqual({ applied: false });
  });

  it("leaves ordinary Codex requests unchanged when the Pi marker is absent", () => {
    const session = createSession();
    const headers = new Headers([
      ["originator", "codex-tui"],
      ["user-agent", "codex-tui/existing"],
      ["x-codex-turn-metadata", "existing-metadata"],
    ]);
    const body = {
      client_metadata: {
        "x-codex-installation-id": DEFAULT_INSTALLATION_ID,
      },
    };

    const result = applyRequest({ session, headers, body });

    expect(result).toEqual({ applied: false });
    expect(headers.get("originator")).toBe("codex-tui");
    expect(headers.get("user-agent")).toBe("codex-tui/existing");
    expect(headers.get("x-codex-turn-metadata")).toBe("existing-metadata");
    expect(body.client_metadata).toEqual({
      "x-codex-installation-id": DEFAULT_INSTALLATION_ID,
    });
  });

  it("does not apply partial metadata without a valid installation id", () => {
    const session = createSession({
      marker: "pi",
      installationId: "not-a-uuid",
    });
    const headers = new Headers([
      [PI_CLIENT_MARKER_HEADER, "pi"],
      [PI_INSTALLATION_ID_HEADER, "not-a-uuid"],
    ]);
    const body = { model: "gpt-5.6-sol" };

    const result = applyRequest({ session, headers, body });

    expect(result).toEqual({ applied: false });
    expect(headers.get(PI_CLIENT_MARKER_HEADER)).toBeNull();
    expect(headers.get(PI_INSTALLATION_ID_HEADER)).toBeNull();
    expect(headers.get("originator")).toBeNull();
    expect(body).toEqual({ model: "gpt-5.6-sol" });
  });
});
