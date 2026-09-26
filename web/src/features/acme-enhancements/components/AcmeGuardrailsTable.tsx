import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Switch } from "@/src/components/ui/switch";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { api } from "@/src/utils/api";
import { JSONView } from "@/src/components/ui/CodeJsonViewer";
import { useHasProjectAccess } from "@/src/features/rbac";
import { showErrorToast, showSuccessToast } from "@/src/features/notifications";
import { cn } from "@/src/utils/tailwind";
import { useReadPath } from "@/src/features/events/hooks/useReadPath";
import { type QueryType, type ViewVersion } from "@langfuse/shared/query";

const ALL_PII_ENTITIES = [
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "CREDIT_CARD",
  "PERSON",
  "IBAN_CODE",
  "IP_ADDRESS",
] as const;
type PiiEntity = (typeof ALL_PII_ENTITIES)[number];

const ENTITY_LABELS: Record<string, string> = {
  EMAIL_ADDRESS: "Email",
  PHONE_NUMBER: "Phone",
  CREDIT_CARD: "Credit card",
  PERSON: "Person names",
  IBAN_CODE: "IBAN",
  IP_ADDRESS: "IP address",
};

function ActionBadge({ action }: { action: "allow" | "redact" | "block" }) {
  if (action === "block") return <Badge variant="error">Blocked</Badge>;
  if (action === "redact") return <Badge variant="warning">Redacted</Badge>;
  return <Badge variant="success">Allowed</Badge>;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b py-2 text-sm last:border-b-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

// Detail panel for one guardrail decision -- CAIRO roadmap Phase 1,
// "clickable jailbreak detail view". Who (user), from where (machine), when,
// what was decided, plus a link through to the trace. Blocked content stays
// encrypted: this panel only says whether it exists (reveal is Phase 2).
function AcmeGuardrailEventDetail({
  projectId,
  eventRowId,
  open,
  onClose,
}: {
  projectId: string;
  eventRowId: string | null;
  // Separate from eventRowId so the panel keeps showing the same event while
  // its close animation plays, instead of flashing "Loading..." once the id
  // is cleared.
  open: boolean;
  onClose: () => void;
}) {
  const detail = api.acmeGuardrails.eventDetail.useQuery(
    { projectId, id: eventRowId ?? "" },
    { enabled: eventRowId !== null },
  );
  // Trace content (raw prompts) needs projectData:read, which the Security
  // Analyst role does not hold -- show the trace id, not a link.
  const canOpenTrace = useHasProjectAccess({
    projectId,
    scope: "projectData:read",
  });
  const notRecorded = (
    <span className="text-muted-foreground">Not recorded</span>
  );
  const [showJson, setShowJson] = useState(false);
  // CHG-2026-071: a gateway event's id is LiteLLM's call id, which is not a
  // Langfuse trace id, so it is only offered as a trace link when it has the
  // shape of one (32 hex characters, as SDK-sent trace ids have) and no
  // gateway request matched.
  const looksLikeTraceId = (id: string) => /^[0-9a-f]{32}$/i.test(id);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Guardrail event</DialogTitle>
          <DialogDescription>
            One decision by rayin-guardrails, as stored in the audit trail.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {detail.isPending ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : detail.isError ? (
            <p className="text-muted-foreground text-sm">
              Could not load this event: {detail.error.message}
            </p>
          ) : (
            <div className="flex flex-col">
              <DetailRow label="Date & time">
                <span className="font-mono text-xs">
                  {formatDateTime(detail.data.time)}
                </span>
              </DetailRow>
              <DetailRow label="User">
                {detail.data.userId ?? notRecorded}
              </DetailRow>
              <DetailRow label="Machine">
                {detail.data.clientHost ?? notRecorded}
              </DetailRow>
              <DetailRow label="Agent">{detail.data.agentId}</DetailRow>
              <DetailRow label="Direction">
                <span className="capitalize">{detail.data.direction}</span>
              </DetailRow>
              <DetailRow label="Policy">
                {detail.data.policyTriggered ?? "—"}
              </DetailRow>
              <DetailRow label="Action">
                <ActionBadge action={detail.data.action} />
              </DetailRow>
              {detail.data.action === "redact" && detail.data.redactedText && (
                <DetailRow label="Redacted text">
                  <span className="font-mono text-xs whitespace-pre-wrap">
                    {detail.data.redactedText}
                  </span>
                </DetailRow>
              )}
              {detail.data.action === "block" && (
                <DetailRow label="Blocked content">
                  {detail.data.hasEncryptedContent ? (
                    <span className="text-muted-foreground">
                      Stored encrypted. Not shown here.
                    </span>
                  ) : (
                    notRecorded
                  )}
                </DetailRow>
              )}
              {detail.data.gatewayRequest ? (
                <DetailRow label="Gateway request">
                  <div className="flex flex-col gap-0.5 text-xs">
                    <span>
                      {detail.data.gatewayRequest.model ??
                        detail.data.gatewayRequest.modelGroup ??
                        "—"}{" "}
                      · {detail.data.gatewayRequest.status}
                      {detail.data.gatewayRequest.errorClass
                        ? ` (${detail.data.gatewayRequest.errorClass})`
                        : ""}
                    </span>
                    <span className="text-muted-foreground">
                      key {detail.data.gatewayRequest.keyAlias ?? "—"} ·{" "}
                      {detail.data.gatewayRequest.totalTokens ?? "—"} tokens · $
                      {(detail.data.gatewayRequest.spend ?? 0).toFixed(6)}
                    </span>
                    <span className="text-muted-foreground font-mono">
                      call {detail.data.traceId}
                    </span>
                  </div>
                </DetailRow>
              ) : (
                <DetailRow label="Correlation">
                  {!detail.data.traceId ? (
                    notRecorded
                  ) : canOpenTrace && looksLikeTraceId(detail.data.traceId) ? (
                    <Link
                      href={`/project/${projectId}/traces/${detail.data.traceId}`}
                      className="text-primary hover:underline"
                    >
                      View trace
                    </Link>
                  ) : (
                    <span className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs">
                        {detail.data.traceId}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Gateway call id. Its request row appears under Security
                        &gt; Logs &gt; Gateway requests within a few minutes.
                      </span>
                    </span>
                  )}
                </DetailRow>
              )}
              <DetailRow label="Event ID">
                <span className="font-mono text-xs">
                  {detail.data.eventId ?? "—"}
                </span>
              </DetailRow>
              <DetailRow label="Captured via">
                {(detail.data.source ??
                  (detail.data.eventId ? "push" : "pull")) === "push"
                  ? "Audit push"
                  : "Dashboard backfill (metadata only)"}
              </DetailRow>
              <div className="pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowJson((v) => !v)}
                >
                  {showJson ? "Hide JSON" : "Show JSON"}
                </Button>
              </div>
              {showJson && (
                <div className="pt-2">
                  {/* Metadata only: the encrypted blocked content is never
                      sent to the browser (hasEncryptedContent is a flag). */}
                  <JSONView json={detail.data} />
                </div>
              )}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

const ASSURANCE_SCORE_NAME = "promptfoo-pass";
const ASSURANCE_LOOKBACK_DAYS = 90;

type AssuranceRow = { time_dimension?: string; avg_value?: number };

// Continuous Assurance: the guardrails dashboard so far only shows what
// rayin-guardrails decided about traffic it actually saw -- it says nothing
// about whether the rail itself still catches what it's supposed to. This
// reads the promptfoo red-team suite's own verdicts (pushed here as Scores
// by integrations/promptfoo/config/hooks/langfuse-scores.js) and trends the
// block rate over time, rather than asserting the rail works and leaving it
// unverified between manual spot-checks.
//
// Reuses the existing generic dashboard query engine (api.dashboard.
// executeQuery) instead of a bespoke ACME endpoint -- this is the same
// mechanism ScoresChartView already uses, just a fixed query instead of a
// user-configurable one.
const RECENT_RESULTS_LIMIT = 20;

function AcmeGuardrailsAssurance({ projectId }: { projectId: string }) {
  const { isV4 } = useReadPath();
  const viewVersion: ViewVersion = isV4 ? "v2" : "v1";

  // Individual, unaggregated score rows for the latest run -- the trend
  // chart above answers "is it working," this answers "show me the actual
  // test cases." Same v3/v4 split scores.tsx uses (events-backed reads
  // only exist on v4), same reason: allFromEvents has no traces JOIN.
  const recentResultsInput = {
    projectId,
    filter: [
      {
        column: "name",
        operator: "any of" as const,
        value: [ASSURANCE_SCORE_NAME],
        type: "stringOptions" as const,
      },
    ],
    orderBy: { column: "timestamp", order: "DESC" as const },
    page: 0,
    limit: RECENT_RESULTS_LIMIT,
  };
  const recentResultsV3 = api.scores.all.useQuery(recentResultsInput, {
    enabled: !isV4,
  });
  const recentResultsV4 = api.scores.allFromEvents.useQuery(
    recentResultsInput,
    {
      enabled: isV4,
    },
  );
  const recentResults = isV4 ? recentResultsV4 : recentResultsV3;
  const recentRows = recentResults.data?.scores ?? [];

  const toTimestamp = new Date();
  const fromTimestamp = new Date(
    toTimestamp.getTime() - ASSURANCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );

  const query: QueryType = {
    view: "scores-numeric",
    dimensions: [],
    metrics: [{ measure: "value", aggregation: "avg" }],
    filters: [
      {
        column: "name",
        operator: "any of",
        value: [ASSURANCE_SCORE_NAME],
        type: "stringOptions",
      },
    ],
    timeDimension: { granularity: "day" },
    fromTimestamp: fromTimestamp.toISOString(),
    toTimestamp: toTimestamp.toISOString(),
    orderBy: null,
  };

  const trend = api.dashboard.executeQuery.useQuery({
    projectId,
    query,
    version: viewVersion,
  });

  const rows = ((trend.data as AssuranceRow[] | undefined) ?? [])
    .filter((r) => typeof r.avg_value === "number" && r.time_dimension)
    .sort(
      (a, b) =>
        new Date(a.time_dimension!).getTime() -
        new Date(b.time_dimension!).getTime(),
    );

  const latest = rows.at(-1);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-sm">Continuous Assurance</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            The jailbreak rail&apos;s own red-team suite (promptfoo), trended
            over time — not a claim, a measurement, checked on a schedule.
          </p>
        </div>
        <Badge variant="secondary">beta · promptfoo</Badge>
      </CardHeader>
      <CardContent className="pt-0">
        {trend.isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : trend.isError ? (
          <p className="text-muted-foreground text-sm">
            Could not load assurance data: {trend.error.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No red-team runs recorded yet for this project. Once the promptfoo
            suite (see <code>integrations/promptfoo</code>) runs against
            rayin-guardrails and pushes its verdicts here as Scores, the
            block-rate trend appears automatically — nothing to configure on
            this page.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">
                {Math.round((latest?.avg_value ?? 0) * 100)}%
              </span>
              <span className="text-muted-foreground text-xs">
                jailbreak block rate, most recent run (
                {latest?.time_dimension
                  ? new Date(latest.time_dimension).toLocaleDateString()
                  : "—"}
                )
              </span>
            </div>
            <div className="flex h-16 items-end gap-1">
              {rows.map((r, i) => (
                <div
                  key={i}
                  className="bg-primary/70 min-w-[3px] flex-1 rounded-t-sm"
                  style={{
                    height: `${Math.max(4, (r.avg_value ?? 0) * 100)}%`,
                  }}
                  title={`${r.time_dimension ? new Date(r.time_dimension).toLocaleDateString() : ""}: ${Math.round((r.avg_value ?? 0) * 100)}%`}
                />
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Each bar is one day&apos;s red-team run over the last{" "}
              {ASSURANCE_LOOKBACK_DAYS} days. A low or dropping bar is the real
              finding, not a bug in this chart.
            </p>
          </div>
        )}

        {recentRows.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <div className="text-muted-foreground mb-2 text-xs font-bold tracking-wide uppercase">
              Recent test cases
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">
                      {new Date(row.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground max-w-[320px] truncate text-xs"
                      title={row.comment ?? undefined}
                    >
                      {row.comment ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.value === 1 ? "success" : "error"}>
                        {row.value === 1 ? "Blocked" : "Failed open"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.traceId ? (
                        <Link
                          href={`/project/${projectId}/traces/${row.traceId}`}
                          className="text-primary text-xs hover:underline"
                        >
                          View trace
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AcmeGuardrailsPolicies({ projectId }: { projectId: string }) {
  const canEdit = useHasProjectAccess({ projectId, scope: "project:update" });
  const utils = api.useUtils();
  const config = api.acmeGuardrails.getConfig.useQuery({ projectId });

  // Draft state: what the switches show while editing, versus what's
  // actually saved (config.data). Only diverges after a real edit.
  const [draft, setDraft] = useState<{
    piiEntities: string[];
    jailbreakEnabled: boolean;
    topicalEnabled: boolean;
  } | null>(null);

  useEffect(() => {
    if (config.data?.configured) {
      setDraft({
        piiEntities: config.data.pii_entities,
        jailbreakEnabled: config.data.jailbreak_enabled,
        topicalEnabled: config.data.topical_enabled,
      });
    }
  }, [config.data]);

  const update = api.acmeGuardrails.updateConfig.useMutation({
    onSuccess: (data) => {
      utils.acmeGuardrails.getConfig.invalidate({ projectId });
      setDraft({
        piiEntities: data.pii_entities,
        jailbreakEnabled: data.jailbreak_enabled,
        topicalEnabled: data.topical_enabled,
      });
      showSuccessToast({
        title: "Guardrails updated",
        description:
          "Saved and pushed to rayin-guardrails — effective on the next request.",
      });
    },
    onError: (error) => {
      showErrorToast("Failed to update guardrails", error.message);
    },
  });

  if (config.isPending || !draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Policies</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground pt-0 text-sm">
          Loading…
        </CardContent>
      </Card>
    );
  }

  if (config.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Policies</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground pt-0 text-sm">
          Could not reach rayin-guardrails: {config.error.message}
        </CardContent>
      </Card>
    );
  }

  if (!config.data.configured) {
    // The parent already shows the "not configured" state; a second message
    // here would duplicate it.
    // eslint-disable-next-line @repo/no-null-render
    return null;
  }

  const saved = config.data;
  const isDirty =
    draft.jailbreakEnabled !== saved.jailbreak_enabled ||
    draft.topicalEnabled !== saved.topical_enabled ||
    draft.piiEntities.length !== saved.pii_entities.length ||
    draft.piiEntities.some((e) => !saved.pii_entities.includes(e));

  const piiOn = draft.piiEntities.length > 0;

  function toggleEntity(entity: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      piiEntities: draft.piiEntities.includes(entity)
        ? draft.piiEntities.filter((e) => e !== entity)
        : [...draft.piiEntities, entity],
    });
  }

  function togglePiiMaster(on: boolean) {
    if (!draft) return;
    // Off -> empty list (the master switch); on -> restore every entity
    // this deployment can detect, not just the ones that happened to be
    // saved before — a reasonable default for "turn it back on."
    setDraft({
      ...draft,
      piiEntities: on ? saved.available_pii_entities : [],
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Policies</CardTitle>
        {!canEdit && (
          <span className="text-muted-foreground text-xs">
            Owner/Admin can edit
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        <div className="flex items-start justify-between gap-3 border-b py-3">
          <div>
            <div className="text-sm">Jailbreak Detection</div>
          </div>
          <Switch
            checked={draft.jailbreakEnabled}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, jailbreakEnabled: checked })
            }
          />
        </div>

        <div className="flex items-start justify-between gap-3 border-b py-3">
          <div>
            <div className="text-sm">Topical Rail</div>
          </div>
          <Switch
            checked={draft.topicalEnabled}
            disabled={!canEdit || update.isPending}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, topicalEnabled: checked })
            }
          />
        </div>

        <div className="flex items-start justify-between gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm">PII Redaction</div>
            <div
              className={cn(
                "mt-2 flex flex-wrap gap-1.5 transition-opacity",
                !piiOn && "pointer-events-none opacity-40",
              )}
            >
              {saved.available_pii_entities.map((entity) => {
                const on = draft.piiEntities.includes(entity);
                return (
                  <button
                    key={entity}
                    type="button"
                    disabled={!canEdit || !piiOn || update.isPending}
                    onClick={() => toggleEntity(entity)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      on
                        ? "bg-primary text-primary-foreground border-transparent"
                        : "text-muted-foreground border-input",
                      canEdit && "cursor-pointer",
                    )}
                  >
                    {ENTITY_LABELS[entity] ?? entity}
                  </button>
                );
              })}
            </div>
          </div>
          <Switch
            checked={piiOn}
            disabled={!canEdit || update.isPending}
            onCheckedChange={togglePiiMaster}
          />
        </div>

        {isDirty && (
          <div className="bg-muted flex items-center gap-3 rounded-md p-3 text-sm">
            <span className="bg-dark-yellow h-2 w-2 shrink-0 rounded-full" />
            <span className="flex-1">Unsaved changes</span>
            <Button
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() =>
                setDraft({
                  piiEntities: saved.pii_entities,
                  jailbreakEnabled: saved.jailbreak_enabled,
                  topicalEnabled: saved.topical_enabled,
                })
              }
            >
              Discard
            </Button>
            <Button
              size="sm"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  projectId,
                  // draft.piiEntities is string[] because it's threaded
                  // through from the server's general-purpose read schema;
                  // filter rather than blindly cast, so an unrecognized
                  // value from a future server response can't reach the
                  // enum-validated mutation input.
                  piiEntities: draft.piiEntities.filter((e): e is PiiEntity =>
                    (ALL_PII_ENTITIES as readonly string[]).includes(e),
                  ),
                  jailbreakEnabled: draft.jailbreakEnabled,
                  topicalEnabled: draft.topicalEnabled,
                })
              }
            >
              {update.isPending ? "Saving…" : "Save & apply"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AcmeGuardrailsTable({ projectId }: { projectId: string }) {
  // The Continuous Assurance card reads scores (trace data) -- not shown to
  // roles without projectData:read, e.g. the Security Analyst.
  const canReadProjectData = useHasProjectAccess({
    projectId,
    scope: "projectData:read",
  });
  const events = api.acmeGuardrails.recentEvents.useQuery(
    { projectId, limit: 50 },
    // Polling, not a subscription -- the source itself (rayin-guardrails'
    // in-memory buffer) has no push mechanism, so this is what "live" means
    // here.
    { refetchInterval: 10_000 },
  );

  if (events.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }

  if (events.isError) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Could not reach rayin-guardrails: {events.error.message}
      </div>
    );
  }

  if (!events.data.configured) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-4 text-sm">
          Guardrails isn&apos;t configured for this deployment.
          RAYIN_GUARDRAILS_URL is unset — this is expected for a deployment that
          hasn&apos;t opted into the rayin-guardrails integration.
        </CardContent>
      </Card>
    );
  }

  const { summary } = events.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
              Total
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-bold">
            {summary.total}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
              Blocked
            </CardTitle>
          </CardHeader>
          <CardContent className="text-dark-red pt-0 text-2xl font-bold">
            {summary.blocked}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
              Redacted
            </CardTitle>
          </CardHeader>
          <CardContent className="text-dark-yellow pt-0 text-2xl font-bold">
            {summary.redacted}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
              Allowed
            </CardTitle>
          </CardHeader>
          <CardContent className="text-dark-green pt-0 text-2xl font-bold">
            {summary.allowed}
          </CardContent>
        </Card>
      </div>

      <AcmeGuardrailsPolicies projectId={projectId} />

      {canReadProjectData && <AcmeGuardrailsAssurance projectId={projectId} />}
    </div>
  );
}

/**
 * CHG-2026-073: guardrail decisions as a log, shown under Security > Logs
 * (moved out of the Guardrails page, which keeps the totals and policies).
 */
export function AcmeGuardrailEventsLog({ projectId }: { projectId: string }) {
  const [selectedEvent, setSelectedEvent] = useState<{
    id: string;
    open: boolean;
  } | null>(null);
  const openEvent = (id: string | null) => {
    if (id) setSelectedEvent({ id, open: true });
  };
  const events = api.acmeGuardrails.recentEvents.useQuery(
    { projectId, limit: 50 },
    // Polling: the source (rayin-guardrails' buffer) has no push mechanism.
    { refetchInterval: 10_000 },
  );

  if (events.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }
  if (events.isError) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Could not reach rayin-guardrails: {events.error.message}
      </div>
    );
  }
  if (!events.data.configured) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Guardrails isn&apos;t configured for this deployment.
      </div>
    );
  }
  const recent = events.data.events;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Guardrail events</CardTitle>
          <p className="text-muted-foreground text-xs">
            Stored in the audit trail as each decision is made — most recent
            first. Select a row for details.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No events yet. Send a request through rayin-guardrails to see it
              here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Date &amp; time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((event, i) => (
                  <TableRow
                    key={event.id ?? `${event.time}-${i}`}
                    className={cn(
                      event.id && "hover:bg-muted/50 cursor-pointer",
                    )}
                    onClick={event.id ? () => openEvent(event.id) : undefined}
                  >
                    <TableCell className="font-mono text-xs">
                      {formatDateTime(event.time)}
                    </TableCell>
                    <TableCell>{event.user_id ?? "—"}</TableCell>
                    <TableCell>{event.client_host ?? "—"}</TableCell>
                    <TableCell>{event.agent_id}</TableCell>
                    <TableCell className="capitalize">
                      {event.direction}
                    </TableCell>
                    <TableCell>{event.policy_triggered ?? "—"}</TableCell>
                    <TableCell>
                      <ActionBadge action={event.action} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AcmeGuardrailEventDetail
        projectId={projectId}
        eventRowId={selectedEvent?.id ?? null}
        open={selectedEvent?.open ?? false}
        onClose={() =>
          setSelectedEvent((current) =>
            current ? { ...current, open: false } : null,
          )
        }
      />
    </div>
  );
}
