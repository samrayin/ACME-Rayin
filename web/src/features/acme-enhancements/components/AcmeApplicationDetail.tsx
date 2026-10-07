import { useState } from "react";
import Link from "next/link";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import { api, type RouterOutputs } from "@/src/utils/api";
import {
  AcmeLogDetailDialog,
  AcmeLogTable,
  asyncTableData,
} from "@/src/features/acme-enhancements/components/AcmeLogTable";
import {
  ApplicationCard,
  Sparkline,
  localDateInput,
} from "@/src/features/acme-enhancements/components/AcmeApplicationsScorecard";
import { KeyStatusBadge } from "@/src/features/acme-enhancements/components/AcmeLitellmGateway";
import {
  gatewayModeLabel,
  guardrailVerdictLabel,
} from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";
import { linkedAgents } from "@/src/features/acme-enhancements/utils/guardrailAgentLink";

// ACME (CHG-2026-125, ADR-0023 §3.5): one application's detail screen,
// reached from its scorecard. Its scorecard (the same card), its key's
// generations and limits, its daily activity, its latest gateway requests
// with the guardrail decisions beside each, and its key's change record.
// Metadata only: no prompt or answer text, and never a token hash.

type Detail = Extract<
  RouterOutputs["acmeApplications"]["detail"],
  { enabled: true }
>;
type Generation = Detail["generations"][number];
type RequestRow = NonNullable<Detail["requests"]>[number];
type Decision = RequestRow["decisions"][number];
type ChangeRow = NonNullable<Detail["changes"]>[number];
type SettingChange = ChangeRow["changes"][number];

