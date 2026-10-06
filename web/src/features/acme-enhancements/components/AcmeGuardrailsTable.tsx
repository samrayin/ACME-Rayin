import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { api, type RouterOutputs } from "@/src/utils/api";
import { type LangfuseColumnDef } from "@/src/components/table/types";
import {
  ACME_LOG_DEFAULT_PAGE_SIZE,
  ACME_LOG_PAGE_SIZES,
  AcmeLogTable,
  DetailRow,
  asyncTableData,
  nextCursorPage,
  nextPaginationState,
} from "@/src/features/acme-enhancements/components/AcmeLogTable";
import { JSONView } from "@/src/components/ui/CodeJsonViewer";
import {
  downloadCsvFile,
  guardrailEventsToCsv,
} from "@/src/features/acme-enhancements/utils/guardrailEventsCsv";
import { useHasProjectAccess } from "@/src/features/rbac";
import { useIsContentFreeRole } from "@/src/features/rbac/hooks/useIsSecurityAnalyst";
import { showErrorToast, showSuccessToast } from "@/src/features/notifications";
import { cn } from "@/src/utils/tailwind";
import { useReadPath } from "@/src/features/events/hooks/useReadPath";
import { type QueryType, type ViewVersion } from "@langfuse/shared/query";
import { AcmeGuardrailsEnforcement } from "@/src/features/acme-enhancements/components/AcmeGuardrailsEnforcement";
import {
  type GatewayMode,
  type GuardrailAction,
  gatewayModeLabel,
  guardrailVerdictLabel,
} from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";

const ALL_PII_ENTITIES = [
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "CREDIT_CARD",
  "PERSON",
  "IBAN_CODE",
  "IP_ADDRESS",
  // Bahrain CPR number (rayin-guardrails, CHG-2026-078). An entity missing
  // here is dropped on save (see the filter in the save handler).
  "BH_CPR",
] as const;
type PiiEntity = (typeof ALL_PII_ENTITIES)[number];

const ENTITY_LABELS: Record<string, string> = {
  EMAIL_ADDRESS: "Email",
  PHONE_NUMBER: "Phone",
  CREDIT_CARD: "Credit card",
  PERSON: "Person names",
  IBAN_CODE: "IBAN",
  IP_ADDRESS: "IP address",
  BH_CPR: "Bahrain CPR number",
};

// CHG-2026-116: "Blocked" only when the gateway enforced the verdict; in
// record mode, or with no reported mode, it reads "Would block".
function ActionBadge({
  action,
  mode,
}: {
  action: GuardrailAction;
  mode: GatewayMode | null;
}) {
  const { label, variant } = guardrailVerdictLabel(action, mode);
  return <Badge variant={variant}>{label}</Badge>;
}

