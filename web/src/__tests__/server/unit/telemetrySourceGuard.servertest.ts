import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// EYEON telemetry ingest: source-level guards. These read the source text, not
// behaviour. They exist because the runtime file is the only place that runs SQL
// for the ingest, and a review of its SQL is only worth anything if a later edit
// cannot quietly add a statement, an unsafe call or a connection that the review
// did not see. A failure here means "re-review this file", not "the code is
// wrong".

const TELEMETRY_DIR = new URL(
  "../../../features/acme-enhancements/server/telemetry/",
  import.meta.url,
);
const ROUTE = new URL(
  "../../../pages/api/eyeon/telemetry/v1/traces.ts",
  import.meta.url,
);

/** Block and line comments removed, so a guard sees code, not prose about code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const read = (url: URL) =>
  stripComments(readFileSync(fileURLToPath(url), "utf8"));
const source = (name: string) => read(new URL(name, TELEMETRY_DIR));
const count = (haystack: string, needle: RegExp) =>
  (haystack.match(needle) ?? []).length;

/** The template-literal bodies that follow `$queryRaw<...>` . */
function queryTemplates(src: string): string[] {
  const out: string[] = [];
  const re = /\$queryRaw<[^>]*>`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

describe("telemetryRuntime.ts: the only file that runs SQL", () => {
  const src = source("telemetryRuntime.ts");

  it("has no $queryRawUnsafe", () => {
    expect(count(src, /\$queryRawUnsafe/g)).toBe(0);
  });

  it("has exactly one $executeRawUnsafe (the counters upsert)", () => {
    expect(count(src, /\$executeRawUnsafe/g)).toBe(1);
  });

  it("has no other raw or ORM write: no $executeRaw`...`, no $transaction, no model call", () => {
    expect(count(src, /\$executeRaw`/g)).toBe(0);
    expect(count(src, /\$transaction/g)).toBe(0);
    expect(
      count(
        src,
        /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g,
      ),
    ).toBe(0);
  });

  it("has exactly two parameterised reads, each a tagged template", () => {
    const templates = queryTemplates(src);
    expect(templates).toHaveLength(2);
    for (const t of templates) {
      expect(t.trim().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(t).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT)\b/i,
      );
    }
  });

  it("each read interpolates exactly one value, and it is the bound lookup key", () => {
    const [key, policy] = queryTemplates(src);
    expect(key.match(/\$\{[^}]+\}/g)).toEqual(["${tokenHash}"]);
    expect(policy.match(/\$\{[^}]+\}/g)).toEqual(["${projectId}"]);
  });

  it("the reads touch only the key table and the policy table, and only by their lookup column", () => {
    const [key, policy] = queryTemplates(src);
    expect(key).toMatch(/FROM "acme_litellm_keys"\s+WHERE "token_hash" = /);
    expect(policy).toMatch(
      /FROM "acme_telemetry_policy"\s+WHERE "project_id" = /,
    );
    for (const t of [key, policy]) {
      expect(count(t, /\bFROM\b/gi)).toBe(1);
      expect(t).not.toMatch(/\bJOIN\b/i);
      expect(t).not.toMatch(/\bSELECT\s+\*/i);
    }
  });

  it("never uses the console's shared database client, and never reads another connection setting", () => {
    expect(src).not.toMatch(/@langfuse\/shared\/src\/db/);
    expect(src).not.toMatch(/\bprisma\b\./);
    expect(src).not.toMatch(/process\.env/);
    expect(src).toContain("refusing to ");
    expect(count(src, /new PrismaClient\(/g)).toBe(2);
    expect(src).toMatch(/datasourceUrl: url/);
  });

  it("falls back to the most restrictive reading for an unexpected policy value", () => {
    // content mode: anything that is not redacted or full is metadata
    expect(src).toMatch(
      /r\.contentMode === "redacted" \|\| r\.contentMode === "full"\s*\? r\.contentMode\s*: "metadata"/,
    );
    // end-user id: anything that is not hash, drop or pass is DROP
    expect(src).toMatch(
      /r\.userIdMode === "hash" \|\|\s*r\.userIdMode === "drop" \|\|\s*r\.userIdMode === "pass"\s*\? r\.userIdMode\s*: "drop"/,
    );
  });

  it("logs error names and fixed strings only", () => {
    for (const m of src.matchAll(
      /logger\.(?:warn|error|info|debug)\(([^)]*)\)/g,
    )) {
      expect(m[1]).not.toMatch(
        /\bmessage\b|\.stack|JSON\.stringify|headers|body|key\b/,
      );
    }
  });
});

describe("the rest of the ingest never logs, never reads the environment, never opens a connection", () => {
  const files = readdirSync(fileURLToPath(TELEMETRY_DIR)).filter(
    (f) => f.endsWith(".ts") && f !== "telemetryRuntime.ts",
  );

  it("finds the pipeline modules", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "telemetryAllowlist.ts",
        "telemetryAuth.ts",
        "telemetryDecode.ts",
        "telemetryFilter.ts",
        "telemetryFlags.ts",
        "telemetryIngest.ts",
        "telemetryPolicy.ts",
        "telemetryRateLimit.ts",
        "telemetryStamp.ts",
        "telemetryStats.ts",
      ]),
    );
  });

  it.each(files)("%s has no logger, no console, no database client", (file) => {
    const src = source(file);
    expect(src).not.toMatch(/\blogger\b/);
    expect(src).not.toMatch(/\bconsole\./);
    expect(src).not.toMatch(
      /PrismaClient|@prisma\/client|\$queryRaw|\$executeRaw/,
    );
  });

  it("only the flags module reads process.env", () => {
    for (const file of files) {
      const src = source(file);
      if (file === "telemetryFlags.ts") continue;
      expect(src, file).not.toMatch(/process\.env/);
    }
  });

  it("the pipeline module has no import of the engine, the database or the network", () => {
    const src = source("telemetryIngest.ts");
    expect(src).not.toMatch(
      /processOtelIngestion|@langfuse\/shared|@prisma|node:http|fetch\(/,
    );
  });

  it("no module builds a RegExp at run time (every pattern is a literal)", () => {
    for (const file of [...files, "telemetryRuntime.ts"]) {
      expect(source(file), file).not.toMatch(/new RegExp\(|RegExp\(/);
    }
  });

  it("the filter never reads the app's scope; the stamp writes EYEON's (review C1)", () => {
    expect(source("telemetryFilter.ts")).not.toMatch(/\bss\.scope\b|\.scope\./);
    expect(source("telemetryStamp.ts")).toMatch(
      /scope: \{ name: EYEON_SCOPE_NAME \}/,
    );
  });
});

describe("the route", () => {
  const src = read(ROUTE);

  it("answers 404 before it builds anything when the flag is off", () => {
    const flag = src.indexOf("telemetryIngestEnabled()");
    const runtime = src.indexOf("getTelemetryRuntime()");
    expect(flag).toBeGreaterThan(-1);
    expect(runtime).toBeGreaterThan(flag);
    expect(src).toMatch(
      /if \(!telemetryIngestEnabled\(\)\) \{\s*return res\.status\(404\)/,
    );
  });

  it("turns Next's body parser off and logs the error name only", () => {
    expect(src).toMatch(/bodyParser: false/);
    expect(src).toMatch(
      /logger\.error\("telemetry ingest failed", \{\s*errorName: error instanceof Error \? error\.name : "Error",\s*\}\)/,
    );
  });

  it("does not touch the database or the engine itself", () => {
    expect(src).not.toMatch(
      /@prisma|@langfuse\/shared\/src\/db|processOtelIngestion|\$queryRaw/,
    );
  });
});
