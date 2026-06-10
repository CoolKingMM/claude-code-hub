import { parseSSEData } from "@/lib/utils/sse";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasCompletedSseEvent(responseText: string): boolean {
  try {
    for (const event of parseSSEData(responseText)) {
      if (typeof event.data === "string" && event.data.trim() === "[DONE]") {
        return true;
      }

      if (!isRecord(event.data)) {
        continue;
      }

      const response = isRecord(event.data.response) ? event.data.response : event.data;
      if (
        (event.event === "response.completed" || event.data.type === "response.completed") &&
        (response.status === "completed" || response.status === undefined) &&
        response.error == null
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

export function shouldTreatClientAbortedStreamAsCompleted(input: {
  responseText: string;
  upstreamStatusCode: number;
  streamEndedNormally: boolean;
  clientAborted: boolean;
}): boolean {
  return (
    !input.streamEndedNormally &&
    input.clientAborted &&
    input.upstreamStatusCode >= 200 &&
    input.upstreamStatusCode < 300 &&
    hasCompletedSseEvent(input.responseText)
  );
}