const GATEWAY_MODE_DETAIL: Record<GatewayMode | "none", string> = {
  enforce: "Enforce: the gateway applied this decision.",
  record:
    "Record: the gateway recorded this decision and let the request through.",
  none: "Not reported: not treated as applied.",
};

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
                <ActionBadge
                  action={detail.data.action}
                  mode={detail.data.mode}
                />
              </DetailRow>
              <DetailRow label="Gateway mode">
                {GATEWAY_MODE_DETAIL[detail.data.mode ?? "none"]}
              </DetailRow>
              {detail.data.action === "redact" && detail.data.redactedText && (
                <DetailRow label="Redacted text">
                  <span className="font-mono text-xs whitespace-pre-wrap">
                    {detail.data.redactedText}
                  </span>
                </DetailRow>
              )}
              {detail.data.action === "block" && (
                <DetailRow
                  label={
                    detail.data.mode === "enforce"
                      ? "Blocked content"
                      : "Flagged content"
                  }
                >
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
                        Gateway call id. Its request row appears under Reports /
                        Logs &gt; Logs &gt; Gateway requests within a few
                        minutes.
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

// CHG-2026-082: the card is hidden until a scheduled promptfoo run pushes its
// scores here. Nothing runs promptfoo on a schedule today and no run has sent
// scores to CAIRO, so the card could only show "Loading…" or an empty state
// while promising results "checked on a schedule". Set to true to bring it
// back once a scheduled run exists; nothing else needs to change.
const SHOW_CONTINUOUS_ASSURANCE = false as boolean;

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

// Matches REASON_MIN_LENGTH in server/acmeGuardrailSettings.ts, which is
// what actually enforces it.
const SETTINGS_REASON_MIN_LENGTH = 10;

// ADR-0005-B part a (CHG-2026-089): the settings are stored in CAIRO as
// versions, and every rayin-guardrails pod pulls the current one. This card
// shows the stored version and which version each pod reports; only the
// deployment's guardrail administrators can save a new one, and only from a
// role that is not read-only (CHG-2026-091).
function AcmeGuardrailsPolicies({ projectId }: { projectId: string }) {
  const utils = api.useUtils();
  // Polled so "n of n pods on version v" follows a save without a reload.
  const config = api.acmeGuardrails.getConfig.useQuery(
    { projectId },
    { refetchInterval: 15_000 },
  );

  // Draft state: what the switches show while editing, versus the stored
  // version. Reset only when the stored version changes, so the 15-second
  // poll never discards an edit in progress.
  const [draft, setDraft] = useState<{
    piiEntities: string[];
    jailbreakEnabled: boolean;
    topicalEnabled: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");
  const storedVersion = config.data?.current?.version;

  useEffect(() => {
    const current = config.data?.current;
    if (current) {
      setDraft({
        piiEntities: current.piiEntities,
        jailbreakEnabled: current.jailbreakEnabled,
        topicalEnabled: current.topicalEnabled,
      });
    }
    // Deliberately keyed on the stored version only: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedVersion]);

  const update = api.acmeGuardrails.updateConfig.useMutation({
    onSuccess: (data) => {
      utils.acmeGuardrails.getConfig.invalidate({ projectId });
      setReason("");
      showSuccessToast({
        title: data.changed
          ? `Saved as version ${data.version}`
          : "No change to save",
        description: data.changed
          ? "Guardrails pods that pull their settings apply it within 30 seconds. The pod status on this card shows which have."
          : `The settings already match version ${data.version}.`,
      });
    },
    onError: (error) => {
      showErrorToast("Failed to update guardrails", error.message);
    },
  });

  if (config.isPending) {
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
          Could not load the guardrail settings: {config.error.message}
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

  const {
    current,
    availablePiiEntities,
    pods,
    canEdit,
    readOnlyRole,
    adminsConfigured,
    signupClosed,
  } = config.data;

  if (!current || !draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Policies</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground pt-0 text-sm">
          No guardrail settings are stored in EYEON yet.
        </CardContent>
      </Card>
    );
  }

  const isDirty =
    draft.jailbreakEnabled !== current.jailbreakEnabled ||
    draft.topicalEnabled !== current.topicalEnabled ||
    draft.piiEntities.length !== current.piiEntities.length ||
    draft.piiEntities.some(
      (e) => !(current.piiEntities as readonly string[]).includes(e),
    );

  const piiOn = draft.piiEntities.length > 0;
  const podsOnCurrent = pods.filter(
    (p) => p.appliedVersion === current.version,
  ).length;
  const podsBehind = pods.filter((p) => p.appliedVersion !== current.version);
  const reasonOk = reason.trim().length >= SETTINGS_REASON_MIN_LENGTH;

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
      piiEntities: on ? availablePiiEntities : [],
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">
          Policies{" "}
          <Badge variant="outline" className="ml-1 align-middle">
            Version {current.version}
          </Badge>
        </CardTitle>
        {!canEdit && (
          <span className="text-muted-foreground text-xs">
            {readOnlyRole
              ? "Editing is off: your role here is read-only"
              : !adminsConfigured
                ? "Editing is off: no guardrail administrators are configured"
                : !signupClosed
                  ? "Editing is off while open sign-up is enabled"
                  : "Only the deployment's guardrail administrators can edit"}
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        <div className="text-muted-foreground border-b pb-3 text-xs">
          <div>
            Version {current.version}, saved{" "}
            {formatDateTime(new Date(current.createdAt).toISOString())} by{" "}
            {current.createdByInitialSetup
              ? "the initial setup"
              : (current.createdByEmail ?? "a guardrail administrator")}
            : “{current.reason}”
          </div>
          <div className="mt-1">
            {pods.length === 0
              ? `No guardrails pod has reported in the last ${Math.round(config.data.podStaleAfterSeconds / 60)} minutes.`
              : `${podsOnCurrent} of ${pods.length} guardrails ${pods.length === 1 ? "pod is" : "pods are"} on version ${current.version}` +
                (podsBehind.length > 0
                  ? ` (${podsBehind
                      .map(
                        (p) =>
                          `${p.pod}: ${p.appliedVersion === null ? "settings unknown" : `version ${p.appliedVersion}`}`,
                      )
                      .join("; ")})`
                  : ".")}
          </div>
        </div>

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
              {availablePiiEntities.map((entity) => {
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
          <div className="bg-muted flex flex-col gap-2 rounded-md p-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="bg-dark-yellow h-2 w-2 shrink-0 rounded-full" />
              <span className="flex-1">
                Unsaved changes. They apply to every project and every gateway
                caller on this deployment.
              </span>
            </div>
            <Label htmlFor="guardrail-settings-reason" className="text-xs">
              Reason (required, recorded in the audit log, and shown to everyone
              who can see guardrails in any organisation)
            </Label>
            <Input
              id="guardrail-settings-reason"
              value={reason}
              maxLength={500}
              disabled={update.isPending}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this change needed?"
            />
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() => {
                  setReason("");
                  setDraft({
                    piiEntities: current.piiEntities,
                    jailbreakEnabled: current.jailbreakEnabled,
                    topicalEnabled: current.topicalEnabled,
                  });
                }}
              >
                Discard
              </Button>
              <Button
                size="sm"
                disabled={update.isPending || !reasonOk}
                onClick={() =>
                  update.mutate({
                    projectId,
                    // Filter rather than cast, so an unrecognized value from
                    // a future server response can't reach the
                    // enum-validated mutation input.
                    piiEntities: draft.piiEntities.filter((e): e is PiiEntity =>
                      (ALL_PII_ENTITIES as readonly string[]).includes(e),
                    ),
                    jailbreakEnabled: draft.jailbreakEnabled,
                    topicalEnabled: draft.topicalEnabled,
                    reason,
                  })
                }
              >
                {update.isPending ? "Saving…" : "Save new version"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const SUMMARY_WINDOW_DAYS = 30;

export function AcmeGuardrailsTable({ projectId }: { projectId: string }) {
  // The Continuous Assurance card reads scores (trace data) -- not shown to
  // roles without projectData:read, e.g. the Security Analyst.
  const canReadProjectData = useHasProjectAccess({
    projectId,
    scope: "projectData:read",
  });
  // The totals count every stored decision in the window, not a page of
  // them. The window start is fixed per page load so the query stays the
  // same between polls.
  const [since] = useState(
    () => new Date(Date.now() - SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000),
  );
  const events = api.acmeGuardrails.eventHistory.useQuery(
    { projectId, pageSize: 1, filter: { from: since } },
    // Polling: rayin-guardrails has no push channel to the browser.
    { refetchInterval: 10_000 },
  );

  if (events.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }

  if (events.isError) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Could not load guardrail events: {events.error.message}
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

  const summary = events.data.counts;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Guardrail decisions in the last {SUMMARY_WINDOW_DAYS} days.{" "}
        <Link
          href={`/project/${projectId}/acme-enhancements/security-logs?tab=guardrails`}
          className="underline"
        >
          View every event
        </Link>
      </p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
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
              Block verdicts
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-dark-red text-2xl font-bold">
              {summary.blocked}
            </div>
            <div className="text-muted-foreground text-xs">
              {summary.blockedEnforced} blocked ·{" "}
              {summary.blocked - summary.blockedEnforced} would block
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
              Redact verdicts
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-dark-yellow text-2xl font-bold">
              {summary.redacted}
            </div>
            <div className="text-muted-foreground text-xs">
              {summary.redactedEnforced} redacted ·{" "}
              {summary.redacted - summary.redactedEnforced} would redact
            </div>
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
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
              No verdict
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-bold">
            {summary.unavailable}
          </CardContent>
        </Card>
      </div>

      <AcmeGuardrailsPolicies projectId={projectId} />

      <AcmeGuardrailsEnforcement projectId={projectId} />

      {SHOW_CONTINUOUS_ASSURANCE && canReadProjectData && (
        <AcmeGuardrailsAssurance projectId={projectId} />
      )}
    </div>
  );
}

type HistoryFilterForm = {
  from: string;
  to: string;
  action: "all" | "block" | "redact" | "allow" | "unavailable";
  direction: "all" | "input" | "output";
  agent: string;
  user: string;
  hideTestTraffic: boolean;
};

const EMPTY_HISTORY_FILTER: HistoryFilterForm = {
  from: "",
  to: "",
  action: "all",
  direction: "all",
  agent: "",
  user: "",
  hideTestTraffic: false,
};

/** Start of a `yyyy-mm-dd` date input's day, in the viewer's time zone. */
function startOfLocalDay(value: string, addDays = 0) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + addDays);
}

/** The form as the history query's filter; "To" includes that whole day. */
function toHistoryFilter(form: HistoryFilterForm) {
  return {
    from: form.from ? startOfLocalDay(form.from) : undefined,
    to: form.to ? startOfLocalDay(form.to, 1) : undefined,
    actions: form.action === "all" ? undefined : [form.action],
    direction: form.direction === "all" ? undefined : form.direction,
    agent: form.agent.trim() || undefined,
    user: form.user.trim() || undefined,
    hideTestTraffic: form.hideTestTraffic,
  };
}

type GuardrailEventRow = Extract<
  RouterOutputs["acmeGuardrails"]["eventHistory"],
  { configured: true }
>["events"][number];

const GUARDRAIL_EVENT_COLUMNS: LangfuseColumnDef<GuardrailEventRow>[] = [
  {
    accessorKey: "time",
    header: "Date & time",
    size: 190,
    cell: ({ row }) => (
      <span className="font-mono text-xs">
        {formatDateTime(row.original.time)}
      </span>
    ),
  },
  {
    accessorKey: "user_id",
    header: "User",
    headerTooltip: {
      description:
        "As reported by the calling application. EYEON does not verify it.",
    },
    cell: ({ row }) => row.original.user_id ?? "—",
  },
  {
    accessorKey: "client_host",
    header: "Machine",
    cell: ({ row }) => row.original.client_host ?? "—",
  },
  { accessorKey: "agent_id", header: "Agent" },
  {
    accessorKey: "direction",
    header: "Direction",
    cell: ({ row }) => (
      <span className="capitalize">{row.original.direction}</span>
    ),
  },
  {
    accessorKey: "policy_triggered",
    header: "Policy",
    cell: ({ row }) => row.original.policy_triggered ?? "—",
  },
  {
    accessorKey: "action",
    header: "Action",
    cell: ({ row }) => (
      <ActionBadge action={row.original.action} mode={row.original.mode} />
    ),
  },
  {
    accessorKey: "mode",
    header: "Mode",
    headerTooltip: {
      description:
        "The gateway's mode when it asked for this decision. Enforce: the gateway applied it. Record: it was recorded and the request went through. Not reported: the caller was not the gateway, or the event is older than this field.",
    },
    cell: ({ row }) => gatewayModeLabel(row.original.mode),
  },
];

/**
 * CHG-2026-073: guardrail decisions as a log, shown under Reports / Logs >
 * Logs (moved out of the Guardrails page, which keeps the totals and
 * policies). ADR-0013: the whole stored history, filtered, a page at a time,
 * with a CSV export of everything the filter matches.
 *
 * CHG-2026-084 (ADR-0018): rendered through AcmeLogTable, like every Logs tab.
 * The keyset paging drives the shared footer in cursor mode: no page jumps,
 * and changing the page size starts again from the newest page.
 */
export function AcmeGuardrailEventsLog({
  projectId,
  linkedFilter,
}: {
  projectId: string;
  /**
   * CHG-2026-122 (ADR-0023): filters preset by the link that opened the
   * page, read once when the log is first shown.
   */
  linkedFilter?: { agent: string; from: string };
}) {
  const [selectedEvent, setSelectedEvent] = useState<{
    id: string;
    open: boolean;
  } | null>(null);
  // Export writes the audit log, so it is not open to the read-only roles
  // (Security Analyst, Auditor); the server refuses them too.
  const canExport = !useIsContentFreeRole(projectId);
  const [initialFilter] = useState<HistoryFilterForm>(() => ({
    ...EMPTY_HISTORY_FILTER,
    ...linkedFilter,
  }));
  const [draft, setDraft] = useState<HistoryFilterForm>(initialFilter);
  const [applied, setApplied] = useState<HistoryFilterForm>(initialFilter);
  // Cursor of each page after the first; the last one is the page shown.
  const [cursors, setCursors] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(ACME_LOG_DEFAULT_PAGE_SIZE);
  const cursor = cursors[cursors.length - 1];
  const filter = useMemo(() => toHistoryFilter(applied), [applied]);

  const applyFilter = (next: HistoryFilterForm) => {
    setDraft(next);
    setApplied(next);
    setCursors([]);
  };

  const events = api.acmeGuardrails.eventHistory.useQuery(
    { projectId, cursor, pageSize, filter },
    {
      // Only the first page follows new events; older pages stay put.
      refetchInterval: cursor ? false : 10_000,
      placeholderData: (previous) => previous,
    },
  );

  // ADR-0005-B part b: mode changes in the same period, so a switch to or
  // from enforce shows next to the decisions it affected.
  const modeChanges = api.acmeGuardrails.modeChanges.useQuery(
    { projectId, from: filter.from, to: filter.to },
    { refetchInterval: cursor ? false : 30_000 },
  );

  const exportHistory = api.acmeGuardrails.exportEventHistory.useMutation({
    onSuccess: (result) => {
      const day = new Date().toISOString().slice(0, 10);
      downloadCsvFile(
        guardrailEventsToCsv(result.rows),
        `guardrail-events-${projectId}-${day}.csv`,
      );
      showSuccessToast({
        title: `Exported ${result.rows.length} events`,
        description: result.truncated
          ? `Only the newest ${result.maxRows} are included. Narrow the dates to export the rest.`
          : "The export is recorded in the audit log.",
      });
    },
    onError: (error) => showErrorToast("Export failed", error.message),
  });

  if (events.data && !events.data.configured) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Guardrails isn&apos;t configured for this deployment.
      </div>
    );
  }
  const history = events.data?.configured ? events.data : undefined;
  const counts = history?.counts;
  const filtered =
    JSON.stringify(applied) !== JSON.stringify(EMPTY_HISTORY_FILTER);
  const page = { pageIndex: cursors.length, pageSize };

  return (
    <>
      <AcmeLogTable
        tableName="acmeGuardrailEvents"
        description="Every guardrail decision stored in the audit trail, newest first. Select a row for details."
        filters={
          <form
            className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7"
            onSubmit={(e) => {
              e.preventDefault();
              applyFilter(draft);
            }}
          >
            <div>
              <Label htmlFor="guardrail-history-from">From</Label>
              <Input
                id="guardrail-history-from"
                type="date"
                className="mt-1.5"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="guardrail-history-to">To</Label>
              <Input
                id="guardrail-history-to"
                type="date"
                className="mt-1.5"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="guardrail-history-action">Action</Label>
              <Select
                value={draft.action}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    action: v as HistoryFilterForm["action"],
                  })
                }
              >
                <SelectTrigger id="guardrail-history-action" className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="block">Blocked or would block</SelectItem>
                  <SelectItem value="redact">
                    Redacted or would redact
                  </SelectItem>
                  <SelectItem value="allow">Allowed</SelectItem>
                  <SelectItem value="unavailable">
                    No verdict (judge unavailable)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="guardrail-history-direction">Direction</Label>
              <Select
                value={draft.direction}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    direction: v as HistoryFilterForm["direction"],
                  })
                }
              >
                <SelectTrigger
                  id="guardrail-history-direction"
                  className="mt-1.5"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Both directions</SelectItem>
                  <SelectItem value="input">Input</SelectItem>
                  <SelectItem value="output">Output</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="guardrail-history-agent">Agent contains</Label>
              <Input
                id="guardrail-history-agent"
                className="mt-1.5"
                maxLength={200}
                value={draft.agent}
                onChange={(e) => setDraft({ ...draft, agent: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="guardrail-history-user">User contains</Label>
              <Input
                id="guardrail-history-user"
                className="mt-1.5"
                maxLength={200}
                value={draft.user}
                onChange={(e) => setDraft({ ...draft, user: e.target.value })}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" size="sm">
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!filtered}
                onClick={() => applyFilter(EMPTY_HISTORY_FILTER)}
              >
                Reset
              </Button>
            </div>
          </form>
        }
        summary={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {counts ? (
              <span>
                <span className="font-bold">
                  {counts.total} {counts.total === 1 ? "event" : "events"}
                  {filtered ? " match" : ""}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {counts.blockedEnforced} blocked ·{" "}
                  {counts.blocked - counts.blockedEnforced} would block ·{" "}
                  {counts.redactedEnforced} redacted ·{" "}
                  {counts.redacted - counts.redactedEnforced} would redact ·{" "}
                  {counts.allowed} allowed · {counts.unavailable} without a
                  verdict
                  {applied.hideTestTraffic &&
                  history &&
                  history.hiddenTestEvents > 0
                    ? ` · ${history.hiddenTestEvents} test events hidden`
                    : ""}
                </span>
              </span>
            ) : null}
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={applied.hideTestTraffic}
                onCheckedChange={(checked) =>
                  applyFilter({ ...applied, hideTestTraffic: checked })
                }
              />
              Hide test traffic
              {history
                ? ` (agent names starting ${history.testTrafficPrefixes.join(" or ")})`
                : ""}
            </label>
          </div>
        }
        actions={
          canExport ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!counts?.total || exportHistory.isPending}
              onClick={() => exportHistory.mutate({ projectId, filter })}
            >
              {exportHistory.isPending ? "Exporting…" : "Export CSV"}
            </Button>
          ) : null
        }
        notice={
          history?.liveSync === "unavailable" ||
          (modeChanges.data && modeChanges.data.length > 0) ? (
            <div className="flex flex-col gap-1">
              {history?.liveSync === "unavailable" && (
                <p className="text-muted-foreground text-xs">
                  rayin-guardrails did not answer, so events whose push failed
                  in the last few minutes may be missing. Stored events are
                  shown.
                </p>
              )}
              {modeChanges.data && modeChanges.data.length > 0 && (
                <p className="text-muted-foreground text-xs">
                  Guardrail mode changes in this period:{" "}
                  {modeChanges.data
                    .map(
                      (c) =>
                        `${formatDateTime(new Date(c.createdAt).toISOString())} to ${c.mode} (version ${c.version}, ${
                          c.automatic
                            ? "automatic switch-back"
                            : `by ${c.createdByEmail ?? "a guardrail administrator"}`
                        })`,
                    )
                    .join("; ")}
                  .
                </p>
              )}
            </div>
          ) : null
        }
        columns={GUARDRAIL_EVENT_COLUMNS}
        data={asyncTableData({
          isPending: events.isPending,
          isError: events.isError,
          error: events.error,
          data: history?.events,
        })}
        isFetching={events.isFetching && !events.isPending}
        pagination={{
          totalCount: counts?.total ?? null,
          hasNextPage: Boolean(history?.nextCursor),
          canJumpPages: false,
          state: page,
          options: ACME_LOG_PAGE_SIZES,
          onChange: (update) => {
            const next = nextCursorPage({
              next: nextPaginationState(update, page),
              current: page,
              cursors,
              nextCursor: history?.nextCursor,
            });
            setPageSize(next.pageSize);
            setCursors(next.cursors);
          },
        }}
        onRowClick={(row) => {
          if (row.id) setSelectedEvent({ id: row.id, open: true });
        }}
        noResultsMessage={
          filtered
            ? "No events match these filters."
            : "No events yet. Send a request through rayin-guardrails to see it here."
        }
      />

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
    </>
  );
}
