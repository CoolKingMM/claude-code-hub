import { describe, expect, test } from "vitest";
import { deriveClientSafeUpstreamErrorMessage } from "@/app/v1/_lib/proxy/client-error-message";

describe("deriveClientSafeUpstreamErrorMessage", () => {
  test("extracts sanitized upstream message from JSON without secrets or origin data", () => {
    const message = deriveClientSafeUpstreamErrorMessage({
      rawText: JSON.stringify({
        error: {
          message:
            "Quota exceeded for key sk-test-1234567890abcdef at https://api.vendor.example/v1/messages request_id=req_abc123",
        },
      }),
    });

    expect(message).toContain("Quota exceeded");
    expect(message).not.toContain("sk-test");
    expect(message).not.toContain("https://");
    expect(message).not.toContain("api.vendor.example");
    expect(message).not.toContain("req_abc123");
  });

  test("extracts sanitized upstream message from SSE data", () => {
    const message = deriveClientSafeUpstreamErrorMessage({
      rawText: 'event: error\ndata: {"error":{"message":"Upstream overload"}}\n\n',
    });

    expect(message).toBe("Upstream overload");
  });

  test("rejects provider and internal details", () => {
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "Provider Anthropic returned: overload",
        providerName: "Anthropic",
      })
    ).toBeNull();
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "FAKE_200_JSON_ERROR_NON_EMPTY",
      })
    ).toBeNull();
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "HTTP 500",
      })
    ).toBeNull();
  });

  test("rejects raw JSON blob instead of returning object text", () => {
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: '{"error":{"message":"Quota exceeded"}}',
      })
    ).toBeNull();
  });

  test("rejects candidates that become empty after redaction", () => {
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "https://api.vendor.example/v1/messages request_id=req_abc123",
      })
    ).toBeNull();
  });

  test("falls back to candidateMessage when rawText is unsafe but secondary candidate is safe", () => {
    const message = deriveClientSafeUpstreamErrorMessage({
      rawText: JSON.stringify({
        error: {
          message:
            "Provider Anthropic returned: overload at gateway.internal:443 request_id=req_abc",
        },
      }),
      candidateMessage: "Quota exceeded",
      providerName: "Anthropic",
    });

    expect(message).toBe("Quota exceeded");
  });

  test("rejects host-like and internal routing labels without scheme", () => {
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "gateway.internal:443 region-us-east-1a",
      })
    ).toBeNull();
  });
});

import {
  deriveUpstreamBusinessErrorMessage,
  isUpstreamTransportError,
} from "@/app/v1/_lib/proxy/client-error-message";
describe("business-error diagnostics", () => {
  test.each([
    [402, "insufficient_balance", "OpenAI credits exhausted; top up your balance"],
    [403, "model_not_in_plan", "deepseek-v4.1-flash-1017 is not subscribed to the required plan"],
    [400, "invalid_request_error", "Codex previous_response_id is invalid"],
    [429, "rate_limit_exceeded", "Quota exceeded; retry after 30 seconds"],
    [503, "insufficient_quota", "余额不足，请充值"],
    [503, "UNAVAILABLE", "No capacity available for model gemini-3.8-flash-high on the server"],
  ])("retains the business explanation and code for HTTP %i", (statusCode, code, message) => {
    const result = deriveUpstreamBusinessErrorMessage({
      statusCode,
      rawText: JSON.stringify({ error: { message, code } }),
    });
    expect(result).toContain(`Upstream HTTP ${statusCode}`);
    expect(result).toContain(message);
    expect(result).toContain(code);
  });
  test("keeps long useful explanations without leaking credentials", () => {
    const result = deriveUpstreamBusinessErrorMessage({
      statusCode: 400,
      rawText: JSON.stringify({
        error: {
          message: `Invalid parameter: ${"model context exceeded; ".repeat(100)} api_key=sk-secret-1234567890abcdef`,
        },
      }),
    });
    expect(result?.length).toBeLessThanOrEqual(1030);
    expect(result).not.toContain("sk-secret");
  });
  test.each([
    "ECONNRESET",
    "ENOTFOUND",
    "TLS handshake failed",
    "socket hang up",
    "fetch failed",
    "request timeout",
    "network error",
  ])("keeps %s in the existing transport path", (message) => {
    expect(isUpstreamTransportError({ message })).toBe(true);
    expect(
      deriveUpstreamBusinessErrorMessage({
        statusCode: 502,
        rawText: JSON.stringify({ error: { message } }),
      })
    ).toBeNull();
  });
  test("excludes timeout pages and unrelated infrastructure failures", () => {
    expect(
      deriveUpstreamBusinessErrorMessage({
        statusCode: 504,
        rawText: '{"error":{"message":"request timeout"}}',
      })
    ).toBeNull();
    expect(
      deriveUpstreamBusinessErrorMessage({
        statusCode: 502,
        rawText: "<html>gateway timeout</html>",
      })
    ).toBeNull();
    expect(
      deriveUpstreamBusinessErrorMessage({
        statusCode: 503,
        rawText: '{"error":{"message":"database temporarily unavailable"}}',
      })
    ).toBeNull();
    expect(isUpstreamTransportError({ cause: new Error("ECONNREFUSED") })).toBe(true);
  });
  test("Gemini status and short provider names preserve the client explanation", () => {
    expect(
      deriveUpstreamBusinessErrorMessage({
        statusCode: 503,
        providerName: "CLI",
        rawText: JSON.stringify({
          error: {
            code: 503,
            status: "UNAVAILABLE",
            message: "No capacity available for model gemini-3.8-flash-high; client must retry",
          },
        }),
      })
    ).toContain("client must retry (UNAVAILABLE)");
  });
  test("handles nested relays, plain text and strips a carried HTTP prefix", () => {
    expect(
      deriveUpstreamBusinessErrorMessage({
        statusCode: 403,
        rawText: '{"error":{"upstream_error":{"error":{"message":"model not supported"}}}}',
      })
    ).toContain("model not supported");
    expect(
      deriveUpstreamBusinessErrorMessage({
        statusCode: 402,
        candidateMessage: "Upstream HTTP 402: Balance exhausted",
      })
    ).toBe("Upstream HTTP 402: Balance exhausted");
    expect(
      deriveUpstreamBusinessErrorMessage({ statusCode: 200, candidateMessage: "Balance exhausted" })
    ).toBeNull();
  });
});