function when(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function day(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? 6 : 2)}`;
}

function count(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : n.toLocaleString();
}

function latency(ms: number | null) {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const DIRECTION_LABEL: Record<Decision["direction"], string> = {
  input: "Prompt",
  output: "Answer",
};

/** One guardrail decision as a badge: direction and verdict. */
function DecisionBadge({ decision }: { decision: Decision }) {
  const { label, variant } = guardrailVerdictLabel(
    decision.action,
    decision.mode,
  );
  return (
    <Badge
      variant={variant}
      title={`${decision.policy ?? "No policy label"} · ${gatewayModeLabel(decision.mode)} mode`}
    >
      {DIRECTION_LABEL[decision.direction]}: {label}
    </Badge>
  );
}

function ResultBadge({ row }: { row: RequestRow }) {
  return row.succeeded ? (
    <Badge variant="success">Success</Badge>
  ) : (
    <Badge variant="error" title={row.errorClass ?? undefined}>
      {row.errorClass ?? "Failed"}
    </Badge>
  );
}

function generationLabel(generation: number | null) {
  return generation === null ? "—" : `Key ${generation}`;
}

function requestColumns(
  canSeeSpend: boolean,
  decisionsShown: boolean,
): LangfuseColumnDef<RequestRow>[] {
  return [
    {
      accessorKey: "time",
      header: "Time",
      size: 180,
      cell: ({ row }) => when(row.original.time),
    },
    {
      accessorKey: "generation",
      header: "Key",
      headerTooltip: {
        description:
          "Which generation of the application's key made the call. Key 1 is the first; each rotation adds one.",
      },
      cell: ({ row }) => generationLabel(row.original.generation),
    },
    {
      accessorKey: "model",
      header: "Model",
      cell: ({ row }) => row.original.model ?? "—",
    },
    {
      accessorKey: "succeeded",
      header: "Result",
      cell: ({ row }) => <ResultBadge row={row.original} />,
    },
    {
      accessorKey: "latencyMs",
      header: "Latency",
      headerTooltip: {
        description:
          "From the gateway receiving the call to its answer, model included.",
      },
      cell: ({ row }) => latency(row.original.latencyMs),
    },
    ...(canSeeSpend
      ? [
          {
            accessorKey: "costUsd",
            header: "Cost",
            cell: ({ row }) => money(row.original.costUsd),
          } satisfies LangfuseColumnDef<RequestRow>,
        ]
      : []),
    {
      accessorKey: "endUser",
      header: "End user",
      headerTooltip: {
        description:
          "As reported by the calling application. EYEON does not verify it.",
      },
      cell: ({ row }) => row.original.endUser || "—",
    },
    ...(decisionsShown
      ? [
          {
            accessorKey: "decisions",
            header: "Guardrail",
            headerTooltip: {
              description:
                "The guardrail's decisions on this call, linked by the gateway call id. Hover a decision for its policy and the gateway's mode.",
            },
            cell: ({ row }) =>
              row.original.decisions.length === 0 ? (
                <span className="text-muted-foreground">None recorded</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {row.original.decisions.map((d, i) => (
                    <DecisionBadge key={`${d.direction}-${i}`} decision={d} />
                  ))}
                </span>
              ),
          } satisfies LangfuseColumnDef<RequestRow>,
        ]
      : []),
  ];
}

const PHASE_BADGE: Record<
  NonNullable<ChangeRow["outcome"]> | "intent",
  { label: string; variant: "outline" | "success" | "error" }
> = {
  intent: { label: "Intent", variant: "outline" },
  succeeded: { label: "Succeeded", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  partial: { label: "Partial", variant: "error" },
};

function PhaseBadge({ row }: { row: ChangeRow }) {
  const { label, variant } =
    PHASE_BADGE[row.phase === "intent" ? "intent" : (row.outcome ?? "failed")];
  return <Badge variant={variant}>{label}</Badge>;
}

/** One setting's value, in the words the gateway page uses. */
function settingText(
  setting: SettingChange["setting"],
  value: SettingChange["from"],
) {
  if (value === null) return "none";
  if (Array.isArray(value))
    return value.length > 0
      ? value.join(", ")
      : setting === "models"
        ? "all models"
        : "none";
  if (setting === "maxBudget" && typeof value === "number") return money(value);
  if (setting === "expiresAt" && typeof value === "string") return day(value);
  if (setting === "status" && typeof value === "string")
    return value.toLowerCase().replace(/_/g, " ");
  return typeof value === "number" ? value.toLocaleString() : String(value);
}

function changeText(c: SettingChange) {
  return `${c.label}: ${settingText(c.setting, c.from)} → ${settingText(c.setting, c.to)}`;
}

const CHANGE_COLUMNS: LangfuseColumnDef<ChangeRow>[] = [
  {
    accessorKey: "time",
    header: "Time",
    size: 180,
    cell: ({ row }) => when(row.original.time),
  },
  {
    accessorKey: "actor",
    header: "Who",
    cell: ({ row }) => row.original.actor,
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => row.original.role ?? "—",
  },
  {
    accessorKey: "action",
    header: "Action",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.action}</span>
    ),
  },
  {
    accessorKey: "phase",
    header: "Phase",
    cell: ({ row }) => <PhaseBadge row={row.original} />,
  },
  {
    accessorKey: "generation",
    header: "Key",
    cell: ({ row }) => generationLabel(row.original.generation),
  },
  {
    accessorKey: "changes",
    header: "Settings changed",
    cell: ({ row }) =>
      row.original.changes.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="text-xs">
          {row.original.changes.map(changeText).join("; ")}
        </span>
      ),
  },
];

function Generations({
  projectId,
  generations,
}: {
  projectId: string;
  generations: Generation[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Key and limits</CardTitle>
        <p className="text-muted-foreground text-sm">
          Every generation of this application&apos;s key, newest first. The
          scorecard rates the current one&apos;s settings and every
          generation&apos;s traffic. Limits are changed under{" "}
          <Link
            href={`/project/${projectId}/acme-enhancements/llm-gateway`}
            className="underline"
          >
            Governance Controls › LLM Gateway
          </Link>
          .
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Alias</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Ended</TableHead>
              <TableHead>Models</TableHead>
              <TableHead>Requests / min</TableHead>
              <TableHead>Tokens / min</TableHead>
              <TableHead>Budget</TableHead>
              <TableHead>Expiry</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {generations.map((g) => (
              <TableRow key={g.generation}>
                <TableCell>
                  {generationLabel(g.generation)}
                  {g.current ? (
                    <Badge variant="outline" className="ml-2">
                      current
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{g.alias}</TableCell>
                <TableCell>
                  <KeyStatusBadge status={g.status} />
                </TableCell>
                <TableCell>{day(g.createdAt)}</TableCell>
                <TableCell>
                  {g.rotatedAt
                    ? `Rotated ${day(g.rotatedAt)}`
                    : g.revokedAt
                      ? `Revoked ${day(g.revokedAt)}`
                      : "—"}
                </TableCell>
                <TableCell>
                  {g.models.length ? g.models.join(", ") : "All models"}
                </TableCell>
                <TableCell>{count(g.rpmLimit)}</TableCell>
                <TableCell>{count(g.tpmLimit)}</TableCell>
                <TableCell>
                  {money(g.maxBudget)}
                  {g.maxBudget !== null && g.budgetDuration
                    ? ` per ${g.budgetDuration}`
                    : ""}
                </TableCell>
                <TableCell>{g.expiresAt ? day(g.expiresAt) : "None"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DailyActivity({ data }: { data: Detail }) {
  const totals = data.daily.reduce(
    (t, p) => ({
      calls: t.calls + p.calls,
      failed: t.failed + p.failed,
      refused: t.refused + p.refused,
      spend: t.spend + (p.spendUsd ?? 0),
    }),
    { calls: 0, failed: 0, refused: 0, spend: 0 },
  );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Daily activity</CardTitle>
        <p className="text-muted-foreground text-sm">
          By UTC day over the last {data.windowDays} days, every generation of
          the key together: {totals.calls.toLocaleString()} calls,{" "}
          {totals.failed.toLocaleString()} failed,{" "}
          {totals.refused.toLocaleString()} prompts refused
          {data.canSeeSpend ? `, ${money(totals.spend)} spent` : ""}. Hover a
          day for its value.
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 pt-0 md:grid-cols-4">
        <Sparkline
          label="Calls"
          unit="calls"
          points={data.daily.map((p) => ({ day: p.day, value: p.calls }))}
        />
        <Sparkline
          label="Failed calls"
          unit="failed calls"
          points={data.daily.map((p) => ({ day: p.day, value: p.failed }))}
        />
        <Sparkline
          label="Prompts refused"
          unit="prompts refused"
          points={data.daily.map((p) => ({ day: p.day, value: p.refused }))}
        />
        {data.canSeeSpend ? (
          <Sparkline
            label="Spend (USD)"
            unit="USD"
            points={data.daily.map((p) => ({
              day: p.day,
              value: Math.round((p.spendUsd ?? 0) * 100) / 100,
            }))}
          />
        ) : (
          <div className="text-muted-foreground text-xs">
            Spend is not shown for your role.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Requests({ data }: { data: Detail }) {
  const [selected, setSelected] = useState<RequestRow | null>(null);
  if (data.requests === null) {
    return (
      <p className="text-muted-foreground text-sm">
        Gateway requests are not shown for your role.
      </p>
    );
  }
  const shown = data.requests.length;
  return (
    <>
      <AcmeLogTable
        tableName="acmeApplicationRequests"
        description={`The latest ${data.requestsLimit} gateway requests of this application in the period, newest first, with the guardrail's decisions on each beside it. Select a row for details. The full list is under Reports / Logs › Logs › Gateway requests.`}
        summary={
          <span className="text-muted-foreground text-sm">
            {shown.toLocaleString()} of{" "}
            {data.application.calls.toLocaleString()} calls in the period
          </span>
        }
        columns={requestColumns(data.canSeeSpend, data.decisionsShown)}
        data={asyncTableData({
          isPending: false,
          isError: false,
          data: data.requests,
        })}
        pagination={undefined}
        onRowClick={(row) => setSelected(row)}
        noResultsMessage="No gateway requests from this application in the period."
      />
      {selected ? (
        <AcmeLogDetailDialog
          open
          onClose={() => setSelected(null)}
          title="Gateway request"
          description="One call through the gateway, and the guardrail's decisions on it. Metadata only."
          fields={[
            ["Time", when(selected.time)],
            ["Key", generationLabel(selected.generation)],
            ["Model", selected.model ?? "—"],
            ["Result", <ResultBadge key="result" row={selected} />],
            ["Latency", latency(selected.latencyMs)],
            ...(data.canSeeSpend
              ? [["Cost", money(selected.costUsd)] as [string, string]]
              : []),
            ["End user", selected.endUser || "—"],
            ...(data.decisionsShown
              ? selected.decisions.length === 0
                ? [
                    ["Guardrail", "No decision recorded for this call"] as [
                      string,
                      string,
                    ],
                  ]
                : selected.decisions.map(
                    (d, i) =>
                      [
                        `${DIRECTION_LABEL[d.direction]} decision${selected.decisions.length > 2 ? ` ${i + 1}` : ""}`,
                        <span key={`decision-${i}`}>
                          <DecisionBadge decision={d} />{" "}
                          <span className="text-muted-foreground text-xs">
                            {d.policy ?? "No policy label"} ·{" "}
                            {gatewayModeLabel(d.mode)} mode · {when(d.time)}
                          </span>
                        </span>,
                      ] as [string, React.ReactNode],
                  )
              : []),
          ]}
        />
      ) : null}
    </>
  );
}

