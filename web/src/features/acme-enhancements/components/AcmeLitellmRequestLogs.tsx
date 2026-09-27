/**
 * ACME addition (ADR-0003 §4, CHG-2026-008): the gateway request log, now the
 * "Gateway requests" tab of the Logs page (CHG-2026-073). CAIRO's append-only mirror of gateway requests (metadata
 * only, never prompt text), and above it the answer to "is this complete?":
 * the last reconciliation, its gap count, and whether that answer is stale.
 */
import { useState } from "react";
import { type PaginationState } from "@tanstack/react-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import { api, type RouterOutputs } from "@/src/utils/api";
import {
  ACME_LOG_DEFAULT_PAGE_SIZE,
  ACME_LOG_PAGE_SIZES,
  AcmeLogDetailDialog,
  AcmeLogTable,
  asyncTableData,
  nextPaginationState,
} from "@/src/features/acme-enhancements/components/AcmeLogTable";

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

type RequestLogRow =
  RouterOutputs["acmeLitellm"]["requestLogs"]["logs"][number];
type RequestScope = "project" | "unattributed";

function cost(spend: number | null) {
  return spend === null
    ? "—"
    : `$${spend.toFixed(spend !== 0 && spend < 0.01 ? 6 : 2)}`;
}

function ResultBadge({ row }: { row: RequestLogRow }) {
  return (
    <span className="flex items-center gap-1">
      {row.status === "success" ? (
        <Badge variant="success">Success</Badge>
      ) : (
        <Badge variant="error" title={row.errorClass ?? undefined}>
          {row.errorClass ?? "Failed"}
        </Badge>
      )}
      {row.cacheHit ? <Badge variant="outline">cache</Badge> : null}
    </span>
  );
}

function SourceBadge({ row }: { row: RequestLogRow }) {
  return row.source === "PUSH" ? (
    <Badge variant="outline">pushed</Badge>
  ) : (
    <Badge variant="warning">reconciled</Badge>
  );
}

const REQUEST_LOG_COLUMNS: LangfuseColumnDef<RequestLogRow>[] = [
  {
    accessorKey: "startTime",
    header: "Time",
    size: 180,
    cell: ({ row }) => when(row.original.startTime),
  },
  {
    accessorKey: "keyName",
    header: "Key",
    cell: ({ row }) =>
      row.original.keyName ?? (
        <span className="text-muted-foreground">not issued by CAIRO</span>
      ),
  },
  {
    accessorKey: "modelGroup",
    header: "Model",
    cell: ({ row }) => row.original.modelGroup ?? "—",
  },
  {
    accessorKey: "status",
    header: "Result",
    cell: ({ row }) => <ResultBadge row={row.original} />,
  },
  {
    accessorKey: "totalTokens",
    header: "Tokens",
    cell: ({ row }) => count(row.original.totalTokens),
  },
  {
    accessorKey: "spend",
    header: "Cost",
    cell: ({ row }) => cost(row.original.spend),
  },
  {
    accessorKey: "endUser",
    header: "End user",
    headerTooltip: {
      description:
        "As reported by the calling application. CAIRO does not verify it.",
    },
    cell: ({ row }) => row.original.endUser || "—",
  },
  {
    accessorKey: "requesterIp",
    header: "Source address",
    cell: ({ row }) => row.original.requesterIp ?? "—",
  },
  {
    accessorKey: "source",
    header: "Arrived by",
    cell: ({ row }) => <SourceBadge row={row.original} />,
  },
];

/**
 * CHG-2026-084 (ADR-0018): rendered through AcmeLogTable, like every Logs tab.
 * The two lists (this project's keys, and keys CAIRO did not issue) are one
 * table with a scope switch; the second line each cell used to carry moved
 * into the row's details.
 */
