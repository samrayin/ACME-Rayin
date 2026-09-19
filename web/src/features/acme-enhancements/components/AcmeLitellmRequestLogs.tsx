/**
 * ACME addition (ADR-0003 §4, CHG-2026-008): the "Requests" tab of the LLM
 * Gateway page. CAIRO's append-only mirror of gateway requests (metadata
 * only, never prompt text), and above it the answer to "is this complete?":
 * the last reconciliation, its gap count, and whether that answer is stale.
 */
import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { api } from "@/src/utils/api";

function when(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function count(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : n.toLocaleString();
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "ok" | "warning" | "error";
  title: string;
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "border-dark-red/40 bg-light-red text-dark-red"
      : tone === "warning"
        ? "border-dark-yellow/40 bg-light-yellow text-dark-yellow"
        : "border-border bg-muted text-foreground";
  return (
    <div
      role={tone === "ok" ? "status" : "alert"}
      className={`rounded-md border px-4 py-3 text-sm ${toneClass}`}
    >
      <p className="font-bold">{title}</p>
      <div className="mt-1 text-xs">{children}</div>
    </div>
  );
}

function ReconcileStatus({ projectId }: { projectId: string }) {
  const status = api.acmeLitellm.reconcileStatus.useQuery(
    { projectId },
    { refetchInterval: 60_000 },
  );
  if (status.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }
  if (status.error) {
    return (
      <Notice tone="error" title="Could not load the reconciliation status">
        {status.error.message}
      </Notice>
    );
  }
  const s = status.data!;
  const last = s.lastRun;

  let headline: React.ReactNode;
  if (!last) {
    headline = (
      <Notice tone="warning" title="No reconciliation has run yet">
        Until one has, nothing here says whether this list is complete. The
        worker runs it every 5 minutes once the feature is switched on.
      </Notice>
    );
  } else if (s.stale) {
    headline = (
      <Notice
        tone="error"
        title={`Completeness unknown: no successful reconciliation since ${when(s.lastSuccess?.finishedAt)}`}
      >
        The last attempt ({when(last.finishedAt)}) ended as “{last.status}”
        {last.errorMessage ? `: ${last.errorMessage}` : ""}. Requests may be
        missing from this list and nothing has checked.
      </Notice>
    );
  } else if (last.gapCount > 0) {
    headline = (
      <Notice
        tone="warning"
        title={`The last reconciliation found ${count(last.gapCount)} request(s) the gateway had and this list did not`}
      >
        It added {count(last.inserted)} of them from the gateway’s own spend
        logs; they are marked “reconciled” below and carry fewer fields than a
        pushed record. See the operations note for what a non-zero gap means.
      </Notice>
    );
  } else {
    headline = (
      <Notice tone="ok" title="Complete as of the last reconciliation">
        Every request in the gateway’s spend logs for the checked window was
        already here.
      </Notice>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Is this list complete?</CardTitle>
        <p className="text-muted-foreground text-xs">
          The gateway pushes each request here as it happens, and drops pushes
          rather than delay model traffic. So every 5 minutes CAIRO compares the
          gateway’s own spend logs with this list, adds anything missing and
          records how many were missing: the gap count.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {headline}
        {s.pushed24h === 0 && s.reconciled24h > 0 ? (
          <Notice tone="warning" title="Push is not delivering">
            No pushed record in the last 24 hours: all {count(s.reconciled24h)}{" "}
            arrived by reconciliation, up to 5 minutes late. That is expected
            until the gateway’s logging callback is switched on (CHG-2026-009),
            and a fault afterwards.
          </Notice>
        ) : null}
        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-5">
          {[
            ["Last reconciliation", when(last?.finishedAt)],
            [
              "Window checked",
              last
                ? `${when(last.windowStart)} → ${when(last.windowEnd)}`
                : "—",
            ],
            ["Gap count, last run", count(last?.gapCount)],
            [
              "Gap count, 24 h",
              `${count(s.gapCount24h)} in ${count(s.runs24h)} runs`,
            ],
            [
              "Arrived in 24 h",
              `${count(s.pushed24h)} pushed · ${count(s.reconciled24h)} reconciled`,
            ],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-muted-foreground">{k}</div>
              <div className="font-bold">{v}</div>
            </div>
          ))}
        </div>
        {s.failedRuns24h > 0 ? (
          <p className="text-dark-red text-xs">
            {count(s.failedRuns24h)} reconciliation run(s) in the last 24 hours
            did not finish cleanly.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LogsTable({
  projectId,
  scope,
}: {
  projectId: string;
  scope: "project" | "unattributed";
}) {
  const [page, setPage] = useState(0);
  const limit = 50;
  const logs = api.acmeLitellm.requestLogs.useQuery(
    { projectId, scope, page, limit },
    { retry: false },
  );

  if (logs.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }
  if (logs.error) {
    // FORBIDDEN on "unattributed" just means: not an organisation owner.
    return scope === "unattributed" ? (
      <p className="text-muted-foreground text-sm">{logs.error.message}</p>
    ) : (
      <Notice tone="error" title="Could not load requests">
        {logs.error.message}
      </Notice>
    );
  }
  if (logs.data!.logs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No requests recorded.</p>
    );
  }
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Result</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead>End user · source address</TableHead>
            <TableHead>Arrived by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.data!.logs.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs whitespace-nowrap">
                {when(r.startTime)}
                <div className="text-muted-foreground">
                  {r.durationMs === null ? "" : `${count(r.durationMs)} ms`}
                </div>
              </TableCell>
              <TableCell className="text-xs">
                {r.keyName ?? (
                  <span className="text-muted-foreground">
                    not issued by CAIRO
                  </span>
                )}
                <div className="text-muted-foreground font-mono">
                  {r.keyAlias ?? ""}
                </div>
              </TableCell>
              <TableCell className="text-xs">
                {r.modelGroup ?? "—"}
                <div className="text-muted-foreground">{r.provider ?? ""}</div>
              </TableCell>
              <TableCell>
                {r.status === "success" ? (
                  <Badge variant="success">Success</Badge>
                ) : (
                  <Badge variant="error" title={r.errorClass ?? undefined}>
                    {r.errorClass ?? "Failed"}
                  </Badge>
                )}
                {r.cacheHit ? <Badge variant="outline">cache</Badge> : null}
              </TableCell>
              <TableCell className="text-right text-xs">
                {count(r.totalTokens)}
                <div className="text-muted-foreground">
                  {count(r.promptTokens)} in · {count(r.completionTokens)} out
                </div>
              </TableCell>
              <TableCell className="text-right text-xs">
                {r.spend === null
                  ? "—"
                  : `$${r.spend.toFixed(r.spend !== 0 && r.spend < 0.01 ? 6 : 2)}`}
              </TableCell>
              <TableCell className="text-xs">
                {r.endUser || "—"} · {r.requesterIp ?? "—"}
              </TableCell>
              <TableCell>
                {r.source === "PUSH" ? (
                  <Badge variant="outline">pushed</Badge>
                ) : (
                  <Badge variant="warning">reconciled</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {page * limit + 1}–
          {Math.min((page + 1) * limit, logs.data!.totalCount)} of{" "}
          {count(logs.data!.totalCount)}
        </span>
        <span className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Newer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={(page + 1) * limit >= logs.data!.totalCount}
            onClick={() => setPage(page + 1)}
          >
            Older
          </Button>
        </span>
      </div>
    </>
  );
}

export function AcmeLitellmRequestLogs({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <ReconcileStatus projectId={projectId} />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Requests made with this project’s keys
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            One row per call through the gateway: who, which key, which model,
            tokens, cost, result and source address. Never the prompt or the
            response. The end user and source address are what the caller
            reported; they are not verified. The table is append-only by design
            at database level.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <LogsTable projectId={projectId} scope="project" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Requests made with keys CAIRO did not issue
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            These belong to no project, so they are visible to organisation
            owners only.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <LogsTable projectId={projectId} scope="unattributed" />
        </CardContent>
      </Card>
    </div>
  );
}
