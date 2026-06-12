const PROVIDER_OUTPUT_SAFETY_DISABLED_VALUES = new Set(["0", "false"]);
const PROVIDER_OUTPUT_SAFETY_REPLACEMENT = "[CCH_FILTERED_DANGEROUS_LOCAL_COMMAND]";
const STREAM_FILTER_OVERLAP_CHARS = 512;

const DANGEROUS_PROVIDER_OUTPUT_PATTERNS: RegExp[] = [
  /\b(?:sudo\s+)?rm\s+(?=[^\r\n]{0,100}(?:-[^\s]*r[^\s]*|--recursive)\b)(?=[^\r\n]{0,100}(?:-[^\s]*f[^\s]*|--force)\b)[^\r\n]{0,160}?\s(?:\/(?:\s|$|[.;,，。])|\/(?:bin|boot|dev|etc|lib|lib64|proc|root|sbin|sys|usr|var)(?:\/|\s|$|[.;,，。])|\/\*)/gi,
  /\b(?:Remove-Item|rm|del|erase)\s+(?=[^\r\n]{0,140}(?:-Recurse|-r)\b)(?=[^\r\n]{0,140}(?:-Force|-fo)\b)[^\r\n]{0,220}?(?:[a-z]:[\\/]+(?:windows|winnt|system32)(?:[\\/]|$|[.;,，。])|%windir%|%systemroot%|\$env:(?:windir|systemroot))/gi,
  /\b(?:sudo\s+)?mkfs(?:\.[a-z0-9]+)?\s+(?:-[^\s]+\s+){0,8}\/dev\/(?:sd[a-z]\d*|vd[a-z]\d*|hd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|mapper\/[^\s]+)/gi,
  /\bdd\s+(?=[^\r\n]{0,160}\bif=\/dev\/(?:zero|random|urandom)\b)(?=[^\r\n]{0,160}\bof=\/dev\/(?:sd[a-z]\d*|vd[a-z]\d*|hd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|mapper\/[^\s]+)\b)[^\r\n]*/gi,
  /\bdiskpart\b(?=[^\r\n]{0,240}\bclean\b)[^\r\n]*/gi,
  /\bformat(?:\.com)?\s+[a-z]:[^\r\n]*/gi,
  /\bbcdedit\s+\/delete\b[^\r\n]*/gi,
  /\bbootrec\s+\/(?:fixmbr|fixboot|rebuildbcd)\b[^\r\n]*/gi,
  /\bshutdown\s+(?:\/[rs]|-[rhp])\b[^\r\n]*/gi,
  /\b(?:sudo\s+)?systemctl\s+(?:reboot|poweroff)\b[^\r\n]*/gi,
  /(?:^|[\r\n;|&]|\b(?:run|execute|type|执行|运行|输入)\s+)(?:sudo\s+)?(?:\/sbin\/)?reboot(?:\s+(?:now|--force|-f))?(?=\s|$|[.;,，。])/giu,
  /\bRestart-Computer\b[^\r\n]*/gi,
  /\b(?:curl|wget)\b(?=[^\r\n]{0,420}\bhttps?:\/\/)(?=[^\r\n]{0,420}(?:\|\s*(?:sudo\s+)?(?:bash|sh|zsh|python3?|perl|ruby|node|pwsh|powershell|cmd)(?:\.exe)?\b|(?:&&|;)\s*(?:sudo\s+)?(?:bash|sh|zsh|python3?|perl|ruby|node|pwsh|powershell|cmd)(?:\.exe)?\b))[^\r\n]*/gi,
  /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b(?=[^\r\n]{0,420}\bhttps?:\/\/)(?=[^\r\n]{0,420}(?:\|\s*(?:iex|Invoke-Expression|powershell|pwsh|cmd)\b|(?:&&|;)\s*(?:powershell|pwsh|cmd)\b))[^\r\n]*/gi,
  /\b(?:sudo\s+)?chmod\s+-R\s+777\s+(?:\/(?:\s|$)|\/(?:bin|boot|dev|etc|lib|lib64|proc|root|sbin|sys|usr|var)(?:\/|\s|$)|\/\*)[^\r\n]*/gi,
  /\b(?:sudo\s+)?chown\s+-R\s+\S+\s+(?:\/(?:\s|$)|\/(?:bin|boot|dev|etc|lib|lib64|proc|root|sbin|sys|usr|var)(?:\/|\s|$)|\/\*)[^\r\n]*/gi,
];

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

export function filterProviderOutputSafetyText(text: string): string {
  let filtered = text;
  for (const pattern of DANGEROUS_PROVIDER_OUTPUT_PATTERNS) {
    filtered = filtered.replace(pattern, PROVIDER_OUTPUT_SAFETY_REPLACEMENT);
  }
  return filtered;
}

function sanitizeTextValue(container: Record<string, unknown>, key: string): boolean {
  const value = container[key];
  if (typeof value !== "string") return false;

  const filtered = filterProviderOutputSafetyText(value);
  if (filtered === value) return false;

  container[key] = filtered;
  return true;
}

function sanitizeProviderOutputJson(value: unknown): boolean {
  let changed = false;

  if (Array.isArray(value)) {
    for (const item of value) {
      changed = sanitizeProviderOutputJson(item) || changed;
    }
    return changed;
  }

  if (!isRecord(value)) return false;

  changed = sanitizeTextValue(value, "text") || changed;
  changed = sanitizeTextValue(value, "content") || changed;

  const type = value.type;
  if (
    type === "response.output_text.delta" ||
    type === "response.output_text.done" ||
    type === "content_block_delta"
  ) {
    changed = sanitizeTextValue(value, "delta") || changed;
  }

  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) {
      changed = sanitizeProviderOutputJson(child) || changed;
    }
  }

  return changed;
}

function filterProviderOutputSafetySseEvent(eventText: string): string {
  const { eventName, dataText } = parseSseEvent(eventText);
  if (!dataText) return filterProviderOutputSafetyText(eventText);
  if (dataText === "[DONE]") return eventText;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataText);
  } catch {
    return filterProviderOutputSafetyText(eventText);
  }

  const changed = sanitizeProviderOutputJson(parsed);
  return changed ? encodeSseEvent(eventName, parsed) : eventText;
}

function isDisabledEnvValue(value: string | undefined): boolean {
  return value !== undefined && PROVIDER_OUTPUT_SAFETY_DISABLED_VALUES.has(value.toLowerCase());
}

export function shouldFilterProviderOutputSafety(contentType: string | null | undefined): boolean {
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

export function createProviderOutputSafetyFilter(): TransformStream<Uint8Array, Uint8Array> {
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

        const filtered = filterProviderOutputSafetySseEvent(eventText);
        if (filtered) {
          controller.enqueue(encoder.encode(filtered));
        }

        boundary = findSseEventBoundary(buffer);
      }

      if (!buffer.includes("data:") && buffer.length > STREAM_FILTER_OVERLAP_CHARS * 2) {
        const emitLength = buffer.length - STREAM_FILTER_OVERLAP_CHARS;
        const emitText = buffer.slice(0, emitLength);
        buffer = buffer.slice(emitLength);
        controller.enqueue(encoder.encode(filterProviderOutputSafetyText(emitText)));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      const filtered = buffer.includes("data:")
        ? filterProviderOutputSafetySseEvent(buffer)
        : filterProviderOutputSafetyText(buffer);
      if (filtered) {
        controller.enqueue(encoder.encode(filtered));
      }
    },
  });
}
