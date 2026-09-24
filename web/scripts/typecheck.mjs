/**
 * ACME addition (CHG-2026-058): the web typecheck, with one narrow tolerance.
 *
 * ACME adds roles to the shared `Role` enum (e.g. SECURITY). A few
 * Enterprise-licensed files under src/ee/ pass a `Role` to code that accepts
 * only upstream's own role list, so tsc reports TS2322 there. Those files
 * must stay byte-identical to upstream (editing them would make ACME's change
 * Langfuse's property under the EE licence), and the code is dormant in CAIRO.
 *
 * This wrapper runs tsc as before and fails on every error EXCEPT exactly
 * that one: TS2322, in a file under src/ee/, where the target type is
 * upstream's role union. Anything else, anywhere, still fails the check.
 */
import { spawnSync } from "node:child_process";

const args = [
  "-p",
  "tsconfig.json",
  "--noEmit",
  "--skipLibCheck",
  "--incremental",
  "--tsBuildInfoFile",
  ".tsbuildinfo",
];
const result = spawnSync("tsc", args, {
  encoding: "utf8",
  shell: process.platform === "win32",
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

const UPSTREAM_ROLE_UNION = `'"ADMIN" | "MEMBER" | "NONE" | "OWNER" | "VIEWER"'`;
/** @param {string} line */
const isTolerated = (line) =>
  /^src[\\/]ee[\\/]/.test(line) &&
  line.includes("error TS2322:") &&
  line.endsWith(`is not assignable to type ${UPSTREAM_ROLE_UNION}.`);

const errorLines = output
  .split(/\r?\n/)
  .filter((line) => /error TS\d+:/.test(line));
const tolerated = errorLines.filter(isTolerated);
const failures = errorLines.filter((line) => !isTolerated(line));

if (tolerated.length > 0) {
  console.log(
    `Tolerated ${tolerated.length} known error(s) in unmodified Enterprise files (ACME roles vs upstream's role list, CHG-2026-058):`,
  );
  for (const line of tolerated) console.log(`  ${line}`);
}
if (failures.length > 0) {
  console.error(output);
  process.exit(1);
}
if (result.status !== 0 && errorLines.length === 0) {
  // tsc failed without a diagnostic line (config or crash): never pass that.
  console.error(output);
  process.exit(result.status ?? 1);
}
console.log("typecheck passed");
