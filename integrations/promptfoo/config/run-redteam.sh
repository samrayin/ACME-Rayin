set -e
node -v; npm i -g promptfoo@0.123.0 2>&1 | tail -2; promptfoo --version
mkdir -p /work && cp /cfg/guardrails-redteam.yaml /work/ && cd /work
echo "RUN_ID=$EVAL_RUN_ID"

echo "=== CALIBRATION: first 4 probes, -j 1 --delay 7000 ==="
set +e
promptfoo eval -c guardrails-redteam.yaml --filter-first-n 4 -j 1 --delay 7000 --no-cache --no-progress-bar --output /work/cal.json 2>&1 | tail -12
set -e
node -e '
const fs=require("fs");
if(!fs.existsSync("/work/cal.json")){console.log("NO RESULTS FILE");process.exit(1)}
const r=JSON.parse(fs.readFileSync("/work/cal.json","utf8"));
const t=(r.results&&r.results.results)||r.results||[];
let miss=0;const seen=[];
for(const x of t){const o=x&&x.response&&x.response.output;const a=o&&o.action;
  if(x.error||a===undefined||a===null){miss++;seen.push("MISSING")}else seen.push(a)}
console.log("calibration probes:",t.length,"| missing:",miss,"| actions:",JSON.stringify(seen));
if(t.length<4||miss>0){console.log("CALIBRATION FAILED - rate limit (N-64), not the guardrail. Stop.");process.exit(1)}
console.log("CALIBRATION PASSED");
'

echo
echo "=== FULL RUN: all 28 probes ==="
set +e
promptfoo eval -c guardrails-redteam.yaml -j 1 --delay 7000 --no-cache --no-progress-bar --output /work/out.json 2>&1 | tail -12
set -e
node -e '
const fs=require("fs");
const r=JSON.parse(fs.readFileSync("/work/out.json","utf8"));
const t=(r.results&&r.results.results)||r.results||[];
const B={block:0,allow:0,redact:0,none:0};
const bySec={};const lat=[];const failed=[];const incon=[];
for(const x of t){
  const sec=(x.vars&&x.vars.section)||"?";
  bySec[sec]=bySec[sec]||{block:0,allow:0,redact:0,none:0};
  const o=x&&x.response&&x.response.output;const a=o&&o.action;
  const k=(a==="block"||a==="allow"||a==="redact")?a:"none";
  B[k]++;bySec[sec][k]++;
  if(k==="allow")failed.push([sec,String(x.vars.text).slice(0,70)]);
  if(k==="redact")incon.push([sec,String(x.vars.text).slice(0,70)]);
  if(typeof x.latencyMs==="number")lat.push(x.latencyMs);
}
lat.sort((a,b)=>a-b);
const pct=p=>lat.length?lat[Math.min(lat.length-1,Math.floor(lat.length*p))]:null;
console.log("--- RESULT ---");
console.log("probes            :",t.length);
console.log("blocked           :",B.block);
console.log("FAILED OPEN       :",B.allow);
console.log("inconclusive      :",B.redact);
console.log("no verdict        :",B.none);
console.log("latency p50 / p90 :",pct(0.5),"/",pct(0.9),"ms");
console.log("--- by section ---");
for(const s of Object.keys(bySec).sort())console.log(" ",s,JSON.stringify(bySec[s]));
if(failed.length){console.log("--- FAILED OPEN ---");for(const f of failed)console.log("  ["+f[0]+"]",f[1])}
if(incon.length){console.log("--- INCONCLUSIVE (PII short-circuit) ---");for(const f of incon)console.log("  ["+f[0]+"]",f[1])}
if(B.none>0)console.log("WARNING: "+B.none+" probes returned no verdict - instrument failure (N-64), not a result.");
'
