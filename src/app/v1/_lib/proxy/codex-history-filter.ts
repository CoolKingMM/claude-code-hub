/**
 * Codex History Filter - strip account-bound Responses history before forwarding.
 *
 * Background: Codex CLI is stateless and replays the whole conversation on every
 * `/v1/responses` request, including the server-issued item ids (`msg_...`, `rs_...`)
 * it received from earlier turns. Those ids belong to the upstream account/resource
 * that produced them. Relays that rotate across several OpenAI/Azure resources answer
 * with HTTP 400 "The requested item was created under a different ... OpenAI resource"
 * as soon as a turn lands on a different resource than the previous one.
 *
 * Action: drop opaque reasoning/reference/encrypted items, strip the optional server
 * item ids from items that carry their own content, keep `call_id` pairs, convert
 * historical `web_search_call` items into plain assistant text (they lose the
 * reasoning item they depended on), and force `store: false`.
 *
 * Opt-in per provider through `CCH_CODEX_HISTORY_FILTER_PROVIDERS` (comma separated
 * provider ids or names, case insensitive). Unset or empty means disabled.
 */

const PORTABLE_ITEM_TYPES = new Set<string>([
  "message",
  "agent_message",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "tool_search_call",
  "tool_search_output",
  "additional_tools",
]);

// Opaque items: their payload is either account-bound ciphertext (reasoning,
// compaction) or a pure server-side reference (item_reference). None of them can
// be replayed against another resource, and none carries text we can keep.
const DROPPED_ITEM_TYPES = new Set<string>(["reasoning", "item_reference", "compaction"]);

export type CodexHistoryFilterResult = {
  applied: boolean;
  droppedReasoningItems: number;
  droppedReferenceItems: number;
  droppedEncryptedItems: number;
  strippedItemIds: number;
  strippedEncryptedContentParts: number;
  convertedWebSearchItems: number;
  forcedStoreFalse: boolean;
};

export type CodexHistoryFilterProvider = {
  id?: number | null;
  name?: string | null;
};

const WEB_SEARCH_HISTORY_PREFIX =
  "[Historical web search activity; recorded data only, not a new tool call. " +
  "Search results are not reconstructed.]\n";

function createEmptyResult(): CodexHistoryFilterResult {
  return {
    applied: false,
    droppedReasoningItems: 0,
    droppedReferenceItems: 0,
    droppedEncryptedItems: 0,
    strippedItemIds: 0,
    strippedEncryptedContentParts: 0,
    convertedWebSearchItems: 0,
    forcedStoreFalse: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse the provider allowlist of `CCH_CODEX_HISTORY_FILTER_PROVIDERS`.
 *
 * Accepts provider ids (`163`) and provider names (`agentrouter`), separated by
 * commas. Values are trimmed and lower-cased; duplicates are removed.
 */
export function resolveCodexHistoryFilterProviders(
  raw: string | undefined = process.env.CCH_CODEX_HISTORY_FILTER_PROVIDERS
): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const token of raw.split(",")) {
    const normalized = token.trim().toLowerCase();
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

/**
 * Whether the history filter is enabled for the given provider.
 *
 * Matching is exact against the provider id or the provider name (case
 * insensitive). Disabled by default: an empty env value never matches.
 */
export function isCodexHistoryFilterEnabledFor(
  provider: CodexHistoryFilterProvider,
  raw?: string
): boolean {
  const allowlist = resolveCodexHistoryFilterProviders(raw);
  if (allowlist.length === 0) return false;

  const candidates: string[] = [];
  if (provider.id !== undefined && provider.id !== null) {
    candidates.push(String(provider.id));
  }
  if (typeof provider.name === "string" && provider.name.trim()) {
    candidates.push(provider.name.trim().toLowerCase());
  }
  return candidates.some((candidate) => allowlist.includes(candidate));
}

/**
 * Remove nested content parts typed `encrypted_content` (account-bound ciphertext
 * can also sit inside message/tool content arrays). Only explicitly typed parts
 * are removed; ordinary strings and opaque tool payloads stay untouched.
 */
function stripEncryptedContentParts(value: unknown, result: CodexHistoryFilterResult): unknown {
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    for (const entry of value) {
      if (isRecord(entry) && entry.type === "encrypted_content") {
        result.strippedEncryptedContentParts += 1;
        continue;
      }
      kept.push(stripEncryptedContentParts(entry, result));
    }
    return kept;
  }
  if (!isRecord(value)) return value;

  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    copy[key] = stripEncryptedContentParts(child, result);
  }
  return copy;
}

/**
 * Convert a historical native `web_search_call` item into assistant text.
 *
 * Reasoning items are dropped before forwarding, and a native search call without
 * its reasoning is rejected upstream ("was provided without its required reasoning
 * item"). The recorded action/query/status/sources stay visible as plain text.
 */
function toPortableWebSearchMessage(item: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = { ...item };
  delete record.type;
  delete record.id;
  delete record.internal_chat_message_metadata_passthrough;

  return {
    type: "message",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: WEB_SEARCH_HISTORY_PREFIX + JSON.stringify(record),
      },
    ],
  };
}

/**
 * Filter a Codex `/v1/responses` request body in place.
 *
 * Returns counters describing what changed; `applied` is false when the body is
 * not an array-based Responses request or when nothing needed to change.
 */
export function filterCodexHistoryForUpstream(
  body: Record<string, unknown> | null | undefined
): CodexHistoryFilterResult {
  const result = createEmptyResult();
  if (!isRecord(body)) return result;

  if (Array.isArray(body.input)) {
    const nextInput: unknown[] = [];

    for (const entry of body.input) {
      if (!isRecord(entry)) {
        nextInput.push(entry);
        continue;
      }

      const itemType = typeof entry.type === "string" ? entry.type : null;

      if (itemType && DROPPED_ITEM_TYPES.has(itemType)) {
        if (itemType === "reasoning") {
          result.droppedReasoningItems += 1;
        } else {
          result.droppedReferenceItems += 1;
        }
        continue;
      }

      // Top-level ciphertext outside a typed reasoning item cannot be replayed
      // across resources and carries no readable content.
      if (Object.hasOwn(entry, "encrypted_content")) {
        result.droppedEncryptedItems += 1;
        continue;
      }

      const cleaned = stripEncryptedContentParts(entry, result) as Record<string, unknown>;

      if (itemType === "web_search_call") {
        nextInput.push(toPortableWebSearchMessage(cleaned));
        result.convertedWebSearchItems += 1;
        continue;
      }

      const isRoleMessage =
        itemType === null && typeof cleaned.role === "string" && cleaned.content !== undefined;

      if ((itemType && PORTABLE_ITEM_TYPES.has(itemType)) || isRoleMessage) {
        if (Object.hasOwn(cleaned, "id")) {
          delete cleaned.id;
          result.strippedItemIds += 1;
        }
      }

      nextInput.push(cleaned);
    }

    body.input = nextInput;
  }

  if (body.store !== false) {
    body.store = false;
    result.forcedStoreFalse = true;
  }

  result.applied =
    result.droppedReasoningItems > 0 ||
    result.droppedReferenceItems > 0 ||
    result.droppedEncryptedItems > 0 ||
    result.strippedItemIds > 0 ||
    result.strippedEncryptedContentParts > 0 ||
    result.convertedWebSearchItems > 0 ||
    result.forcedStoreFalse;

  return result;
}
