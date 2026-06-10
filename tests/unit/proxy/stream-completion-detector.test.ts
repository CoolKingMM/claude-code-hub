import { describe, expect, test } from "vitest";
import {
  hasCompletedSseEvent,
  shouldTreatClientAbortedStreamAsCompleted,
} from "@/app/v1/_lib/proxy/stream-completion-detector";

describe("stream completion detector", () => {
  test("detects OpenAI-style [DONE] completion markers", () => {
    expect(hasCompletedSseEvent('data: {"delta":"ok"}\n\ndata: [DONE]\n\n')).toBe(true);
  });

  test("detects Responses API response.completed events", () => {
    const text = [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"ok"}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"status":"completed","error":null}}',
      "",
    ].join("\n");

    expect(hasCompletedSseEvent(text)).toBe(true);
  });

  test("does not treat partial content as completion without a completion marker", () => {
    expect(hasCompletedSseEvent('data: {"delta":"partial"}\n\n')).toBe(false);
  });

  test("treats late client abort after a completion marker as completed for 2xx upstreams only", () => {
    const responseText = 'data: {"delta":"ok"}\n\ndata: [DONE]\n\n';

    expect(
      shouldTreatClientAbortedStreamAsCompleted({
        responseText,
        upstreamStatusCode: 200,
        streamEndedNormally: false,
        clientAborted: true,
      })
    ).toBe(true);

    expect(
      shouldTreatClientAbortedStreamAsCompleted({
        responseText,
        upstreamStatusCode: 500,
        streamEndedNormally: false,
        clientAborted: true,
      })
    ).toBe(false);
  });

  test("does not override normal completion or non-client aborts", () => {
    const responseText = "data: [DONE]\n\n";

    expect(
      shouldTreatClientAbortedStreamAsCompleted({
        responseText,
        upstreamStatusCode: 200,
        streamEndedNormally: true,
        clientAborted: true,
      })
    ).toBe(false);

    expect(
      shouldTreatClientAbortedStreamAsCompleted({
        responseText,
        upstreamStatusCode: 200,
        streamEndedNormally: false,
        clientAborted: false,
      })
    ).toBe(false);
  });
});
