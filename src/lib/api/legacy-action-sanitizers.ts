import {
  redactHeaderRecord,
  redactSecret,
  redactUrlCredentials,
} from "@/lib/api/v1/_shared/redaction";

type LegacySecretBearingRecord = {
  apiKey?: string | null;
  customHeaders?: Record<string, string> | null;
  mcpPassthroughUrl?: string | null;
  providerUrl?: string | null;
  proxyUrl?: string | null;
  url?: string | null;
  websiteUrl?: string | null;
};

export function sanitizeLegacyProviderResponse<T extends LegacySecretBearingRecord>(
  provider: T
): T {
  return {
    ...provider,
    apiKey: provider.apiKey === undefined ? provider.apiKey : redactSecret(provider.apiKey),
    customHeaders:
      provider.customHeaders === undefined
        ? provider.customHeaders
        : redactHeaderRecord(provider.customHeaders),
    providerUrl:
      provider.providerUrl === undefined
        ? provider.providerUrl
        : redactUrlCredentials(provider.providerUrl),
    mcpPassthroughUrl:
      provider.mcpPassthroughUrl === undefined
        ? provider.mcpPassthroughUrl
        : redactUrlCredentials(provider.mcpPassthroughUrl),
    proxyUrl:
      provider.proxyUrl === undefined ? provider.proxyUrl : redactUrlCredentials(provider.proxyUrl),
    url: provider.url === undefined ? provider.url : redactUrlCredentials(provider.url),
    websiteUrl:
      provider.websiteUrl === undefined
        ? provider.websiteUrl
        : redactUrlCredentials(provider.websiteUrl),
  };
}

export function preserveLegacyProviderUpdateInput<
  T extends Record<string, unknown>,
  P extends LegacySecretBearingRecord,
>(input: T, existing: P): T {
  const next: Record<string, unknown> = { ...input };
  const urlFields = [
    ["url", "url"],
    ["proxy_url", "proxyUrl"],
    ["website_url", "websiteUrl"],
    ["mcp_passthrough_url", "mcpPassthroughUrl"],
  ] as const;

  for (const [inputKey, existingKey] of urlFields) {
    if (isRedactedUrlEcho(next[inputKey], existing[existingKey])) {
      delete next[inputKey];
    }
  }

  if (typeof next.key === "string" && hasLegacyRedactedWritePlaceholders(next.key)) {
    delete next.key;
  }

  const customHeaders = next.custom_headers ?? next.customHeaders;
  if (isHeaderRecord(customHeaders) && existing.customHeaders) {
    const restored = restoreRedactedHeaderValues(customHeaders, existing.customHeaders);
    if (next.custom_headers !== undefined) next.custom_headers = restored;
    if (next.customHeaders !== undefined) next.customHeaders = restored;
  }

  return next as T;
}

export function hasLegacyRedactedWritePlaceholders(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("[REDACTED]") || value.includes("REDACTED:REDACTED@");
  }
  if (Array.isArray(value)) return value.some(hasLegacyRedactedWritePlaceholders);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(hasLegacyRedactedWritePlaceholders);
}

function isRedactedUrlEcho(value: unknown, existing: string | null | undefined): boolean {
  if (typeof value !== "string" || !existing) return false;
  const redactedExisting = redactUrlCredentials(existing);
  return redactedExisting !== existing && redactedExisting === value;
}

function isHeaderRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function restoreRedactedHeaderValues(
  incoming: Record<string, string>,
  existing: Record<string, string>
): Record<string, string> {
  const redactedExisting = redactHeaderRecord(existing) ?? {};
  const existingByLowerName = new Map(
    Object.entries(existing).map(([name, value]) => [name.toLowerCase(), value])
  );
  const redactedExistingByLowerName = new Map(
    Object.entries(redactedExisting).map(([name, value]) => [name.toLowerCase(), value])
  );

  return Object.fromEntries(
    Object.entries(incoming).map(([name, value]) => [
      name,
      value === "[REDACTED]" &&
      (redactedExisting[name] === "[REDACTED]" ||
        redactedExistingByLowerName.get(name.toLowerCase()) === "[REDACTED]")
        ? (existing[name] ?? existingByLowerName.get(name.toLowerCase()) ?? value)
        : value,
    ])
  );
}
