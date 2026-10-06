import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { api } from "@/src/utils/api";
import { showErrorToast, showSuccessToast } from "@/src/features/notifications";

// ADR-0005-B part b (CHG-2026-089): the guardrail mode, switched by the
// deployment's named guardrail administrators (D-B1). Enforce is offered only
// where the deployment ceiling (CAIRO_GUARDRAIL_MODE_MAX) allows it, needs a
// typed confirmation and a reason, and switches back to record by itself
// after 30 minutes unless another time is chosen (D-B2).

const REASON_MIN_LENGTH = 10;
const NO_REVERT = "none";

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ModeBadge({ mode }: { mode: "record" | "enforce" }) {
  return mode === "enforce" ? (
    <Badge variant="error">Enforce</Badge>
  ) : (
    <Badge variant="outline">Record</Badge>
  );
}

function percent(part: number, total: number) {
  if (total === 0) return "—";
  return `${((100 * part) / total).toFixed(1)}%`;
}

export function AcmeGuardrailsEnforcement({
  projectId,
}: {
  projectId: string;
}) {
  const utils = api.useUtils();
  const config = api.acmeGuardrails.getConfig.useQuery(
    { projectId },
    { refetchInterval: 15_000 },
  );
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [revertChoice, setRevertChoice] = useState<string | null>(null);

  const setMode = api.acmeGuardrails.setMode.useMutation({
    onSuccess: (data) => {
      utils.acmeGuardrails.getConfig.invalidate({ projectId });
      utils.acmeGuardrails.modeChanges.invalidate();
      setReason("");
      setConfirmation("");
      showSuccessToast({
        title: data.changed
          ? `Mode set to ${data.mode} as version ${data.version}`
          : "No change to save",
        description: data.changed
          ? "Guardrails pods apply it within 30 seconds; each gateway replica follows from the next verdict it receives. The status on this card shows which have."
          : `The mode is already ${data.mode}.`,
      });
    },
    onError: (error) =>
      showErrorToast("Could not switch the mode", error.message),
  });

  if (config.isPending || config.isError || !config.data.configured) {
    // The Policies card above shows loading, error and "not configured".
    // eslint-disable-next-line @repo/no-null-render
    return null;
  }

  const { current, pods, enforcement } = config.data;
  if (!current) {
    // eslint-disable-next-line @repo/no-null-render
    return null;
  }

  const {
    ceiling,
    effectiveMode,
    revertAt,
    trialEnded,
    lastChange,
    canSwitch,
    readOnlyRole,
    revertOptions,
    defaultRevertMinutes,
    confirmationWord,
    gateways,
    evidence,
    judge,
    cappedByCeiling,
  } = enforcement;

  const chosenRevert = revertChoice ?? String(defaultRevertMinutes);
  const reasonOk = reason.trim().length >= REASON_MIN_LENGTH;
  const confirmed = confirmation.trim() === confirmationWord;
  const podsOnCurrent = pods.filter(
    (p) => p.appliedVersion === current.version,
  ).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">
          Enforcement <ModeBadge mode={effectiveMode} />
        </CardTitle>
        {!canSwitch && (
          <span className="text-muted-foreground text-xs">
            {readOnlyRole
              ? "Switching is off: your role here is read-only"
              : "Only the deployment's guardrail administrators can switch the mode"}
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0 text-sm">
        <div className="text-muted-foreground flex flex-col gap-1 text-xs">
          <div>
            In <b>record</b>, the gateway lets every request through and records
            what the guardrail would have done. In <b>enforce</b>, it refuses a
            request the guardrail blocks, sends redacted text when it redacts,
            and refuses every request when the guardrail cannot answer.
          </div>
          <div>
            Deployment ceiling: <b>{ceiling}</b>
            {ceiling === "record"
              ? ". Enforce cannot be chosen here, and the console serves record to the guardrails pods whatever is stored. Each gateway also has its own ceiling."
              : "."}
          </div>
          {cappedByCeiling && (
            <div>
              The stored version is enforce, but this ceiling serves it as
              record.
            </div>
          )}
          {effectiveMode === "enforce" && revertAt && (
            <div>
              Switches back to record automatically at{" "}
              <b>{formatDateTime(revertAt)}</b>.
            </div>
          )}
          {effectiveMode === "enforce" && !revertAt && (
            <div>No automatic switch-back is set.</div>
          )}
          {trialEnded && revertAt && (
            <div>
              The enforce trial ended at {formatDateTime(revertAt)}. Guardrails
              pods receive record on their next pull, which also records the
              automatic switch-back.
            </div>
          )}
          {lastChange && (
            <div>
              Last change: version {lastChange.version},{" "}
              {formatDateTime(lastChange.createdAt)},{" "}
              {lastChange.automatic
                ? "by the automatic switch-back"
                : `by ${lastChange.createdByEmail ?? "a guardrail administrator"}`}
              : “{lastChange.reason}”
            </div>
          )}
          <div>
            Guardrails pods: {podsOnCurrent} of {pods.length} on version{" "}
            {current.version} ({current.mode}).
          </div>
        </div>

        {judge !== null && judge.alert && (
          <div
            role="alert"
            className="border-destructive text-destructive rounded-md border p-3 text-xs"
          >
            <b>Alert: the guardrail&apos;s judge model could not answer</b>{" "}
            {judge.unavailable} of {judge.calls} stored guard events (
            {percent(judge.unavailable, judge.calls)}) in the last{" "}
            {judge.windowHours} hours. In enforce, each of these requests would
            be refused. Raise the judge&apos;s capacity before any enforce
            trial; the refusal rule is not relaxed.
          </div>
        )}

        {gateways !== null && (
          <div className="border-t pt-3">
            <div className="text-xs font-bold">
              Gateway replicas (as each reports itself; not verified)
            </div>
            {gateways.length === 0 ? (
              <div className="text-muted-foreground text-xs">
                No gateway replica has reported its mode in the last 24 hours. A
                replica reports through rayin-guardrails with each request it
                checks, once its guardrail hook supports the enforcement switch.
              </div>
            ) : (
              <ul className="text-muted-foreground text-xs">
                {gateways.map((g) => (
                  <li key={g.pod}>
                    {g.pod}: {g.mode ?? "mode unknown"}, settings version{" "}
                    {g.settingsVersion ?? "unknown"}, last seen{" "}
                    {formatDateTime(g.lastSeenAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {evidence !== null && (
          <div className="border-t pt-3">
            <div className="text-xs font-bold">
              Evidence before enforce (stored decisions, last{" "}
              {evidence.windowDays} days)
            </div>
            <div className="text-muted-foreground text-xs">
              {evidence.total} decisions: {evidence.blocked} block verdicts (
              {percent(evidence.blocked, evidence.total)} would be refused in
              enforce), {evidence.redacted} redact verdicts (
              {percent(evidence.redacted, evidence.total)} would be sent
              redacted), {evidence.allowed} allowed, {evidence.unavailable}{" "}
              without a verdict ({percent(evidence.unavailable, evidence.total)}{" "}
              would be refused because the judge model could not answer).
            </div>
            {judge !== null && (
              <div className="text-muted-foreground text-xs">
                Judge availability, last {judge.windowHours} hours:{" "}
                {judge.unavailable} of {judge.calls} stored guard events without
                a verdict
                {judge.calls > 0
                  ? ` (${percent(judge.unavailable, judge.calls)})`
                  : ""}
                . This counts every stored event, both directions and checks
                that ask no judge, so the judge&apos;s own failure rate can be
                higher; each guardrails pod reports that one on its health
                endpoint. The alert shows here, on this card, at{" "}
                {Math.round(judge.alertRate * 100)}% or more.
              </div>
            )}
            <div className="text-muted-foreground text-xs">
              Added latency is not measured in EYEON yet; check the
              gateway&apos;s guardrail health records before a trial.
            </div>
          </div>
        )}

        {canSwitch && effectiveMode === "record" && (
          <div className="bg-muted flex flex-col gap-2 rounded-md p-3">
            <div className="font-bold">Switch to enforce</div>
            {ceiling !== "enforce" ? (
              <div className="text-muted-foreground text-xs">
                Not available: the deployment ceiling is record. Raising it is a
                deployment change, made on the console and the gateway, planned
                only for a supervised trial window.
              </div>
            ) : (
              <>
                <div className="text-muted-foreground text-xs">
                  Before switching, review the evidence above and the enforce
                  gates for this deployment. Enforce applies to every project
                  and every gateway caller.
                </div>
                <Label htmlFor="guardrail-mode-revert" className="text-xs">
                  Switch back to record automatically after
                </Label>
                <Select value={chosenRevert} onValueChange={setRevertChoice}>
                  <SelectTrigger id="guardrail-mode-revert" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {revertOptions.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m} minutes
                      </SelectItem>
                    ))}
                    <SelectItem value={NO_REVERT}>
                      Never (stay in enforce)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Label htmlFor="guardrail-mode-reason" className="text-xs">
                  Reason (required, recorded in the audit log)
                </Label>
                <Input
                  id="guardrail-mode-reason"
                  value={reason}
                  maxLength={500}
                  disabled={setMode.isPending}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is enforce needed now?"
                />
                <Label htmlFor="guardrail-mode-confirm" className="text-xs">
                  Type {confirmationWord} to confirm
                </Label>
                <Input
                  id="guardrail-mode-confirm"
                  value={confirmation}
                  maxLength={32}
                  disabled={setMode.isPending}
                  onChange={(e) => setConfirmation(e.target.value)}
                  className="w-48"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={setMode.isPending || !reasonOk || !confirmed}
                    onClick={() =>
                      setMode.mutate({
                        projectId,
                        mode: "enforce",
                        reason,
                        confirmation,
                        revertAfterMinutes:
                          chosenRevert === NO_REVERT
                            ? null
                            : Number(chosenRevert),
                      })
                    }
                  >
                    {setMode.isPending ? "Switching…" : "Switch to enforce"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {canSwitch && effectiveMode === "enforce" && (
          <div className="bg-muted flex flex-col gap-2 rounded-md p-3">
            <div className="font-bold">Switch back to record</div>
            <Label htmlFor="guardrail-mode-reason" className="text-xs">
              Reason (required, recorded in the audit log)
            </Label>
            <Input
              id="guardrail-mode-reason"
              value={reason}
              maxLength={500}
              disabled={setMode.isPending}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why switch back now?"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={setMode.isPending || !reasonOk}
                onClick={() =>
                  setMode.mutate({
                    projectId,
                    mode: "record",
                    reason,
                    confirmation: null,
                    revertAfterMinutes: null,
                  })
                }
              >
                {setMode.isPending ? "Switching…" : "Switch back to record"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
