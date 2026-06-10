const CODEX_VERIFICATION_RECOMMENDATION_KEY = "openai_verification_recommendation";
const CODEX_VERIFICATION_RECOMMENDATION = "trusted_access_for_cyber";

function isDisabledEnvValue(value: string | undefined): boolean {
  return value === "false" || value === "0";
}

export function shouldHideCodexCyberNotice(providerType: string | null | undefined): boolean {
  return (
    !isDisabledEnvValue(process.env.CCH_HIDE_CODEX_CYBER_RISK_NOTICE) && providerType === "codex"
  );
}

function findSseEventBoundary(text: string): { index: number; length: number } | null {
  const lf = text.indexOf("\n\n");
  const crlf = text.indexOf("\r\n\r\n");

  if (lf < 0 && crlf < 0) return null;
  if (lf < 0) return { index: crlf, length: 4 };
  if (crlf < 0) return { index: lf, length: 2 };
  return crlf < lf ? { index: crlf, length: 4 } : { index: lf, length: 2 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeCodexVerificationMetadata(metadata: Record<string, unknown>): boolean {
  const value = metadata[CODEX_VERIFICATION_RECOMMENDATION_KEY];
  if (!Array.isArray(value)) {
    if (value !== CODEX_VERIFICATION_RECOMMENDATION) return false;

    delete metadata[CODEX_VERIFICATION_RECOMMENDATION_KEY];
    return true;
  }

  const filtered = value.filter((item) => item !== CODEX_VERIFICATION_RECOMMENDATION);
  if (filtered.length === value.length) return false;

  if (filtered.length > 0) {
    metadata[CODEX_VERIFICATION_RECOMMENDATION_KEY] = filtered;
  } else {
    delete metadata[CODEX_VERIFICATION_RECOMMENDATION_KEY];
  }

  return true;
}

function sanitizeCodexVerificationContainer(container: Record<string, unknown>): boolean {
  if (!isRecord(container.metadata)) return false;
  return sanitizeCodexVerificationMetadata(container.metadata);
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

function filterCodexCyberNoticeMetadataFromSseEvent(eventText: string): string {
  const { eventName, dataText } = parseSseEvent(eventText);
  if (!dataText || dataText === "[DONE]") return eventText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataText);
  } catch {
    return eventText;
  }

  if (!isRecord(parsed)) return eventText;

  let changed = sanitizeCodexVerificationContainer(parsed);
  if (isRecord(parsed.response)) {
    changed = sanitizeCodexVerificationContainer(parsed.response) || changed;
  }

  return changed ? encodeSseEvent(eventName, parsed) : eventText;
}

export function createCodexCyberNoticeFilter(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      let boundary = findSseEventBoundary(buffer);
      while (boundary) {
        const end = boundary.index + boundary.length;
        const eventText = buffer.slice(0, end);
        buffer = buffer.slice(end);

        const filtered = filterCodexCyberNoticeMetadataFromSseEvent(eventText);
        if (filtered) {
          controller.enqueue(encoder.encode(filtered));
        }

        boundary = findSseEventBoundary(buffer);
      }
    },
    flush(controller) {
      const filtered = filterCodexCyberNoticeMetadataFromSseEvent(buffer + decoder.decode());
      if (filtered) {
        controller.enqueue(encoder.encode(filtered));
      }
    },
  });
}
