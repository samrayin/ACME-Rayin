import { createHmac } from "crypto";
import { describe, it, expect } from "vitest";
import {
  filterResourceSpans,
  hashEndUserId,
  MalformedTelemetryError,
  countSpans,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryFilter";
import { ALLOWLIST_VERSION } from "@/src/features/acme-enhancements/server/telemetry/telemetryAllowlist";
import {
  ALL_MARKERS,
  AR,
  EN,
  HASH_OPTIONS,
  PARENT_ID,
  SALT,
  SPAN_ID,
  TRACE_ID,
  contentFamilyAttributes,
  d,
  i,
  keptSpanAttributes,
  resourceSpans,
  s,
  span,
} from "./telemetryFixtures";

// EYEON telemetry ingest, step D: the allowlist filter. A pure function, so no
// database, no queue, no network. These are the unit tests of LLD 5.1 as
// amended after SP-4a, and of the canary families in LLD 12 (CON-1, CON-6).

function run(
  spans: unknown[],
  options = HASH_OPTIONS,
  resource?: any,
  scope?: any,
) {
  return filterResourceSpans(resourceSpans(spans, resource, scope), options);
}

function onlySpan(result: ReturnType<typeof run>) {
  expect(result.resourceSpans).toHaveLength(1);
  const spans = result.resourceSpans[0].scopeSpans[0].spans;
  expect(spans).toHaveLength(1);
  return spans[0];
}

const keysOf = (attrs: { key: string }[]) => attrs.map((a) => a.key).sort();

describe("allowlist: every kept key", () => {
  it("keeps each allowlisted attribute, in its allowed shape", () => {
    const sp = onlySpan(run([span()]));
    expect(keysOf(sp.attributes)).toEqual(
      keysOf(keptSpanAttributes() as { key: string }[]),
    );
    const byKey = new Map(sp.attributes.map((a) => [a.key, a.value]));
    expect(byKey.get("gen_ai.request.model")).toEqual({
      stringValue: "gpt-4o-mini",
    });
    expect(byKey.get("gen_ai.usage.input_tokens")).toEqual({ intValue: "120" });
    expect(byKey.get("gen_ai.request.temperature")).toEqual({
      doubleValue: 0.2,
    });
    expect(byKey.get("gen_ai.response.finish_reasons")).toEqual({
      arrayValue: { values: [{ stringValue: "stop" }] },
    });
  });

  it("keeps ids, times, kind, status code and a conforming name", () => {
    const sp = onlySpan(run([span()]));
    expect(sp.traceId).toBe(TRACE_ID);
    expect(sp.spanId).toBe(SPAN_ID);
    expect(sp.parentSpanId).toBe(PARENT_ID);
    expect(sp.startTimeUnixNano).toBe("1789827031000000000");
    expect(sp.endTimeUnixNano).toBe("1789827032000000000");
    expect(sp.kind).toBe(3);
    expect(sp.status).toEqual({ code: 1 });
    expect(sp.name).toBe("chat");
  });

  it("keeps the four resource attributes", () => {
    const result = run([span()], HASH_OPTIONS, [
      s("service.name", "pilot-chat"),
      s("service.version", "1.4.0"),
      s("deployment.environment", "dev"),
      s("deployment.environment.name", "dev"),
      s("host.name", "should-not-pass"),
      s("process.command_args", EN.arbitrary),
    ]);
    const rs = result.resourceSpans[0];
    expect(keysOf(rs.resource.attributes)).toEqual([
      "deployment.environment",
      "deployment.environment.name",
      "service.name",
      "service.version",
    ]);
  });
});

describe("the app's instrumentation scope is never kept (CHG-2026-156, review C1)", () => {
  it.each([
    "langfuse-sdk",
    "langfuse-sdk-python",
    "livekit-agents",
    "pilot.instrumentation",
  ])(
    "scope %j: no name, no version, no attributes leave the filter",
    (name) => {
      const result = run([span()], HASH_OPTIONS, undefined, {
        name,
        version: "3.0.0",
        attributes: [s("scope.note", EN.scopeAttr)],
      });
      const ss = result.resourceSpans[0].scopeSpans[0];
      expect(Object.keys(ss)).toEqual(["spans"]);
      const json = JSON.stringify(result);
      expect(json).not.toContain(name);
      expect(json).not.toContain("3.0.0");
      expect(json).not.toContain(EN.scopeAttr);
    },
  );
});

describe("observation types an app may not assert (CHG-2026-156, review C1)", () => {
  const kindOf = (value: string) =>
    run([span({ attributes: [s("openinference.span.kind", value)] })]);

  it.each(["GUARDRAIL", "EVALUATOR"])(
    "openinference.span.kind %s is dropped and counted as reserved; the span is kept",
    (value) => {
      const result = kindOf(value);
      const sp = onlySpan(result);
      expect(sp.attributes.map((a) => a.key)).not.toContain(
        "openinference.span.kind",
      );
      expect(result.counts.drops.reserved).toBe(1);
      expect(JSON.stringify(sp)).not.toContain(value);
    },
  );

  it("LLM is still kept", () => {
    const sp = onlySpan(kindOf("LLM"));
    expect(sp.attributes).toContainEqual({
      key: "openinference.span.kind",
      value: { stringValue: "LLM" },
    });
  });
});

describe("allowlist: every always-dropped family", () => {
  it("drops each content, URL, header, exception and reserved key", () => {
    const hostile = contentFamilyAttributes(EN);
    const result = run([span({ attributes: hostile })]);
    const sp = onlySpan(result);
    expect(sp.attributes).toEqual([]);
    // The one attribute kept is the resource's own `service.name`.
    expect(result.counts.attrsKept).toBe(1);
    expect(result.counts.attrsDropped).toBe(hostile.length);
    // Reasons are named, by count only.
    expect(result.counts.drops.content).toBeGreaterThan(0);
    expect(result.counts.drops.reserved).toBeGreaterThan(0);
    expect(result.counts.drops.notAllowlisted).toBeGreaterThan(0);
  });

  it("reconciles: attributes in = kept + dropped, for a mixed span", () => {
    const attrs = [...keptSpanAttributes(), ...contentFamilyAttributes(EN)];
    const { counts } = run([span({ attributes: attrs })]);
    // Span attributes plus the resource's one `service.name`.
    expect(counts.attrsIn).toBe(attrs.length + 1);
    expect(counts.attrsKept + counts.attrsDropped).toBe(counts.attrsIn);
  });

  it("drops cost whoever sends it (DEC-8)", () => {
    const sp = onlySpan(
      run([
        span({
          attributes: [
            ...keptSpanAttributes(),
            d("gen_ai.usage.cost", 0.0123),
            d("llm.cost.total", 0.0123),
            s("langfuse.observation.cost_details", '{"total":0.0123}'),
          ],
        }),
      ]),
    );
    const keys = sp.attributes.map((a) => a.key);
    expect(keys).not.toContain("gen_ai.usage.cost");
    expect(keys).not.toContain("llm.cost.total");
    expect(keys).not.toContain("langfuse.observation.cost_details");
  });

  it("counts the three cost keys as cost", () => {
    const { counts } = run([
      span({
        attributes: [
          d("gen_ai.usage.cost", 1),
          d("llm.cost.total", 1),
          s("langfuse.observation.cost_details", "{}"),
        ],
      }),
    ]);
    expect(counts.drops.cost).toBe(3);
  });
});

describe("canary fixtures (CON-1, CON-6): no marker survives the filter", () => {
  function hostileSpan() {
    return span({
      name: EN.spanName, // spaces, comma and "!": not a conforming name
      attributes: [
        ...keptSpanAttributes(),
        ...contentFamilyAttributes(EN),
        ...contentFamilyAttributes(AR),
        s("user.id", EN.userId),
        s("langfuse.user.id", AR.userId),
        s("gen_ai.request.model", "gpt-4o-mini"), // duplicate key
      ],
      status: { code: 2, message: `${EN.statusMessage} ${AR.statusMessage}` },
      traceState: `vendor=${EN.traceState}`,
      links: [
        {
          traceId: TRACE_ID,
          spanId: SPAN_ID,
          attributes: [s("link.note", EN.linkAttr)],
        },
      ],
      events: [
        {
          name: "gen_ai.user.message",
          timeUnixNano: "1789827031500000000",
          attributes: [s("content", EN.prompt), s("body", AR.prompt)],
        },
        {
          name: "gen_ai.assistant.message",
          attributes: [s("content", EN.completion)],
        },
        {
          name: "gen_ai.choice",
          attributes: [s("message", AR.completion)],
        },
        {
          name: "gen_ai.content.prompt",
          attributes: [s("gen_ai.prompt", EN.prompt)],
        },
        {
          name: EN.eventBody,
          attributes: [s("x", AR.arbitrary)],
        },
        {
          name: "exception",
          timeUnixNano: "1789827031900000000",
          attributes: [
            s("exception.type", "ValueError"),
            s(
              "exception.message",
              `${EN.exceptionMessage} ${AR.exceptionMessage}`,
            ),
            s("exception.stacktrace", EN.exceptionStack),
          ],
        },
      ],
    });
  }

  function hostileResource() {
    return [
      s("service.name", "pilot-chat"),
      s("custom.resource", EN.resourceAttr),
      s("process.command_line", AR.arbitrary),
    ];
  }

  it("no English or Arabic marker appears anywhere in the filtered output", () => {
    const result = run([hostileSpan()], HASH_OPTIONS, hostileResource(), {
      name: AR.spanName,
      version: "1.0.0",
      attributes: [s("scope.note", EN.scopeAttr)],
    });
    const json = JSON.stringify(result);
    for (const marker of ALL_MARKERS) {
      expect(json, `marker leaked: ${marker}`).not.toContain(marker);
    }
    // And the useful metadata did survive.
    const sp = onlySpan(result);
    expect(sp.attributes.map((a) => a.key)).toContain("gen_ai.request.model");
    expect(sp.name).toBe("span");
    expect(sp.status).toEqual({ code: 2 });
  });

  it("reduces an exception event to its type; drops every other event and all links", () => {
    const result = run([hostileSpan()]);
    const sp = onlySpan(result);
    expect(sp.events).toEqual([
      {
        name: "exception",
        timeUnixNano: "1789827031900000000",
        attributes: [
          { key: "exception.type", value: { stringValue: "ValueError" } },
        ],
      },
    ]);
    expect(result.counts.eventsDropped).toBe(5);
    expect(result.counts.linksDropped).toBe(1);
    expect("links" in sp).toBe(false);
  });

  it("drops the status message and the trace state", () => {
    const sp = onlySpan(run([hostileSpan()]));
    expect(JSON.stringify(sp)).not.toContain("message");
    expect(JSON.stringify(sp)).not.toContain("traceState");
    expect(JSON.stringify(sp)).not.toContain("vendor=");
  });

  it("Arabic text on an allowlisted key is dropped like English prose", () => {
    const sp = onlySpan(
      run(
        [
          span({
            attributes: [
              s("gen_ai.request.model", AR.prompt),
              s("session.id", AR.arbitrary),
              s("gen_ai.tool.name", AR.toolArgs),
              s("gen_ai.operation.name", "chat"),
            ],
          }),
        ],
        HASH_OPTIONS,
        [s("service.name", AR.arbitrary)],
      ),
    );
    expect(sp.attributes.map((a) => a.key)).toEqual(["gen_ai.operation.name"]);
  });

  // RESIDUAL, stated plainly and asserted so it cannot drift unnoticed. LLD 5.1
  // normalises a span name by SHAPE (`^[A-Za-z0-9_.:/ -]{1,64}$`), not by
  // content. A marker that itself fits the shape is therefore kept as the name.
  // Non-conforming names (Arabic, punctuation, over 64 characters) are replaced.
  // The same is true of every listed string key: it is an app-asserted label.
  it("RESIDUAL: a name that fits the shape is kept (an app-asserted label)", () => {
    const fits = "GD1-EN-NAME-FITS-THE-SHAPE";
    const sp = onlySpan(run([span({ name: fits })]));
    expect(sp.name).toBe(fits);
    const longName = "x".repeat(65);
    expect(onlySpan(run([span({ name: longName })])).name).toBe("span");
    expect(onlySpan(run([span({ name: AR.spanName })])).name).toBe("span");
    expect(onlySpan(run([span({ name: "" })])).name).toBe("span");
  });
});

describe("ids and times", () => {
  it("a free-text trace id drops the whole span: the engine would store it verbatim", () => {
    const result = run([span({ traceId: EN.arbitrary })]);
    expect(result.resourceSpans).toEqual([]);
    expect(result.counts.spansDropped).toBe(1);
    expect(JSON.stringify(result)).not.toContain(EN.arbitrary);
  });

  it("a free-text span id drops the span", () => {
    const result = run([span({ spanId: AR.arbitrary })]);
    expect(result.resourceSpans).toEqual([]);
    expect(result.counts.spansDropped).toBe(1);
  });

  it("converts protobuf-style byte ids to lower-case hex", () => {
    const trace = Uint8Array.from(Buffer.from(TRACE_ID, "hex"));
    const id = Uint8Array.from(Buffer.from(SPAN_ID, "hex"));
    const sp = onlySpan(
      run([
        span({ traceId: trace, spanId: id, parentSpanId: new Uint8Array(0) }),
      ]),
    );
    expect(sp.traceId).toBe(TRACE_ID);
    expect(sp.spanId).toBe(SPAN_ID);
    expect(sp.parentSpanId).toBeUndefined();
  });

  it("accepts the JSON-serialised Buffer form and int arrays", () => {
    const asJson = (hex: string) => ({
      type: "Buffer",
      data: [...Buffer.from(hex, "hex")],
    });
    const a = onlySpan(
      run([
        span({
          traceId: asJson(TRACE_ID),
          spanId: [...Buffer.from(SPAN_ID, "hex")],
        }),
      ]),
    );
    expect(a.traceId).toBe(TRACE_ID);
    expect(a.spanId).toBe(SPAN_ID);
  });

  it("upper-case hex is lower-cased; the wrong length or all zeros is refused", () => {
    expect(
      onlySpan(run([span({ traceId: TRACE_ID.toUpperCase() })])).traceId,
    ).toBe(TRACE_ID);
    expect(run([span({ traceId: "ab" })]).counts.spansDropped).toBe(1);
    expect(run([span({ traceId: "0".repeat(32) })]).counts.spansDropped).toBe(
      1,
    );
    expect(run([span({ spanId: "0".repeat(16) })]).counts.spansDropped).toBe(1);
  });

  it("an unusable parent becomes a root span, not a lost span", () => {
    const sp = onlySpan(run([span({ parentSpanId: EN.arbitrary })]));
    expect(sp.parentSpanId).toBeUndefined();
  });

  it("a missing or non-numeric start time drops the span", () => {
    expect(
      run([span({ startTimeUnixNano: undefined })]).counts.spansDropped,
    ).toBe(1);
    expect(
      run([span({ startTimeUnixNano: EN.arbitrary })]).counts.spansDropped,
    ).toBe(1);
  });

  it("an unusable end time is omitted, the span kept", () => {
    const sp = onlySpan(run([span({ endTimeUnixNano: "not-a-time" })]));
    expect(sp.endTimeUnixNano).toBeUndefined();
  });
});

describe("usage: numeric values only, bounded keys", () => {
  const filtered = (attrs: unknown[]) =>
    onlySpan(run([span({ attributes: attrs })])).attributes.map((a) => a.key);

  it("drops a non-numeric usage value", () => {
    expect(
      filtered([
        s("gen_ai.usage.input_tokens", "120"),
        s("gen_ai.usage.output_tokens", EN.arbitrary),
        i("gen_ai.usage.total_tokens", 5),
      ]),
    ).toEqual(["gen_ai.usage.total_tokens"]);
  });

  it("drops a negative or absurd usage value", () => {
    expect(
      filtered([
        i("gen_ai.usage.input_tokens", -1),
        i("gen_ai.usage.output_tokens", "99999999999999999"),
      ]),
    ).toEqual([]);
  });

  it("drops a usage key whose suffix is not a short snake_case token", () => {
    expect(
      filtered([
        i(`gen_ai.usage.${EN.arbitrary}`, 1),
        i("gen_ai.usage.Has-Upper", 1),
        i(`llm.token_count.${"a".repeat(60)}`, 1),
        i("gen_ai.usage.", 1),
      ]),
    ).toEqual([]);
  });

  it("caps the number of usage keys kept per span", () => {
    const many = Array.from({ length: 30 }, (_, n) =>
      i(`gen_ai.usage.counter_${n}`, n),
    );
    expect(filtered(many)).toHaveLength(16);
  });
});

describe("end-user id (DEC-2)", () => {
  const withUser = (value: string, key = "user.id") =>
    span({ attributes: [...keptSpanAttributes(), s(key, value)] });

  it("hash mode: the span carries HMAC-SHA256(salt, id), first 16 hex; the raw id is gone", () => {
    const result = run([withUser("synthetic-user-123")]);
    const sp = onlySpan(result);
    const expected = createHmac("sha256", SALT)
      .update("synthetic-user-123")
      .digest("hex")
      .slice(0, 16);
    expect(sp.userHash).toBe(expected);
    expect(sp.userHash).toMatch(/^[0-9a-f]{16}$/);
    expect(sp.attributes.map((a) => a.key)).not.toContain("user.id");
    expect(JSON.stringify(sp.attributes)).not.toContain("synthetic-user-123");
  });

  it("langfuse.user.id is consumed the same way", () => {
    const sp = onlySpan(
      run([withUser("synthetic-user-123", "langfuse.user.id")]),
    );
    expect(sp.userHash).toBe(hashEndUserId(SALT, "synthetic-user-123"));
    expect(sp.attributes.map((a) => a.key)).not.toContain("langfuse.user.id");
  });

  it("a different project's salt gives a different hash", () => {
    const other = onlySpan(
      run([withUser("synthetic-user-123")], {
        ...HASH_OPTIONS,
        userHashSalt: "another-project-salt",
      }),
    );
    expect(other.userHash).not.toBe(hashEndUserId(SALT, "synthetic-user-123"));
  });

  it("drop mode: no hash and no raw id", () => {
    const sp = onlySpan(
      run([withUser("synthetic-user-123")], {
        ...HASH_OPTIONS,
        userIdMode: "drop",
      }),
    );
    expect(sp.userHash).toBeUndefined();
    expect(JSON.stringify(sp)).not.toContain("synthetic-user-123");
  });

  it("pass mode (owner opt-in): a conforming id is passed, a non-conforming one is not", () => {
    const opts = { ...HASH_OPTIONS, userIdMode: "pass" as const };
    const ok = onlySpan(run([withUser("synthetic-user-123")], opts));
    expect(ok.attributes).toContainEqual({
      key: "user.id",
      value: { stringValue: "synthetic-user-123" },
    });
    const bad = onlySpan(run([withUser(AR.userId)], opts));
    expect(JSON.stringify(bad)).not.toContain(AR.userId);
  });

  it("an Arabic or marker id never appears raw in hash mode", () => {
    const sp = onlySpan(run([withUser(AR.userId)]));
    expect(JSON.stringify(sp)).not.toContain(AR.userId);
    expect(sp.userHash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("per-project extras", () => {
  const opts = (extra: string[]) => ({
    ...HASH_OPTIONS,
    extraAllowlist: extra,
  });

  it("keeps a conforming extra with a bounded value", () => {
    const sp = onlySpan(
      run(
        [
          span({
            attributes: [s("tenant.tier", "gold"), s("tenant.region", "bh-1")],
          }),
        ],
        opts(["tenant.tier"]),
      ),
    );
    expect(sp.attributes).toEqual([
      { key: "tenant.tier", value: { stringValue: "gold" } },
    ]);
  });

  it("drops an extra's value that is Arabic or too long", () => {
    const sp = onlySpan(
      run(
        [span({ attributes: [s("tenant.tier", AR.arbitrary)] })],
        opts(["tenant.tier"]),
      ),
    );
    expect(sp.attributes).toEqual([]);
  });

  it("refuses an extra that is reserved, content-like or already governed", () => {
    const refused = [
      "langfuse.foo",
      "eyeon.foo",
      "user.email",
      "prompt.text",
      "input.value",
      "gen_ai.usage.cost",
      "service.name",
      "Upper.Case",
      "gen_ai.usage.input_tokens",
    ];
    const attrs = refused.map((k) => s(k, "x"));
    const sp = onlySpan(run([span({ attributes: attrs })], opts(refused)));
    expect(sp.attributes).toEqual([]);
  });
});

describe("malformed input", () => {
  it("rejects a body that is not an array of resource spans", () => {
    for (const bad of [null, {}, "x", 7]) {
      expect(() => filterResourceSpans(bad, HASH_OPTIONS)).toThrow(
        MalformedTelemetryError,
      );
    }
  });

  it("rejects attributes written as an object (a hand-rolled exporter)", () => {
    expect(() =>
      run([span({ attributes: { "gen_ai.system": "openai" } })]),
    ).toThrow(MalformedTelemetryError);
  });

  it("an empty export is valid and yields nothing", () => {
    const result = filterResourceSpans([], HASH_OPTIONS);
    expect(result.resourceSpans).toEqual([]);
    expect(result.counts.spansIn).toBe(0);
  });

  it("counts spans without allocating a copy", () => {
    expect(countSpans(resourceSpans([span(), span(), span()]))).toBe(3);
    expect(countSpans("nope")).toBe(0);
  });

  it("the allowlist is versioned", () => {
    expect(ALLOWLIST_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("status and kind", () => {
  it("keeps the status code, never the message", () => {
    const sp = onlySpan(
      run([span({ status: { code: 2, message: EN.statusMessage } })]),
    );
    expect(sp.status).toEqual({ code: 2 });
  });

  it("accepts enum names", () => {
    const sp = onlySpan(
      run([
        span({
          status: { code: "STATUS_CODE_ERROR" },
          kind: "SPAN_KIND_CLIENT",
        }),
      ]),
    );
    expect(sp.status).toEqual({ code: 2 });
    expect(sp.kind).toBe(3);
  });

  it("an unknown status or kind becomes the neutral value", () => {
    const sp = onlySpan(
      run([span({ status: { code: EN.arbitrary }, kind: AR.arbitrary })]),
    );
    expect(sp.status).toEqual({ code: 0 });
    expect(sp.kind).toBe(0);
  });
});
