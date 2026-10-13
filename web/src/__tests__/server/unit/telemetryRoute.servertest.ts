import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route, with the runtime and the pipeline replaced, so this proves only
// what the route itself does: answer 404 first when the flag is off, hand the
// request to the pipeline when it is on, relay the status, headers and body,
// close the connection after an oversize body, and log an error NAME only.

const mocks = vi.hoisted(() => ({
  getTelemetryRuntime: vi.fn(),
  adaptNextRequest: vi.fn(),
  handleTelemetryRequest: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock(
  "@/src/features/acme-enhancements/server/telemetry/telemetryRuntime",
  () => ({
    getTelemetryRuntime: mocks.getTelemetryRuntime,
    adaptNextRequest: mocks.adaptNextRequest,
  }),
);
vi.mock(
  "@/src/features/acme-enhancements/server/telemetry/telemetryIngest",
  () => ({ handleTelemetryRequest: mocks.handleTelemetryRequest }),
);
vi.mock("@langfuse/shared/src/server", () => ({
  logger: { error: mocks.loggerError },
}));

import handler, { config } from "@/src/pages/api/eyeon/telemetry/v1/traces";

const FLAG = "EYEON_TELEMETRY_INGEST_ENABLED";
let saved: string | undefined;

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
  };
  return res;
}

function fakeReq() {
  return { method: "POST", headers: {}, resume: vi.fn() };
}

beforeEach(() => {
  saved = process.env[FLAG];
  vi.clearAllMocks();
  mocks.getTelemetryRuntime.mockReturnValue({ deps: { marker: "deps" } });
  mocks.adaptNextRequest.mockImplementation((req) => ({ adapted: req }));
});

afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

describe("flag off (the default)", () => {
  it.each([undefined, "", "false", "TRUE", "1", "yes"])(
    "answers 404 and does nothing else when the flag is %j",
    async (value) => {
      if (value === undefined) delete process.env[FLAG];
      else process.env[FLAG] = value;
      const res = fakeRes();
      await handler(fakeReq() as any, res as any);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ message: "Not found" });
      expect(mocks.getTelemetryRuntime).not.toHaveBeenCalled();
      expect(mocks.adaptNextRequest).not.toHaveBeenCalled();
      expect(mocks.handleTelemetryRequest).not.toHaveBeenCalled();
    },
  );
});

describe("flag on", () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
  });

  it("hands the adapted request and the runtime's deps to the pipeline and relays the result", async () => {
    mocks.handleTelemetryRequest.mockResolvedValue({ status: 200, body: {} });
    const req = fakeReq();
    const res = fakeRes();
    await handler(req as any, res as any);
    expect(mocks.adaptNextRequest).toHaveBeenCalledWith(req);
    expect(mocks.handleTelemetryRequest).toHaveBeenCalledWith(
      { adapted: req },
      { marker: "deps" },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({});
    expect(req.resume).not.toHaveBeenCalled();
  });

  it("relays status, body and headers (429 with Retry-After)", async () => {
    mocks.handleTelemetryRequest.mockResolvedValue({
      status: 429,
      body: { message: "Rate limit exceeded" },
      headers: { "Retry-After": "42" },
    });
    const res = fakeRes();
    await handler(fakeReq() as any, res as any);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("42");
  });

  it("an oversize body drains the request and closes the connection", async () => {
    mocks.handleTelemetryRequest.mockResolvedValue({
      status: 413,
      body: { message: "Request body too large" },
      closeConnection: true,
    });
    const req = fakeReq();
    const res = fakeRes();
    await handler(req as any, res as any);
    expect(res.statusCode).toBe(413);
    expect(res.headers.Connection).toBe("close");
    expect(req.resume).toHaveBeenCalledTimes(1);
  });

  it("an unexpected error is 503 with a fixed body, and the log carries the error NAME only", async () => {
    // Assembled, so no connection-string-with-password literal sits in source.
    const secret = [
      "postgresql:",
      "//user:",
      "SECRET-PASSWORD",
      "@host/db",
    ].join("");
    mocks.handleTelemetryRequest.mockRejectedValue(
      Object.assign(new TypeError(`connect failed ${secret}`), {}),
    );
    const res = fakeRes();
    await handler(fakeReq() as any, res as any);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      message: "Temporarily unable to accept telemetry",
    });
    expect(mocks.loggerError).toHaveBeenCalledWith("telemetry ingest failed", {
      errorName: "TypeError",
    });
    expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(
      "SECRET",
    );
    expect(JSON.stringify(res)).not.toContain("SECRET");
  });

  it("a runtime that cannot be built is 503, not a crash", async () => {
    mocks.getTelemetryRuntime.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = fakeRes();
    await handler(fakeReq() as any, res as any);
    expect(res.statusCode).toBe(503);
  });
});

describe("config", () => {
  it("turns Next's body parser off: the ingest reads the body itself, after auth", () => {
    expect(config.api.bodyParser).toBe(false);
  });
});
