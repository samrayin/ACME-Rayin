import { describe, expect, it } from "vitest";
import { decodeOtlpTraces } from "@/src/features/acme-enhancements/server/telemetry/telemetryDecode";
import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_DECODED_BYTES,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryFlags";
import { getTelemetryRuntime } from "@/src/features/acme-enhancements/server/telemetry/telemetryRuntime";

// EYEON telemetry ingest, CHG-2026-157 (Reviewer-2 N-D): the runtime's WIRING.
// The size and protobuf guarantees hold only because the runtime passes these
// exact values and this exact decoder. Unit tests of the functions alone stayed
// green when the runtime bypassed them (Reviewer-2 undo checks U3b and U5c).

describe("telemetryRuntime wiring (N-D)", () => {
  const { deps } = getTelemetryRuntime();

  it("uses the 5 MiB body limit and the 1 MiB decoded ceiling, not the engine's 512 MiB", () => {
    expect(deps.maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(deps.maxBodyBytes).toBe(5 * 1024 * 1024);
    expect(deps.maxDecodedBytes).toBe(DEFAULT_MAX_DECODED_BYTES);
    expect(deps.maxDecodedBytes).toBe(1024 * 1024);
  });

  it("decodes with the real protobuf-and-JSON decoder", () => {
    expect(deps.decode).toBe(decodeOtlpTraces);
  });
});
