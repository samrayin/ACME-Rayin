import { describe, expect, it } from "vitest";
import {
  RESOURCE_ATTRIBUTE_RULES,
  SPAN_ATTRIBUTE_RULES,
} from "@/src/features/acme-enhancements/server/telemetry/telemetryAllowlist";
import { filterResourceSpans } from "@/src/features/acme-enhancements/server/telemetry/telemetryFilter";
import {
  HASH_OPTIONS,
  keptSpanAttributes,
  resourceSpans,
  s,
  span,
} from "./telemetryFixtures";

// EYEON telemetry ingest, CHG-2026-157 (Reviewer-2 N-C): THE single list of
// fields that keep app-chosen ASCII text when it fits their shape. That is the
// known residual of review C2, accepted for the synthetic-only dev pilot and a
// blocker before real data. LLD 5.1, ADR addendum A3 and A7, and CON-1 point
// here. The list is DERIVED: every allowlisted key is probed, so a new
// text-carrying field fails this test until it is added to the list (and the
// Gate D marker plan) on purpose.

/** A synthetic name and CPR-shaped number that fits every ASCII shape rule. */
const MARKER = "Jane_Doe_850912345";
/** Letters only, for shapes that refuse digits and underscores. */
const MARKER_LETTERS = "JANEDOE";
/** The same in Arabic, with Arabic-Indic digits: never fits an ASCII shape. */
const MARKER_AR = "جين_دو_٨٥٠٩١٢٣٤٥";

const EXTRA_KEY = "tenant.tier";

type Probe = { field: string; fits: string; run: (marker: string) => unknown };

function filtered(input: unknown, extras: string[] = []) {
  return filterResourceSpans(input, {
    ...HASH_OPTIONS,
    extraAllowlist: extras,
  });
}

function markerFor(rule: { kind: string; pattern?: RegExp }): string | null {
  if (rule.kind !== "string" && rule.kind !== "stringList") return null;
  if (rule.pattern?.test(MARKER)) return MARKER;
  if (rule.pattern?.test(MARKER_LETTERS)) return MARKER_LETTERS;
  return null;
}

function probes(): Probe[] {
  const out: Probe[] = [];
  for (const [key, rule] of SPAN_ATTRIBUTE_RULES) {
    const fits = markerFor(rule as { kind: string; pattern?: RegExp });
    if (fits === null) continue; // numbers and enums cannot carry free text
    out.push({
      field: key,
      fits,
      run: (m) =>
        filtered(
          resourceSpans([
            span({
              attributes: [
                rule.kind === "stringList"
                  ? {
                      key,
                      value: { arrayValue: { values: [{ stringValue: m }] } },
                    }
                  : s(key, m),
              ],
            }),
          ]),
        ),
    });
  }
  for (const [key, rule] of RESOURCE_ATTRIBUTE_RULES) {
    const fits = markerFor(rule as { kind: string; pattern?: RegExp });
    if (fits === null) continue;
    out.push({
      field: key,
      fits,
      run: (m) => filtered(resourceSpans([span()], [s(key, m)])),
    });
  }
  out.push(
    {
      field: "span name",
      fits: MARKER,
      run: (m) => filtered(resourceSpans([span({ name: m })])),
    },
    {
      field: "exception.type",
      fits: MARKER,
      run: (m) =>
        filtered(
          resourceSpans([
            span({
              events: [
                {
                  name: "exception",
                  timeUnixNano: "1789827031900000000",
                  attributes: [s("exception.type", m)],
                },
              ],
            }),
          ]),
        ),
    },
    {
      field: "usage key suffix (gen_ai.usage.<suffix>)",
      fits: MARKER.toLowerCase(),
      run: (m) =>
        filtered(
          resourceSpans([
            span({
              attributes: [
                ...keptSpanAttributes(),
                { key: `gen_ai.usage.${m}`, value: { intValue: "1" } },
              ],
            }),
          ]),
        ),
    },
    {
      field: "per-project extra value",
      fits: MARKER,
      run: (m) =>
        filtered(resourceSpans([span({ attributes: [s(EXTRA_KEY, m)] })]), [
          EXTRA_KEY,
        ]),
    },
    {
      field: "instrumentation scope (name)",
      fits: MARKER,
      run: (m) => filtered(resourceSpans([span()], undefined, { name: m })),
    },
  );
  return out;
}

const keptBy = (p: Probe, marker: string) =>
  JSON.stringify(p.run(marker)).includes(marker);

/** THE residual list (review C2, N-C). Keep LLD 5.1 and Gate D in step with it. */
const RESIDUAL_FIELDS = [
  "deployment.environment",
  "deployment.environment.name",
  "exception.type",
  "gen_ai.conversation.id",
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.finish_reasons",
  "gen_ai.response.model",
  "gen_ai.system",
  "gen_ai.tool.name",
  "http.request.method",
  "llm.model_name",
  "llm.response.model",
  "per-project extra value",
  "server.address",
  "service.name",
  "service.version",
  "session.id",
  "span name",
  "usage key suffix (gen_ai.usage.<suffix>)",
].sort();

describe("the C2 residual: exactly these fields keep a shape-fitting marker (Reviewer-2 N-C)", () => {
  it("the derived list equals RESIDUAL_FIELDS", () => {
    const kept = probes()
      .filter((p) => keptBy(p, p.fits))
      .map((p) => p.field)
      .sort();
    expect(kept).toEqual(RESIDUAL_FIELDS);
  });

  it("the app's instrumentation scope is not part of it (fixed by CHG-2026-156)", () => {
    const scope = probes().find((p) =>
      p.field.startsWith("instrumentation scope"),
    );
    expect(scope && keptBy(scope, scope.fits)).toBe(false);
  });

  it("an Arabic marker with Arabic-Indic digits is dropped from every one of these fields (CON-6)", () => {
    for (const p of probes()) {
      expect(keptBy(p, MARKER_AR), p.field).toBe(false);
    }
  });
});