export function AcmeLitellmRequestLogs({ projectId }: { projectId: string }) {
  const [scope, setScope] = useState<RequestScope>("project");
  const [page, setPage] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: ACME_LOG_DEFAULT_PAGE_SIZE,
  });
  const logs = api.acmeLitellm.requestLogs.useQuery(
    { projectId, scope, page: page.pageIndex, limit: page.pageSize },
    {
      retry: false,
      // FORBIDDEN on "unattributed" is shown in the table; no error toast.
      meta: scope === "unattributed" ? { silentHttpCodes: [403] } : undefined,
    },
  );
  const [selected, setSelected] = useState<RequestLogRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const totalCount = logs.data?.totalCount;
  // FORBIDDEN on "unattributed" just means: not an organisation owner.
  const notOwner = scope === "unattributed" && logs.isError;

  return (
    <div className="flex flex-col gap-4">
      <ReconcileStatus projectId={projectId} />
      <AcmeLogTable
        tableName="acmeGatewayRequests"
        description={
          scope === "project"
            ? "One row per call through the gateway with this project's keys: who, which key, which model, tokens, cost, result and source address. Never the prompt or the response. CAIRO only adds rows here; it never edits or deletes them. Select a row for details."
            : "Calls made with keys CAIRO did not issue. They belong to no project, so only organisation owners can see them. Select a row for details."
        }
        summary={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Select
              value={scope}
              onValueChange={(value) => {
                setScope(value as RequestScope);
                setPage({ pageIndex: 0, pageSize: page.pageSize });
              }}
            >
              <SelectTrigger
                id="gateway-requests-scope"
                aria-label="Which keys"
                className="h-8 w-auto"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">
                  This project&apos;s keys
                </SelectItem>
                <SelectItem value="unattributed">
                  Keys CAIRO did not issue
                </SelectItem>
              </SelectContent>
            </Select>
            {totalCount !== undefined ? (
              <span className="text-muted-foreground">
                {totalCount.toLocaleString()}{" "}
                {totalCount === 1 ? "request" : "requests"}
              </span>
            ) : null}
          </div>
        }
        columns={REQUEST_LOG_COLUMNS}
        data={
          notOwner
            ? { isLoading: false, isError: false, data: [] }
            : asyncTableData({
                isPending: logs.isPending,
                isError: logs.isError,
                error: logs.error,
                data: logs.data?.logs,
              })
        }
        isFetching={logs.isFetching && !logs.isPending}
        pagination={{
          totalCount: notOwner ? 0 : (totalCount ?? null),
          state: page,
          options: ACME_LOG_PAGE_SIZES,
          onChange: (update) => {
            const next = nextPaginationState(update, page);
            setPage(
              next.pageSize === page.pageSize
                ? next
                : { pageIndex: 0, pageSize: next.pageSize },
            );
          },
        }}
        onRowClick={(row) => {
          setSelected(row);
          setDetailOpen(true);
        }}
        noResultsMessage={
          notOwner ? logs.error?.message : "No requests recorded."
        }
      />
      {selected ? (
        <AcmeLogDetailDialog
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          title="Gateway request"
          description="One call through the gateway, as CAIRO recorded it. Metadata only: never the prompt or the response."
          fields={[
            ["Time", when(selected.startTime)],
            [
              "Duration",
              selected.durationMs === null
                ? "—"
                : `${count(selected.durationMs)} ms`,
            ],
            ["Key", selected.keyName ?? "not issued by CAIRO"],
            [
              "Key alias",
              <span key="alias" className="font-mono text-xs">
                {selected.keyAlias ?? "—"}
              </span>,
            ],
            ["Model", selected.modelGroup ?? "—"],
            ["Provider", selected.provider ?? "—"],
            ["Result", <ResultBadge key="result" row={selected} />],
            [
              "Tokens",
              `${count(selected.totalTokens)} (${count(selected.promptTokens)} in · ${count(selected.completionTokens)} out)`,
            ],
            ["Cost", cost(selected.spend)],
            ["End user", selected.endUser || "—"],
            ["Source address", selected.requesterIp ?? "—"],
            ["Arrived by", <SourceBadge key="source" row={selected} />],
          ]}
          json={selected}
        />
      ) : null}
    </div>
  );
}
