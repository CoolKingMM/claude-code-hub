import {
  compileProviderOutputSafetyFilterRules,
  DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES,
  PROVIDER_OUTPUT_SAFETY_REPLACEMENT,
} from "@/lib/provider-output-safety-rules";

const PROVIDER_OUTPUT_SAFETY_DISABLED_VALUES = new Set(["0", "false"]);
const STREAM_FILTER_OVERLAP_CHARS = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findSseEventBoundary(text: string): { index: number; length: number } | null {
  const lf = text.indexOf("\n\n");
  const crlf = text.indexOf("\r\n\r\n");

  if (lf < 0 && crlf < 0) return null;
  if (lf < 0) return { index: crlf, length: 4 };
  if (crlf < 0) return { index: lf, length: 2 };
  return crlf < lf ? { index: crlf, length: 4 } : { index: lf, length: 2 };
}

function parseSseEvent(eventText: string): {
  eventName: string | null;
  dataText: string | null;
} {
  const dataLines: string[] = [];
  let eventName: string | null = null;

  for (const rawLine of eventText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      let value = line.slice(5);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }
      dataLines.push(value);
    }
  }

  return {
    eventName,
    dataText: dataLines.length > 0 ? dataLines.join("\n") : null,
  };
}

function encodeSseEvent(eventName: string | null, data: unknown): string {
  const lines: string[] = [];
  if (eventName) {
    lines.push(`event: ${eventName}`);
  }
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push("");
  lines.push("");
  return lines.join("\n");
}

function applyProviderOutputSafetyPatterns(text: string, patterns: readonly RegExp[]): string {
  let filtered = text;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    filtered = filtered.replace(pattern, PROVIDER_OUTPUT_SAFETY_REPLACEMENT);
  }
  return filtered;
}

export function filterProviderOutputSafetyText(
  text: string,
  rules: readonly string[] = DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES
): string {
  return applyProviderOutputSafetyPatterns(text, compileProviderOutputSafetyFilterRules(rules));
}

function sanitizeTextValue(
  container: Record<string, unknown>,
  key: string,
  patterns: readonly RegExp[]
): boolean {
  const value = container[key];
  if (typeof value !== "string") return false;

  const filtered = applyProviderOutputSafetyPatterns(value, patterns);
  if (filtered === value) return false;

  container[key] = filtered;
  return true;
}

function sanitizeProviderOutputJson(value: unknown, patterns: readonly RegExp[]): boolean {
  let changed = false;

  if (Array.isArray(value)) {
    for (const item of value) {
      changed = sanitizeProviderOutputJson(item, patterns) || changed;
    }
    return changed;
  }

  if (!isRecord(value)) return false;

  changed = sanitizeTextValue(value, "text", patterns) || changed;
  changed = sanitizeTextValue(value, "content", patterns) || changed;

  const type = value.type;
  if (
    type === "response.output_text.delta" ||
    type === "response.output_text.done" ||
    type === "content_block_delta"
  ) {
    changed = sanitizeTextValue(value, "delta", patterns) || changed;
  }

  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) {
      changed = sanitizeProviderOutputJson(child, patterns) || changed;
    }
  }

  return changed;
}

function filterProviderOutputSafetySseEvent(
  eventText: string,
  patterns: readonly RegExp[]
): string {
  const { eventName, dataText } = parseSseEvent(eventText);
  if (!dataText) return applyProviderOutputSafetyPatterns(eventText, patterns);
  if (dataText === "[DONE]") return eventText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataText);
  } catch {
    return applyProviderOutputSafetyPatterns(eventText, patterns);
  }

  const changed = sanitizeProviderOutputJson(parsed, patterns);
  return changed ? encodeSseEvent(eventName, parsed) : eventText;
}

function isDisabledEnvValue(value: string | undefined): boolean {
  return value !== undefined && PROVIDER_OUTPUT_SAFETY_DISABLED_VALUES.has(value.toLowerCase());
}

export function shouldFilterProviderOutputSafety(
  contentType: string | null | undefined,
  enabled = true
): boolean {
  if (!enabled) {
    return false;
  }

  if (isDisabledEnvValue(process.env.CCH_FILTER_DANGEROUS_PROVIDER_OUTPUT)) {
    return false;
  }

  if (!contentType) return true;

  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized.includes("text/event-stream") ||
    normalized.includes("application/json") ||
    normalized.includes("+json") ||
    normalized.includes("x-ndjson")
  );
}

export function createProviderOutputSafetyFilter(
  rules: readonly string[] = DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const patterns = compileProviderOutputSafetyFilterRules(rules);
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      let boundary = findSseEventBoundary(buffer);
      while (boundary) {
        const end = boundary.index + boundary.length;
        const eventText = buffer.slice(0, end);
        buffer = buffer.slice(end);

        const filtered = filterProviderOutputSafetySseEvent(eventText, patterns);
        if (filtered) {
          controller.enqueue(encoder.encode(filtered));
        }

        boundary = findSseEventBoundary(buffer);
      }

      if (!buffer.includes("data:") && buffer.length > STREAM_FILTER_OVERLAP_CHARS * 2) {
        const emitLength = buffer.length - STREAM_FILTER_OVERLAP_CHARS;
        const emitText = buffer.slice(0, emitLength);
        buffer = buffer.slice(emitLength);
        controller.enqueue(encoder.encode(applyProviderOutputSafetyPatterns(emitText, patterns)));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      const filtered = buffer.includes("data:")
        ? filterProviderOutputSafetySseEvent(buffer, patterns)
        : applyProviderOutputSafetyPatterns(buffer, patterns);
      if (filtered) {
        controller.enqueue(encoder.encode(filtered));
      }
    },
  });
}
