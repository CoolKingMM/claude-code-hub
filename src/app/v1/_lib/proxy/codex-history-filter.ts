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
 * Opt-in through 系统设置 → 特殊处理 → Codex 历史过滤: a switch plus a provider
 * allowlist (provider ids). The switch is stored in `system_settings` and the settings
 * cache is invalidated on save, so toggling it takes effect without a restart.
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

export type CodexHistoryFilterSetting = {
  enabled?: boolean | null;
  providerIds?: readonly number[] | null;
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
 * Whether the history filter is enabled for the given provider.
 *
 * Requires the global switch plus an explicit provider allowlist match; an empty
 * list never matches (same semantics as the fake streaming provider list).
 */
export function isCodexHistoryFilterEnabledFor(
  provider: CodexHistoryFilterProvider,
  setting: CodexHistoryFilterSetting
): boolean {
  if (setting.enabled !== true) return false;

  const providerIds = setting.providerIds ?? [];
  if (providerIds.length === 0) return false;

  const providerId = provider.id;
  if (typeof providerId !== "number" || !Number.isSafeInteger(providerId)) return false;
  return providerIds.includes(providerId);
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
