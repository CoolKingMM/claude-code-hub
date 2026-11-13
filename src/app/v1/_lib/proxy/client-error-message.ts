import {
  detectUpstreamErrorFromSseOrJsonText,
  sanitizeErrorTextForDetail,
} from "@/lib/utils/upstream-error-detection";
import { ALL_PROVIDERS_UNAVAILABLE_MESSAGE } from "./errors";

export interface DeriveClientSafeUpstreamErrorMessageInput {
  rawText?: string;
  candidateMessage?: string;
  providerName?: string | null;
  forbiddenProviderLabels?: string[];
}

const MAX_CLIENT_ERROR_MESSAGE_CHARS = 240;
const ELLIPSIS = "...";
const DEFAULT_FORBIDDEN_PROVIDER_LABELS = [
  "anthropic",
  "openai",
  "gemini",
  "google",
  "vertex",
  "bedrock",
  "azure",
  "deepseek",
  "grok",
  "claude",
  "codex",
  "openrouter",
  "siliconflow",
  "dashscope",
  "qwen",
  "kimi",
];

const INTERNAL_ONLY_RE = new RegExp(
  `^(?:FAKE_200_[A-Z0-9_]+|EMPTY_RESPONSE|HTTP\\s+\\d{3}|No available providers?|No available provider endpoints|${ALL_PROVIDERS_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})$`,
  "iu"
);
const PROVIDER_PREFIX_RE = /\bProvider\s+[\w.-]+(?:\s+returned|\s*:|\s+-)/iu;
// Reject both anchored-at-start and embedded raw JSON blobs; embedded JSON would otherwise
// leak provider-shaped payloads (e.g. `Bad request: {"error":{"message":"..."}}`).
const RAW_JSON_BLOB_ANCHORED_RE = /^[[{]/u;
const RAW_JSON_BLOB_EMBEDDED_RE = /[[{]\s*"[^"\n]{1,80}"\s*:/u;
// Replacement regexes use the /g flag so `String.prototype.replace` can strip every match.
// `String.prototype.replace` resets `lastIndex`, so these stay safe during normalization.
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/giu;
const DOMAIN_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ai|app|dev|cloud|cn|co|uk|jp|ru|de|fr|us|example)(?:\b|\/[^\s"'<>]*)/giu;
const HOSTLIKE_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s"'<>]*)?\b/giu;
// Narrowed: bare common nouns like "endpoint"/"node"/"route" only trigger when followed by
// an infrastructure-style qualifier (separator + token, or explicit port), to avoid
// stripping natural phrases like "Rate limit exceeded for this endpoint".
const INTERNAL_LABEL_RE =
  /\b(?:gateway|proxy|provider|vendor|region|shard|cluster|internal|router|route|endpoint|node|alpha|beta)(?:[-_./][\w.-]{2,}|:\d{2,5}(?:\/[^\s"'<>]*)?)\b/giu;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/g;
const IPV6_RE =
  /(?:\[[0-9a-fA-F:]+\](?::\d{2,5})?|(?:\b[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b)/g;
const REQUEST_ID_RE =
  /\b(?:request[_ -]?id|x-request-id|req(?:uest)?[_ -]?id|trace[_ -]?id|cf-ray)\b\s*[:=]?\s*[A-Za-z0-9._:-]{3,}\b/giu;
const REQUEST_ID_TOKEN_RE = /\b(?:req|msg|chatcmpl|run|trace)_[A-Za-z0-9._-]{3,}\b/giu;
const KEY_VALUE_RE =
  /\b(?:api[_ -]?key|token|secret|password)\b\s*[:=]\s*(?:\[REDACTED(?:_KEY)?\]|\[JWT\]|\*\*\*|[A-Za-z0-9._-]{6,})/giu;
const API_KEY_SHAPE_RE = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/iu;

// Non-global counterparts used by `.test()` to avoid the lastIndex-state hazard of `/g` regexes.
const URL_TEST_RE = /\bhttps?:\/\/[^\s"'<>]+/iu;
const DOMAIN_TEST_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ai|app|dev|cloud|cn|co|uk|jp|ru|de|fr|us|example)(?:\b|\/[^\s"'<>]*)/iu;
const HOSTLIKE_TEST_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s"'<>]*)?\b/iu;
const IPV4_TEST_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/;
const IPV6_TEST_RE =
  /(?:\[[0-9a-fA-F:]+\](?::\d{2,5})?|(?:\b[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b)/;
const REQUEST_ID_TEST_RE =
  /\b(?:request[_ -]?id|x-request-id|req(?:uest)?[_ -]?id|trace[_ -]?id|cf-ray)\b\s*[:=]?\s*[A-Za-z0-9._:-]{3,}\b/iu;
const REQUEST_ID_TOKEN_TEST_RE = /\b(?:req|msg|chatcmpl|run|trace)_[A-Za-z0-9._-]{3,}\b/iu;
const INTERNAL_LABEL_TEST_RE =
  /\b(?:gateway|proxy|provider|vendor|region|shard|cluster|internal|router|route|endpoint|node|alpha|beta)(?:[-_./][\w.-]{2,}|:\d{2,5}(?:\/[^\s"'<>]*)?)\b/iu;

function isAscii(text: string): boolean {
  return [...text].every((char) => char.charCodeAt(0) <= 0x7f);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsRawJsonBlob(text: string): boolean {
  return RAW_JSON_BLOB_ANCHORED_RE.test(text) || RAW_JSON_BLOB_EMBEDDED_RE.test(text);
}

function hasForbiddenProviderLabel(message: string, labels: string[]): boolean {
  const normalized = message.toLocaleLowerCase();
  if (PROVIDER_PREFIX_RE.test(message)) return true;

  return labels.some((label) => {
    const trimmed = label.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLocaleLowerCase();
    if (lower.length <= 1) return false;

    const boundary =
      /^[\w.-]+$/u.test(trimmed) && isAscii(trimmed)
        ? new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "iu")
        : null;
    return boundary ? boundary.test(message) : normalized.includes(lower);
  });
}

function normalizeClientMessage(text: string): string {
  let sanitized = sanitizeErrorTextForDetail(text);

  sanitized = sanitized
    .replace(URL_RE, " ")
    .replace(DOMAIN_RE, " ")
    .replace(HOSTLIKE_RE, " ")
    .replace(IPV4_RE, " ")
    .replace(IPV6_RE, " ")
    .replace(REQUEST_ID_RE, " ")
    .replace(REQUEST_ID_TOKEN_RE, " ")
    .replace(INTERNAL_LABEL_RE, " ")
    .replace(KEY_VALUE_RE, " ")
    .replace(/\b(?:request[_ -]?id|x-request-id|trace[_ -]?id)\b\s*[:=]?\s*$/giu, " ")
    .replace(/\s+\b(?:at|from|for|with)\b\s*(?:[,.;:，。；：]|$)/giu, " ")
    .replace(/\s*[,;，；]\s*/g, ", ")
    .replace(/\s*[:：]\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();

  sanitized = sanitized.replace(/^(?:error|message)\s*[:：]\s*/iu, "").trim();
  if (sanitized.length > MAX_CLIENT_ERROR_MESSAGE_CHARS) {
    const budget = MAX_CLIENT_ERROR_MESSAGE_CHARS - ELLIPSIS.length;
    sanitized = `${sanitized.slice(0, budget).trim()}${ELLIPSIS}`;
  }

  return sanitized;
}

function isUnsafeAfterRedaction(text: string): boolean {
  if (!text.trim()) return true;
  if (
    URL_TEST_RE.test(text) ||
    DOMAIN_TEST_RE.test(text) ||
    HOSTLIKE_TEST_RE.test(text) ||
    IPV4_TEST_RE.test(text) ||
    IPV6_TEST_RE.test(text)
  ) {
    return true;
  }
  if (REQUEST_ID_TEST_RE.test(text) || REQUEST_ID_TOKEN_TEST_RE.test(text)) return true;
  if (INTERNAL_LABEL_TEST_RE.test(text)) return true;
  if (API_KEY_SHAPE_RE.test(text)) return true;
  return false;
}

function deriveCandidateFromRawText(rawText: string | undefined): string | null {
  if (typeof rawText !== "string" || !rawText.trim()) return null;
  const detected = detectUpstreamErrorFromSseOrJsonText(rawText);
  if (!detected.isError || !detected.detail) return null;
  return detected.detail;
}

export function deriveClientSafeUpstreamErrorMessage(
  input: DeriveClientSafeUpstreamErrorMessageInput
): string | null {
  const labels = [
    input.providerName ?? "",
    ...DEFAULT_FORBIDDEN_PROVIDER_LABELS,
    ...(input.forbiddenProviderLabels ?? []),
  ].filter(Boolean);
  const candidates = [deriveCandidateFromRawText(input.rawText), input.candidateMessage].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed || INTERNAL_ONLY_RE.test(trimmed) || containsRawJsonBlob(trimmed)) {
      continue;
    }
    if (hasForbiddenProviderLabel(trimmed, labels)) {
      continue;
    }

    const normalized = normalizeClientMessage(trimmed);
    if (!normalized || INTERNAL_ONLY_RE.test(normalized) || containsRawJsonBlob(normalized)) {
      continue;
    }
    if (hasForbiddenProviderLabel(normalized, labels) || isUnsafeAfterRedaction(normalized)) {
      continue;
    }

    return normalized;
  }

  return null;
}

const TRANSPORT_ERROR_RE =
  /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|UND_ERR_[A-Z_]+|ERR_(?:TLS|SSL)_[A-Z_]+|fetch failed|socket hang up|network error|connection (?:reset|refused|closed|timed out)|(?:connect|connection|read|headers|body|gateway|upstream|request) timeout|timed out|certificate (?:expired|invalid)|SSL handshake|TLS handshake)\b/i;
const BUSINESS_ERROR_RE =
  /(?:insufficient|balance|credit|quota|billing|payment|subscription|subscribed|plan|rate.?limit|too many requests|invalid.?request|invalid.?argument|invalid.?parameter|invalid.?api.?key|context.?length|not.?supported|not.?found|not.?allowed|permission|access.?denied|余额|额度|套餐|订阅|充值|限流|参数|鉴权|权限|不支持)/i;

/** Only response-backed business errors opt into richer diagnostics; transport errors keep defaults. */
export function isUpstreamTransportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    isLocalAbort?: boolean;
    statusCode?: number;
    message?: string;
    cause?: unknown;
    upstreamError?: { body?: string; rawBody?: string };
  };
  return (
    value.isLocalAbort === true ||
    value.statusCode === 408 ||
    value.statusCode === 504 ||
    value.statusCode === 524 ||
    TRANSPORT_ERROR_RE.test(
      `${value.message ?? ""} ${value.upstreamError?.rawBody ?? value.upstreamError?.body ?? ""}`.slice(
        0,
        8192
      )
    ) ||
    (value.cause !== error && isUpstreamTransportError(value.cause))
  );
}

export function deriveUpstreamBusinessErrorMessage(
  input: DeriveClientSafeUpstreamErrorMessageInput & { statusCode: number }
): string | null {
  if (
    input.statusCode < 400 ||
    input.statusCode > 599 ||
    isUpstreamTransportError({
      statusCode: input.statusCode,
      message: input.candidateMessage,
      upstreamError: { body: input.rawText },
    })
  )
    return null;
  const raw = input.rawText?.slice(0, 64 * 1024).trim() ?? "";
  if (/^(?:<!doctype|<html|<head|<body)/i.test(raw)) return null;
  let message: string | null = null;
  let code: string | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const object = parsed as Record<string, unknown>;
      const error = object.error ?? object;
      if (typeof error === "string") message = error;
      else if (error && typeof error === "object") {
        const detail = error as Record<string, unknown>;
        if (typeof detail.message === "string") message = detail.message;
        if (typeof detail.code === "string") code = detail.code;
        else if (typeof detail.type === "string") code = detail.type;
        // Relays sometimes nest the actual provider business error.
        const nested = detail.upstream_error;
        if (!message && nested && typeof nested === "object") {
          const nestedObject = nested as Record<string, unknown>;
          const nestedError = (nestedObject.error ?? nestedObject) as Record<string, unknown>;
          if (typeof nestedError.message === "string") message = nestedError.message;
        }
      }
    }
  } catch {
    /* Plain-text and SSE errors use the existing bounded extractor. */
  }
  message ??= deriveCandidateFromRawText(raw) ?? input.candidateMessage?.trim() ?? null;
  message = message?.replace(/^Upstream HTTP \d{3}:\s*/, "") ?? null;
  if (!message || INTERNAL_ONLY_RE.test(message) || containsRawJsonBlob(message)) return null;
  // Structured 4xx errors are useful by themselves. 5xx and plain text require a business signal.
  if (
    !BUSINESS_ERROR_RE.test(`${code ?? ""} ${message}`) &&
    !(raw.startsWith("{") && input.statusCode < 500)
  )
    return null;
  let safe = sanitizeErrorTextForDetail(message.slice(0, 4096))
    .replace(URL_RE, " ")
    .replace(DOMAIN_RE, " ")
    .replace(HOSTLIKE_RE, " ")
    .replace(IPV4_RE, " ")
    .replace(IPV6_RE, " ")
    .replace(REQUEST_ID_RE, " ")
    .replace(REQUEST_ID_TOKEN_RE, " ")
    .replace(KEY_VALUE_RE, " ")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/giu, "[REDACTED_KEY]")
    .replace(/\s+/g, " ")
    .trim();
  if (input.providerName)
    safe = safe.replace(new RegExp(escapeRegExp(input.providerName), "giu"), "upstream");
  if (!safe || containsRawJsonBlob(safe) || isUpstreamTransportError({ message: safe }))
    return null;
  if (code && /^[A-Za-z][A-Za-z0-9_.-]{1,79}$/.test(code) && !safe.includes(code))
    safe += ` (${code})`;
  return `Upstream HTTP ${input.statusCode}: ${safe.slice(0, 1000)}`;
}
