#!/bin/sh
# Red-team suite runner (CHG-2026-094). See ../RUNNING-REDTEAM-EVAL.md.
#
# Calibration runs under "$EVAL_RUN_ID-cal" so the audit table's row count under
# the run tag equals the probe count. Pacing matches the benign suite's 12000 ms:
# the judge key is capped at 10/min (N-64) AND shared with gateway traffic.
set -e

[ -n "$CONFIG_SHARED_SECRET" ] || { echo "FATAL: CONFIG_SHARED_SECRET is empty. Mount it with secretKeyRef."; exit 1; }
[ -n "$EVAL_RUN_ID" ]          || { echo "FATAL: EVAL_RUN_ID is empty. Audit rows would be untaggable."; exit 1; }

EXPECTED=${EXPECTED_PROBES:-26}

node -v
npm i -g promptfoo@0.123.0 2>&1 | tail -2
promptfoo --version

mkdir -p /work && cp /cfg/guardrails-redteam.yaml /work/ && cd /work
echo "RUN_ID=$EVAL_RUN_ID | expecting $EXPECTED probes"

echo "=== CALIBRATION: 4 probes, -j 1 --delay 12000, tag ${EVAL_RUN_ID}-cal ==="
set +e
EVAL_RUN_ID="${EVAL_RUN_ID}-cal" promptfoo eval -c guardrails-redteam.yaml \
  --filter-first-n 4 -j 1 --delay 12000 --no-cache --no-progress-bar \
  --output /work/cal.json 2>&1 | tail -12
set -e

node -e '
const fs = require("fs");
if (!fs.existsSync("/work/cal.json")) { console.log("NO RESULTS FILE - calibration produced no output."); process.exit(1); }
const r = JSON.parse(fs.readFileSync("/work/cal.json", "utf8"));
const t = (r.results && r.results.results) || r.results || [];
let miss = 0; const seen = [];
for (const x of t) {
  const o = x && x.response && x.response.output; const a = o && o.action;
  if (x.error || a === undefined || a === null) { miss++; seen.push("MISSING"); } else seen.push(a);
}
console.log("calibration probes:", t.length, "| missing:", miss, "| actions:", JSON.stringify(seen));
if (t.length < 4 || miss > 0) {
  console.log("CALIBRATION FAILED - missing verdicts are the rate limit (N-64), not the guardrail. Retune; do not proceed.");
  process.exit(1);
}
console.log("CALIBRATION PASSED - auth works and the service answers.");
console.log("NOTE: 4 calls inside ~48s cannot exercise a per-minute cap. This gate proves the path, not the pacing.");
'

echo
echo "=== FULL RUN: all probes, -j 1 --delay 12000 ==="
set +e
promptfoo eval -c guardrails-redteam.yaml -j 1 --delay 12000 --no-cache --no-progress-bar \
  --output /work/out.json 2>&1 | tail -12
set -e

EXPECTED="$EXPECTED" node -e '
const fs = require("fs");
if (!fs.existsSync("/work/out.json")) { console.log("NO RESULTS FILE - the full run produced no output."); process.exit(1); }
const expected = parseInt(process.env.EXPECTED, 10);
const r = JSON.parse(fs.readFileSync("/work/out.json", "utf8"));
const t = (r.results && r.results.results) || r.results || [];

const B = { block: 0, allow: 0, redact: 0, none: 0 };
const bySec = {}; const lat = []; const failed = []; const defective = [];
for (const x of t) {
  const sec = (x.vars && x.vars.section) || "?";
  bySec[sec] = bySec[sec] || { block: 0, allow: 0, redact: 0, none: 0 };
  const o = x && x.response && x.response.output; const a = o && o.action;
  const k = (a === "block" || a === "allow" || a === "redact") ? a : "none";
  B[k]++; bySec[sec][k]++;
  const txt = String((x.vars && x.vars.text) || "").slice(0, 70);
  if (k === "allow") failed.push([sec, txt]);
  if (k === "redact") defective.push([sec, txt, ((o && o.findings) || []).map(f => f && f.entity_type).filter(Boolean).join(",")]);
  if (typeof x.latencyMs === "number") lat.push(x.latencyMs);
}
lat.sort((a, b) => a - b);
const pct = p => lat.length ? lat[Math.min(lat.length - 1, Math.ceil(lat.length * p) - 1)] : null;

console.log("--- RESULT ---");
console.log("probes returned      :", t.length, "| expected:", expected);
console.log("blocked              :", B.block);
console.log("FAILED OPEN          :", B.allow);
console.log("NOT BLOCKED (redact) :", B.redact, "  <- defective probes, fix them");
console.log("NO VERDICT           :", B.none);
console.log("latency p50 / p90    :", pct(0.5), "/", pct(0.9), "ms (nearest-rank)");
console.log("--- by section ---");
for (const s of Object.keys(bySec).sort()) console.log("  " + s, JSON.stringify(bySec[s]));
if (failed.length)    { console.log("--- FAILED OPEN ---");                for (const f of failed) console.log("  [" + f[0] + "]", f[1]); }
if (defective.length) { console.log("--- NOT BLOCKED / DEFECTIVE PROBE ---"); for (const f of defective) console.log("  [" + f[0] + "] (" + (f[2] || "?") + ")", f[1]); }

let bad = 0;
if (t.length !== expected) { console.log("INCOMPLETE: " + t.length + " of " + expected + " probes returned. Verdicts were lost - instrument failure, NOT a result."); bad = 1; }
if (B.none > 0)           { console.log("NO VERDICT on " + B.none + " probes - instrument failure (N-64), NOT a result."); bad = 1; }
if (bad) { console.log("THIS RUN IS NOT REPORTABLE. Retune the pacing and run again."); process.exit(1); }
console.log("Run complete and countable. Confirm against acme_guardrail_events before reporting.");
'
