/**
 * ACME enhancement: CSV for the guardrail event history export (ADR-0013).
 *
 * Agent names, user ids and machine names are set by whoever calls the
 * guardrails service, so a cell is never allowed to start as a spreadsheet
 * formula: values starting with = + - @ tab or carriage return get a leading
 * apostrophe, which spreadsheets show as text.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | null | undefined): string {
  let text = value ?? "";
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

const COLUMNS = [
  ["event_time_utc", "time"],
  ["action", "action"],
  ["direction", "direction"],
  ["policy_triggered", "policy_triggered"],
  ["agent_id", "agent_id"],
  ["user_id", "user_id"],
  ["client_host", "client_host"],
  ["trace_id", "trace_id"],
  ["event_id", "event_id"],
  ["source", "source"],
] as const;

type ExportRow = Record<(typeof COLUMNS)[number][1], string | null>;

/** RFC 4180 CSV (CRLF line breaks), header first. */
export function guardrailEventsToCsv(rows: ExportRow[]): string {
  const header = COLUMNS.map(([name]) => name).join(",");
  const lines = rows.map((row) =>
    COLUMNS.map(([, key]) => csvCell(row[key])).join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

/**
 * Saves `csv` as a file. The byte-order mark makes spreadsheet apps read it
 * as UTF-8, so Arabic names and other non-Latin text display correctly.
 */
export function downloadCsvFile(csv: string, fileName: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