function Changes({ data }: { data: Detail }) {
  if (data.changes === null) {
    return (
      <p className="text-muted-foreground text-sm">
        The key&apos;s change record is not shown for your role.
      </p>
    );
  }
  return (
    <AcmeLogTable
      tableName="acmeApplicationChanges"
      description={`Every change EYEON made to this application's key, all generations, newest first${data.changes.length >= data.changesLimit ? ` (the newest ${data.changesLimit})` : ""}. An "intent" row is written before the gateway is called and an "outcome" row before the user sees a result. Only the settings that changed are listed, never key material.`}
      columns={CHANGE_COLUMNS}
      data={asyncTableData({
        isPending: false,
        isError: false,
        data: data.changes,
      })}
      pagination={undefined}
      noResultsMessage="Nothing recorded for this key."
    />
  );
}

export function AcmeApplicationDetail({
  projectId,
  lineageId,
}: {
  projectId: string;
  lineageId: string;
}) {
  const [windowDays, setWindowDays] = useState<7 | 30>(30);
  const detail = api.acmeApplications.detail.useQuery(
    { projectId, lineageId, windowDays },
    { retry: false, meta: { silentHttpCodes: [404] } },
  );

  if (detail.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }
  if (detail.isError) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Could not load this application: {detail.error.message}
      </div>
    );
  }
  if (!detail.data.enabled) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-4 text-sm">
          Gateway management is switched off on this deployment, so there are no
          applications to show.
        </CardContent>
      </Card>
    );
  }
  const data = detail.data;
  const periodFrom = localDateInput(
    new Date(Date.parse(data.generatedAt) - data.windowDays * 86_400_000),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground max-w-3xl text-sm">
          One application connected through the gateway: its scorecard, its key
          and limits, its activity, its latest requests with the
          guardrail&apos;s decisions, and its key&apos;s change record. Metadata
          only, never prompt or answer text.{" "}
          <Link
            href={`/project/${projectId}/acme-enhancements/applications`}
            className="underline"
          >
            Back to Applications
          </Link>
        </p>
        <Select
          value={String(windowDays)}
          onValueChange={(v) => setWindowDays(v === "7" ? 7 : 30)}
        >
          <SelectTrigger className="w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ApplicationCard
        app={data.application}
        projectId={projectId}
        periodFrom={periodFrom}
        showDetailLink={false}
        evidenceAgents={linkedAgents(data.aliases)}
      />

      <Generations projectId={projectId} generations={data.generations} />

      <DailyActivity data={data} />

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-bold">Recent requests</h2>
        <Requests data={data} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-bold">Change record</h2>
        <Changes data={data} />
      </div>
    </div>
  );
}
