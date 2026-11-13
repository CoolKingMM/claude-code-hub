import { describe, expect, test } from "vitest";
import {
  hasLegacyRedactedWritePlaceholders,
  preserveLegacyProviderUpdateInput,
  sanitizeLegacyProviderResponse,
} from "@/lib/api/legacy-action-sanitizers";

describe("legacy action response sanitizers", () => {
  test("redacts provider secondary secrets kept in legacy list responses", () => {
    const sanitized = sanitizeLegacyProviderResponse({
      id: 1,
      apiKey: "sk-provider-secret-value",
      customHeaders: {
        Authorization: "Bearer upstream",
        "X-Api-Key": "upstream-key",
        "X-Trace": "trace-id",
      },
      providerUrl: "https://provider-user:provider-pass@provider.example.com/v1",
      mcpPassthroughUrl: "https://mcp-user:mcp-pass@mcp.example.com/bridge",
      proxyUrl: "https://user:pass@example.com/proxy",
      url: "https://main-user:main-pass@api.example.com/v1",
      websiteUrl: "https://web-user:web-pass@example.com",
    });

    expect(sanitized.apiKey).toBe("sk-p...[REDACTED]...alue");
    expect(sanitized.customHeaders).toEqual({
      Authorization: "[REDACTED]",
      "X-Api-Key": "[REDACTED]",
      "X-Trace": "trace-id",
    });
    expect(sanitized.providerUrl).toBe("https://REDACTED:REDACTED@provider.example.com/v1");
    expect(sanitized.mcpPassthroughUrl).toBe("https://REDACTED:REDACTED@mcp.example.com/bridge");
    expect(sanitized.proxyUrl).toBe("https://REDACTED:REDACTED@example.com/proxy");
    expect(sanitized.url).toBe("https://REDACTED:REDACTED@api.example.com/v1");
    expect(sanitized.websiteUrl).toBe("https://REDACTED:REDACTED@example.com/");
    expect(JSON.stringify(sanitized)).not.toContain("provider-pass");
    expect(JSON.stringify(sanitized)).not.toContain("main-pass");
    expect(JSON.stringify(sanitized)).not.toContain("web-pass");
  });

  test("preserves legacy provider secrets when redacted values are echoed on update", () => {
    const preserved = preserveLegacyProviderUpdateInput(
      {
        name: "Renamed",
        url: "https://REDACTED:REDACTED@api.example.com/v1",
        proxy_url: "https://REDACTED:REDACTED@proxy.example.com/",
        website_url: "https://REDACTED:REDACTED@example.com/",
        mcp_passthrough_url: "https://REDACTED:REDACTED@mcp.example.com/bridge",
        key: "sk-a...[REDACTED]...xxxx",
        custom_headers: {
          authorization: "[REDACTED]",
          "X-Trace": "changed",
        },
      },
      {
        url: "https://main-user:main-pass@api.example.com/v1",
        proxyUrl: "https://proxy-user:proxy-pass@proxy.example.com",
        websiteUrl: "https://web-user:web-pass@example.com",
        mcpPassthroughUrl: "https://mcp-user:mcp-pass@mcp.example.com/bridge",
        customHeaders: {
          Authorization: "Bearer upstream-secret",
          "X-Trace": "trace-id",
        },
      }
    );

    expect(preserved).toEqual({
      name: "Renamed",
      custom_headers: {
        authorization: "Bearer upstream-secret",
        "X-Trace": "changed",
      },
    });
  });

  test("detects redacted placeholders in legacy create payloads", () => {
    expect(
      hasLegacyRedactedWritePlaceholders({ url: "https://REDACTED:REDACTED@example.com" })
    ).toBe(true);
    expect(
      hasLegacyRedactedWritePlaceholders({ customHeaders: { Authorization: "[REDACTED]" } })
    ).toBe(true);
    expect(hasLegacyRedactedWritePlaceholders({ url: "https://api.example.com" })).toBe(false);
  });
});
