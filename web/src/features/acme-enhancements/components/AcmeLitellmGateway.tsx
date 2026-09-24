/**
 * ACME addition (ADR-0003, CHG-2026-005): the LLM Gateway screens.
 *
 * Key-material rules for this file:
 *  - A new key's secret exists in exactly one place: the `revealed` state of
 *    <SecretRevealDialog>, from the create/rotate mutation's response until
 *    the dialog closes. It is never logged, never put in a toast, never put
 *    in the URL or in any query cache (mutation results are not cached).
 *  - Nothing else the server returns contains key material.
 */
import { Fragment, useEffect, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/src/components/ui/alert-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  TabsBar,
  TabsBarContent,
  TabsBarList,
  TabsBarTrigger,
} from "@/src/components/ui/tabs-bar";
import { api, type RouterOutputs } from "@/src/utils/api";
import { useHasProjectAccess } from "@/src/features/rbac";
import { showErrorToast, showSuccessToast } from "@/src/features/notifications";
import { AcmeLitellmRequestLogs } from "@/src/features/acme-enhancements/components/AcmeLitellmRequestLogs";
import { GatewayModelsCard } from "@/src/features/acme-enhancements/components/AcmeLitellmModelManager";

export type KeyRow = RouterOutputs["acmeLitellm"]["keys"]["keys"][number];

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function Banner({
  tone,
  title,
  children,
}: {
  tone: "warning" | "error" | "info";
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
      role={tone === "info" ? "status" : "alert"}
      className={`rounded-md border px-4 py-3 text-sm ${toneClass}`}
    >
      <p className="font-bold">{title}</p>
      <div className="mt-1 text-xs">{children}</div>
    </div>
  );
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? 6 : 2)}`;
}

function count(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : n.toLocaleString();
}

function when(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function KeyStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "ACTIVE":
      return <Badge variant="success">Active</Badge>;
    case "ROTATION_PARTIAL":
      return <Badge variant="error">Needs action</Badge>;
    case "PENDING":
      return <Badge variant="warning">Pending</Badge>;
    case "FAILED":
      return <Badge variant="error">Failed</Badge>;
    case "ROTATED":
      return <Badge variant="outline">Rotated</Badge>;
    default:
      return <Badge variant="outline">Revoked</Badge>;
  }
}

function DriftBadge({ row }: { row: KeyRow }) {
  if (row.drift === "in_sync") return <Badge variant="outline">In sync</Badge>;
  if (row.drift === "unknown") return <Badge variant="outline">Unknown</Badge>;
  if (row.drift === "missing")
    return <Badge variant="error">Missing in gateway</Badge>;
  return (
    <Badge variant="warning" title={row.driftFields.join(", ")}>
      Drifted: {row.driftFields.join(", ")}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Limits form (shared by keys and teams)
// ---------------------------------------------------------------------------

type LimitsState = {
  models: string[];
  maxBudget: string;
  budgetDuration: string;
  rpmLimit: string;
  tpmLimit: string;
};
const EMPTY_LIMITS: LimitsState = {
  models: [],
  maxBudget: "",
  budgetDuration: "none",
  rpmLimit: "",
  tpmLimit: "",
};

function parseLimits(s: LimitsState) {
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    models: s.models,
    maxBudget: num(s.maxBudget),
    budgetDuration: s.budgetDuration === "none" ? null : s.budgetDuration,
    rpmLimit: num(s.rpmLimit),
    tpmLimit: num(s.tpmLimit),
  };
}

function limitsError(s: LimitsState): string | null {
  for (const [label, v, integer] of [
    ["Budget", s.maxBudget, false],
    ["Requests per minute", s.rpmLimit, true],
    ["Tokens per minute", s.tpmLimit, true],
  ] as const) {
    if (v.trim() === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0)
      return `${label} must be a positive number, or empty for no limit.`;
    if (integer && !Number.isInteger(n))
      return `${label} must be a whole number.`;
  }
  return null;
}

function LimitsFields({
  idPrefix,
  value,
  onChange,
  availableModels,
}: {
  idPrefix: string;
  value: LimitsState;
  onChange: (next: LimitsState) => void;
  availableModels: string[];
}) {
  return (
    <>
      <div>
        <Label>Models this may call</Label>
        <p className="text-muted-foreground text-xs">
          None selected = every model in the catalogue.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {availableModels.length === 0 ? (
            <span className="text-muted-foreground text-xs">
              Model catalogue unavailable.
            </span>
          ) : (
            availableModels.map((m) => {
              const on = value.models.includes(m);
              return (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  aria-pressed={on}
                  onClick={() =>
                    onChange({
                      ...value,
                      models: on
                        ? value.models.filter((x) => x !== m)
                        : [...value.models, m],
                    })
                  }
                >
                  {m}
                </Button>
              );
            })
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div>
          <Label htmlFor={`${idPrefix}-budget`}>Budget (USD)</Label>
          <Input
            id={`${idPrefix}-budget`}
            className="mt-1.5"
            inputMode="decimal"
            placeholder="No limit"
            value={value.maxBudget}
            onChange={(e) => onChange({ ...value, maxBudget: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-duration`}>Budget resets</Label>
          <Select
            value={value.budgetDuration}
            onValueChange={(v) => onChange({ ...value, budgetDuration: v })}
          >
            <SelectTrigger id={`${idPrefix}-duration`} className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Never (lifetime budget)</SelectItem>
              <SelectItem value="1d">Daily</SelectItem>
              <SelectItem value="7d">Weekly</SelectItem>
              <SelectItem value="30d">Every 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-rpm`}>Requests / minute</Label>
          <Input
            id={`${idPrefix}-rpm`}
            className="mt-1.5"
            inputMode="numeric"
            placeholder="No limit"
            value={value.rpmLimit}
            onChange={(e) => onChange({ ...value, rpmLimit: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-tpm`}>Tokens / minute</Label>
          <Input
            id={`${idPrefix}-tpm`}
            className="mt-1.5"
            inputMode="numeric"
            placeholder="No limit"
            value={value.tpmLimit}
            onChange={(e) => onChange({ ...value, tpmLimit: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Secret reveal: shown exactly once
// ---------------------------------------------------------------------------

type Revealed = { title: string; alias: string; secret: string } | null;

function SecretRevealDialog({
  revealed,
  onClose,
}: {
  revealed: Revealed;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const close = () => {
    setCopied(false);
    setAcknowledged(false);
    onClose();
  };
  return (
    <Dialog
      open={revealed !== null}
      onOpenChange={(open) => (!open && acknowledged ? close() : undefined)}
    >
      <DialogContent
        closeOnInteractionOutside={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{revealed?.title}</DialogTitle>
          <DialogDescription>
            This is the only time this key is shown. CAIRO does not store it and
            cannot show it again. If it is lost, rotate the key.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Banner
            tone="warning"
            title="Copy it now and store it in your secret manager"
          >
            Anyone holding this key can spend against its budget. Do not paste
            it into chat, email or a ticket.
          </Banner>
          <Label className="mt-4 block" htmlFor="litellm-new-secret">
            {revealed?.alias}
          </Label>
          <div className="mt-1.5 flex gap-2">
            <Input
              id="litellm-new-secret"
              readOnly
              value={revealed?.secret ?? ""}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!revealed) return;
                navigator.clipboard
                  .writeText(revealed.secret)
                  .then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I have stored this key. I understand it will not be shown again.
          </label>
        </DialogBody>
        <DialogFooter>
          <Button type="button" disabled={!acknowledged} onClick={close}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit models / rpm limit (CHG-2026-030, ADR-0007)
//
// Deliberately narrow: models and rpmLimit only. maxBudget, budgetDuration
// and tpmLimit are not shown -- but updateKey's shared input schema defaults
// every field, so omitting one on submit does not leave it unchanged, it
// CLEARS it. The three unexposed fields are carried through from `row`
// unchanged on every submit; see submitEditLimits below. Do not "simplify"
// this by dropping them from the mutation call.
//
// Pre-fills from the gateway's live state (row.liveModels / row.liveRpmLimit),
// not CAIRO's row -- prefilling from CAIRO's stale values would let an
// operator "fix" drift by writing CAIRO's wrong value back onto the gateway.
// Falls back to CAIRO's row only when live data was not available for this
// row (row.drift is "unknown" or "missing"), and says so visibly.
// ---------------------------------------------------------------------------

// Exported for direct unit testing (AcmeLitellmGateway.clienttest.tsx) --
// no component render needed to prove the hazard this exists to prevent.
//
// updateKey's shared input schema (limitsInput, acmeLitellmRouter.ts)
// defaults every field it doesn't receive -- maxBudget/budgetDuration/
// tpmLimit are NOT optional-and-unchanged when omitted, they are CLEARED
// to their Zod defaults. This function is the one place that assembles the
// mutation payload, specifically so there is exactly one place that can get
// this wrong, not one per call site.
export function buildUpdateKeyLimitsInput(
  projectId: string,
  row: Pick<KeyRow, "id" | "maxBudget" | "budgetDuration" | "tpmLimit">,
  newModels: string[],
  newRpmLimit: string,
) {
  return {
    projectId,
    keyId: row.id,
    models: newModels,
    rpmLimit: newRpmLimit.trim() === "" ? null : Number(newRpmLimit),
    // Carried through unchanged -- not exposed as editable in this dialog,
    // but omitting them would clear them (see comment above).
    maxBudget: row.maxBudget,
    budgetDuration: row.budgetDuration,
    tpmLimit: row.tpmLimit,
  };
}

export function EditLimitsDialog({
  row,
  availableModels,
  busy,
  onClose,
  onSubmit,
}: {
  row: KeyRow | null;
  availableModels: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (row: KeyRow, models: string[], rpmLimit: string) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [rpmLimit, setRpmLimit] = useState("");

  const liveUnavailable =
    row !== null && (row.drift === "unknown" || row.drift === "missing");

  // Reset the form from live state whenever the dialog opens for a (new) row.
  // Keyed on row?.id, not on `row` itself, so re-renders from unrelated query
  // refetches while the dialog is open do not clobber what the admin typed.
  useEffect(() => {
    if (!row) return;
    const sourceModels = liveUnavailable ? row.models : (row.liveModels ?? []);
    const sourceRpm = liveUnavailable ? row.rpmLimit : row.liveRpmLimit;
    setModels(sourceModels);
    setRpmLimit(
      sourceRpm === null || sourceRpm === undefined ? "" : String(sourceRpm),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id]);

  const rpmError = (() => {
    if (rpmLimit.trim() === "") return null;
    const n = Number(rpmLimit);
    if (!Number.isFinite(n) || n <= 0)
      return "Requests per minute must be a positive number, or empty for no limit.";
    if (!Number.isInteger(n))
      return "Requests per minute must be a whole number.";
    return null;
  })();

  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit limits: {row?.displayName}</DialogTitle>
          <DialogDescription>
            Only the allowed models and the requests-per-minute limit can be
            changed here. Budget and token limits are unchanged by this form.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {liveUnavailable ? (
            <Banner tone="warning" title="Gateway state unavailable">
              Could not read this key&apos;s current state from the gateway. The
              fields below start from CAIRO&apos;s own record, which may not
              match the gateway.
            </Banner>
          ) : (
            <p className="text-muted-foreground text-xs">
              CAIRO currently records:{" "}
              {row && row.models.length ? row.models.join(", ") : "all models"},{" "}
              {row?.rpmLimit ? `${row.rpmLimit} rpm` : "no rpm limit"}.
              {row?.drift === "drifted" ? (
                <>
                  {" "}
                  <span className="font-bold">
                    This disagrees with the gateway — the fields below start
                    from the gateway&apos;s actual state.
                  </span>
                </>
              ) : null}
            </p>
          )}
          <div className="mt-3">
            <Label>Models this may call</Label>
            <p className="text-muted-foreground text-xs">
              None selected = every model in the catalogue.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {availableModels.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  Model catalogue unavailable.
                </span>
              ) : (
                availableModels.map((m) => {
                  const on = models.includes(m);
                  return (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      aria-pressed={on}
                      onClick={() =>
                        setModels(
                          on ? models.filter((x) => x !== m) : [...models, m],
                        )
                      }
                    >
                      {m}
                    </Button>
                  );
                })
              )}
            </div>
          </div>
          <div className="mt-3">
            <Label htmlFor="edit-limits-rpm">Requests / minute</Label>
            <Input
              id="edit-limits-rpm"
              className="mt-1.5"
              inputMode="numeric"
              placeholder="No limit"
              value={rpmLimit}
              onChange={(e) => setRpmLimit(e.target.value)}
            />
          </div>
          {rpmError ? (
            <p className="text-dark-red mt-2 text-xs">{rpmError}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || rpmError !== null || !row}
            onClick={() => row && onSubmit(row, models, rpmLimit)}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

type PendingAction = {
  kind: "revoke" | "rotate" | "resolve";
  row: KeyRow;
} | null;

function KeysTab({
  projectId,
  canManage,
  writable,
}: {
  projectId: string;
  canManage: boolean;
  writable: boolean;
}) {
  const utils = api.useUtils();
  const keys = api.acmeLitellm.keys.useQuery({ projectId });
  const teams = api.acmeLitellm.teams.useQuery({ projectId });
  const catalogue = api.acmeLitellm.catalogue.useQuery({ projectId });
  const unmanaged = api.acmeLitellm.unmanagedKeys.useQuery(
    { projectId },
    // FORBIDDEN means "not an organisation owner": the section is simply not
    // shown, so no error toast.
    { retry: false, meta: { silentHttpCodes: [403] } },
  );

  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("none");
  const [expiry, setExpiry] = useState("none");
  const [limits, setLimits] = useState<LimitsState>(EMPTY_LIMITS);
  const [revealed, setRevealed] = useState<Revealed>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [editing, setEditing] = useState<KeyRow | null>(null);

  const refresh = () => {
    utils.acmeLitellm.keys.invalidate({ projectId });
    utils.acmeLitellm.events.invalidate({ projectId });
    utils.acmeLitellm.spend.invalidate();
  };

  const create = api.acmeLitellm.createKey.useMutation({
    onSuccess: (out) => {
      setRevealed({
        title: "Key created",
        alias: out.key.alias,
        secret: out.secret,
      });
      setName("");
      setLimits(EMPTY_LIMITS);
      refresh();
    },
    onError: (e) => {
      showErrorToast("Key was not created", e.message);
      refresh();
    },
  });
  const revoke = api.acmeLitellm.revokeKey.useMutation({
    onSuccess: () => {
      showSuccessToast({
        title: "Key revoked",
        description: "It stopped working in the gateway immediately.",
      });
      refresh();
    },
    onError: (e) => {
      showErrorToast("Key was not revoked", e.message);
      refresh();
    },
  });
  const rotate = api.acmeLitellm.rotateKey.useMutation({
    onSuccess: (out) => {
      setRevealed({
        title: "Key rotated: new secret",
        alias: out.key.alias,
        secret: out.secret,
      });
      refresh();
    },
    onError: (e) => {
      showErrorToast("Rotation did not complete", e.message);
      refresh();
    },
  });
  const resolve = api.acmeLitellm.resolvePartialRotation.useMutation({
    onSuccess: () => {
      showSuccessToast({
        title: "Resolved",
        description:
          "The unrevealed new key was removed. The original key is active.",
      });
      refresh();
    },
    onError: (e) => {
      showErrorToast("Could not resolve", e.message);
      refresh();
    },
  });
  const updateLimits = api.acmeLitellm.updateKey.useMutation({
    onSuccess: () => {
      showSuccessToast({
        title: "Limits updated",
        description: "The gateway and CAIRO's own record now agree.",
      });
      setEditing(null);
      refresh();
    },
    onError: (e) => {
      showErrorToast("Limits were not updated", e.message);
    },
  });

  const models = (catalogue.data?.data ?? []).map((m) => m.modelName);
  const formError = limitsError(limits);
  const busy =
    create.isPending ||
    revoke.isPending ||
    rotate.isPending ||
    resolve.isPending ||
    updateLimits.isPending;

  const submitEditLimits = (
    row: KeyRow,
    newModels: string[],
    newRpmLimit: string,
  ) => {
    updateLimits.mutate(
      buildUpdateKeyLimitsInput(projectId, row, newModels, newRpmLimit),
    );
  };

  const confirmCopy: Record<
    NonNullable<PendingAction>["kind"],
    { title: string; body: string; action: string }
  > = {
    revoke: {
      title: "Revoke this key?",
      body: "Every application using it stops working immediately. This cannot be undone: a revoked key cannot be restored, only replaced.",
      action: "Revoke key",
    },
    rotate: {
      title: "Rotate this key?",
      body: "CAIRO creates a new key with the same settings and then deletes this one. The secret changes, so every application using it must be given the new secret. Both keys are valid for a moment in between. (LiteLLM's built-in rotation needs an Enterprise licence; this is CAIRO's own two-step equivalent.)",
      action: "Rotate key",
    },
    resolve: {
      title: "Remove the unrevealed new key?",
      body: "An earlier rotation created a new key but could not revoke this one, so two keys are live. This removes the new key, whose secret was never shown to anyone, and leaves this key active.",
      action: "Remove new key",
    },
  };

  return (
    <div className="flex flex-col gap-4">
      {keys.data && !keys.data.reachable ? (
        <Banner
          tone="warning"
          title="The gateway is unreachable: showing CAIRO's own records"
        >
          Live spend and drift are unknown, and keys cannot be created, rotated
          or revoked until it is back.
        </Banner>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Create a key</CardTitle>
            <p className="text-muted-foreground text-xs">
              The key is tagged in the gateway with this project and your user,
              and the action is written to the change record before you see the
              result.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <Label htmlFor="litellm-key-name">Name</Label>
                <Input
                  id="litellm-key-name"
                  className="mt-1.5"
                  maxLength={80}
                  placeholder="e.g. Claims chatbot, production"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="litellm-key-team">Team</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger id="litellm-key-team" className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No team</SelectItem>
                    {(teams.data?.teams ?? [])
                      .filter((t) => t.status === "ACTIVE")
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.teamAlias}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="litellm-key-expiry">Expires</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger id="litellm-key-expiry" className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Never</SelectItem>
                    <SelectItem value="30">In 30 days</SelectItem>
                    <SelectItem value="90">In 90 days</SelectItem>
                    <SelectItem value="365">In 1 year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <LimitsFields
              idPrefix="litellm-key"
              value={limits}
              onChange={setLimits}
              availableModels={models}
            />
            {formError ? (
              <p className="text-dark-red text-xs">{formError}</p>
            ) : null}
            <div>
              <Button
                disabled={
                  !writable || busy || name.trim() === "" || formError !== null
                }
                onClick={() =>
                  create.mutate({
                    projectId,
                    displayName: name.trim(),
                    teamId: teamId === "none" ? null : teamId,
                    expiresInDays: expiry === "none" ? null : Number(expiry),
                    ...parseLimits(limits),
                  })
                }
              >
                {create.isPending ? "Creating…" : "Create key"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Keys issued by this project</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {keys.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : keys.error ? (
            <Banner tone="error" title="Could not load keys">
              {keys.error.message}
            </Banner>
          ) : keys.data!.keys.length === 0 ? (
            <p className="text-muted-foreground text-sm">No keys yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Spend / budget</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.data!.keys.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-bold">{row.displayName}</div>
                      <div className="text-muted-foreground font-mono text-xs">
                        {row.alias}
                        {row.generation > 1
                          ? ` · generation ${row.generation}`
                          : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <KeyStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <DriftBadge row={row} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {money(row.liveSpend)} /{" "}
                      {row.maxBudget === null
                        ? "no limit"
                        : money(row.maxBudget)}
                      {row.budgetDuration ? ` per ${row.budgetDuration}` : ""}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.models.length ? row.models.join(", ") : "all models"}
                      <br />
                      {row.rpmLimit
                        ? `${count(row.rpmLimit)} rpm`
                        : "no rpm limit"}{" "}
                      ·{" "}
                      {row.tpmLimit
                        ? `${count(row.tpmLimit)} tpm`
                        : "no tpm limit"}
                      {row.expiresAt ? (
                        <>
                          <br />
                          expires {when(row.expiresAt)}
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {when(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {canManage && row.status === "ACTIVE" ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!writable || busy}
                            onClick={() => setEditing(row)}
                          >
                            Edit
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!writable || busy}
                            onClick={() => setPending({ kind: "rotate", row })}
                          >
                            Rotate
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={!writable || busy}
                            onClick={() => setPending({ kind: "revoke", row })}
                          >
                            Revoke
                          </Button>
                        </>
                      ) : null}
                      {canManage && row.status === "ROTATION_PARTIAL" ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!writable || busy}
                            onClick={() => setPending({ kind: "resolve", row })}
                          >
                            Resolve
                          </Button>{" "}
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={!writable || busy}
                            onClick={() => setPending({ kind: "revoke", row })}
                          >
                            Revoke
                          </Button>
                        </>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {unmanaged.data && unmanaged.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Keys created outside CAIRO ({unmanaged.data.length})
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              These exist in the gateway but were not issued by CAIRO, so they
              belong to no project and carry no record of who created them.
              Visible to organisation owners only. Read-only here.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alias</TableHead>
                  <TableHead>Models</TableHead>
                  <TableHead>Spend / budget</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmanaged.data.map((k) => (
                  <TableRow key={k.tokenHashPrefix}>
                    <TableCell className="font-mono text-xs">
                      {k.alias ?? `(no alias) ${k.tokenHashPrefix}…`}
                    </TableCell>
                    <TableCell className="text-xs">
                      {k.models.length ? k.models.join(", ") : "all models"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {money(k.spend)} /{" "}
                      {k.maxBudget === null ? "no limit" : money(k.maxBudget)}
                    </TableCell>
                    <TableCell className="text-xs">{when(k.expires)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => (!open ? setPending(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? confirmCopy[pending.kind].title : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-bold">{pending?.row.displayName}</span>
              <br />
              {pending ? confirmCopy[pending.kind].body : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pending) return;
                const input = { projectId, keyId: pending.row.id };
                if (pending.kind === "revoke") revoke.mutate(input);
                if (pending.kind === "rotate") rotate.mutate(input);
                if (pending.kind === "resolve") resolve.mutate(input);
                setPending(null);
              }}
            >
              {pending ? confirmCopy[pending.kind].action : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SecretRevealDialog
        revealed={revealed}
        onClose={() => setRevealed(null)}
      />

      <EditLimitsDialog
        row={editing}
        availableModels={models}
        busy={updateLimits.isPending}
        onClose={() => setEditing(null)}
        onSubmit={submitEditLimits}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

function TeamsTab({
  projectId,
  canManage,
  writable,
}: {
  projectId: string;
  canManage: boolean;
  writable: boolean;
}) {
  const utils = api.useUtils();
  const teams = api.acmeLitellm.teams.useQuery({ projectId });
  const catalogue = api.acmeLitellm.catalogue.useQuery({ projectId });
  const [alias, setAlias] = useState("");
  const [limits, setLimits] = useState<LimitsState>(EMPTY_LIMITS);
  const [toDelete, setToDelete] = useState<{
    id: string;
    teamAlias: string;
  } | null>(null);

  const refresh = () => {
    utils.acmeLitellm.teams.invalidate({ projectId });
    utils.acmeLitellm.events.invalidate({ projectId });
  };
  const create = api.acmeLitellm.createTeam.useMutation({
    onSuccess: () => {
      showSuccessToast({
        title: "Team created",
        description: "Keys can now be assigned to it.",
      });
      setAlias("");
      setLimits(EMPTY_LIMITS);
      refresh();
    },
    onError: (e) => {
      showErrorToast("Team was not created", e.message);
      refresh();
    },
  });
  const remove = api.acmeLitellm.deleteTeam.useMutation({
    onSuccess: () => {
      showSuccessToast({
        title: "Team deleted",
        description: "It was removed from the gateway.",
      });
      refresh();
    },
    onError: (e) => {
      showErrorToast("Team was not deleted", e.message);
      refresh();
    },
  });
  const formError = limitsError(limits);

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Create a team</CardTitle>
            <p className="text-muted-foreground text-xs">
              A team is a shared budget and rate limit for the keys assigned to
              it. It belongs to this project only. The gateway enforces a
              team&apos;s budget across all of its keys.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="md:w-1/3">
              <Label htmlFor="litellm-team-alias">Name</Label>
              <Input
                id="litellm-team-alias"
                className="mt-1.5"
                maxLength={80}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
              />
            </div>
            <LimitsFields
              idPrefix="litellm-team"
              value={limits}
              onChange={setLimits}
              availableModels={(catalogue.data?.data ?? []).map(
                (m) => m.modelName,
              )}
            />
            {formError ? (
              <p className="text-dark-red text-xs">{formError}</p>
            ) : null}
            <div>
              <Button
                disabled={
                  !writable ||
                  create.isPending ||
                  alias.trim() === "" ||
                  formError !== null
                }
                onClick={() =>
                  create.mutate({
                    projectId,
                    teamAlias: alias.trim(),
                    ...parseLimits(limits),
                  })
                }
              >
                {create.isPending ? "Creating…" : "Create team"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Teams</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {teams.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : teams.error ? (
            <Banner tone="error" title="Could not load teams">
              {teams.error.message}
            </Banner>
          ) : teams.data!.teams.length === 0 ? (
            <p className="text-muted-foreground text-sm">No teams yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Spend / budget</TableHead>
                  <TableHead>Limits</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.data!.teams.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-bold">{t.teamAlias}</TableCell>
                    <TableCell className="text-xs">
                      {money(t.liveSpend)} /{" "}
                      {t.maxBudget === null ? "no limit" : money(t.maxBudget)}
                      {t.budgetDuration ? ` per ${t.budgetDuration}` : ""}
                    </TableCell>
                    <TableCell className="text-xs">
                      {t.models.length ? t.models.join(", ") : "all models"} ·{" "}
                      {t.rpmLimit ? `${count(t.rpmLimit)} rpm` : "no rpm limit"}{" "}
                      ·{" "}
                      {t.tpmLimit ? `${count(t.tpmLimit)} tpm` : "no tpm limit"}
                    </TableCell>
                    <TableCell>
                      {t.missingInLitellm ? (
                        <Badge variant="error">Missing in gateway</Badge>
                      ) : null}
                      {t.hasLitellmAdmin ? (
                        <Badge
                          variant="error"
                          title="A LiteLLM team admin can manage keys outside CAIRO"
                        >
                          Has a gateway-side admin
                        </Badge>
                      ) : null}
                      {t.missingInLitellm === false && !t.hasLitellmAdmin ? (
                        <Badge variant="outline">In sync</Badge>
                      ) : null}
                      {t.missingInLitellm === null ? (
                        <Badge variant="outline">Unknown</Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={!writable || remove.isPending}
                          onClick={() =>
                            setToDelete({ id: t.id, teamAlias: t.teamAlias })
                          }
                        >
                          Delete
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => (!open ? setToDelete(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this team?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-bold">{toDelete?.teamAlias}</span>
              <br />
              The team is removed from the gateway. This is refused while the
              team still has live keys: revoke them first. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) remove.mutate({ projectId, teamId: toDelete.id });
                setToDelete(null);
              }}
            >
              Delete team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function StaleNote({
  fetchedAt,
  stale,
  reason,
}: {
  fetchedAt: string | null;
  stale: boolean;
  reason: string | null;
}) {
  if (!stale)
    return (
      <p className="text-muted-foreground text-xs">As of {when(fetchedAt)}.</p>
    );
  return (
    <Banner
      tone="warning"
      title={
        fetchedAt
          ? `The gateway is unreachable: showing the last answer, from ${when(fetchedAt)}`
          : "The gateway is unreachable and there is no earlier answer to show"
      }
    >
      {reason}
    </Banner>
  );
}

function ModelsTab({
  projectId,
  canManage,
  canManageModels,
  modelManagementEnabled,
  writable,
}: {
  projectId: string;
  canManage: boolean;
  canManageModels: boolean;
  modelManagementEnabled: boolean;
  writable: boolean;
}) {
  const [refresh, setRefresh] = useState(false);
  const catalogue = api.acmeLitellm.catalogue.useQuery({ projectId, refresh });
  return (
    <div className="flex flex-col gap-4">
      <GatewayModelsCard
        projectId={projectId}
        canManageModels={canManageModels}
        managementEnabled={modelManagementEnabled}
        writable={writable}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Model catalogue</CardTitle>
          <p className="text-muted-foreground text-xs">
            Whether each model&apos;s provider answered its last health check. A
            health check makes a real call to every provider, so the result is
            kept for 5 minutes.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          {catalogue.isLoading ? (
            <p className="text-muted-foreground text-sm">Checking providers…</p>
          ) : catalogue.error ? (
            <Banner tone="error" title="Could not load the catalogue">
              {catalogue.error.message}
            </Banner>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <StaleNote
                  fetchedAt={catalogue.data!.fetchedAt}
                  stale={catalogue.data!.stale}
                  reason={catalogue.data!.staleReason}
                />
                {canManage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={catalogue.isFetching}
                    onClick={() =>
                      refresh ? catalogue.refetch() : setRefresh(true)
                    }
                  >
                    {catalogue.isFetching ? "Checking…" : "Check health now"}
                  </Button>
                ) : null}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Health</TableHead>
                    <TableHead>Context</TableHead>
                    <TableHead>Price per 1M tokens (in / out)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(catalogue.data!.data ?? []).map((m) => (
                    <TableRow key={m.modelName}>
                      <TableCell className="font-bold">{m.modelName}</TableCell>
                      <TableCell className="text-xs">
                        {m.providers.join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        {m.health === "healthy" ? (
                          <Badge variant="success">Healthy</Badge>
                        ) : m.health === "unhealthy" ? (
                          <>
                            <Badge variant="error">Unhealthy</Badge>
                            <div className="text-muted-foreground mt-1 max-w-md text-xs break-words">
                              {m.healthError}
                            </div>
                          </>
                        ) : (
                          <Badge variant="outline">Unknown</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {count(m.maxInputTokens)} in /{" "}
                        {count(m.maxOutputTokens)} out
                      </TableCell>
                      <TableCell className="text-xs">
                        {m.inputCostPerToken === null
                          ? "—"
                          : money(m.inputCostPerToken * 1_000_000)}{" "}
                        /{" "}
                        {m.outputCostPerToken === null
                          ? "—"
                          : money(m.outputCostPerToken * 1_000_000)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function UsageTable<
  T extends {
    spend: number;
    requests: number;
    failedRequests: number;
    totalTokens: number;
  },
>({
  heading,
  rows,
  label,
}: {
  heading: string;
  rows: T[];
  label: (row: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{heading}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No usage in this period.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{label(r)}</TableCell>
                  <TableCell className="text-right">{money(r.spend)}</TableCell>
                  <TableCell className="text-right">
                    {count(r.requests)}
                  </TableCell>
                  <TableCell className="text-right">
                    {count(r.failedRequests)}
                  </TableCell>
                  <TableCell className="text-right">
                    {count(r.totalTokens)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SpendTab({ projectId }: { projectId: string }) {
  const [range, setRange] = useState("30");
  const end = new Date();
  const start = new Date(end.getTime() - (Number(range) - 1) * 86_400_000);
  const spend = api.acmeLitellm.spend.useQuery({
    projectId,
    startDate: isoDay(start),
    endDate: isoDay(end),
  });
  const data = spend.data?.data ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Label htmlFor="litellm-spend-range">Period</Label>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger id="litellm-spend-range" className="mt-1.5 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Today</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground max-w-xl text-right text-xs">
          Usage of this project&apos;s keys only, including revoked and rotated
          ones. Days are UTC. Cost is what the gateway calculated from its price
          list; a free-tier model costs $0.00 however much it is used, so
          requests and tokens are shown alongside.
        </p>
      </div>

      {spend.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : spend.error ? (
        <Banner tone="error" title="Could not load spend">
          {spend.error.message}
        </Banner>
      ) : (
        <>
          <StaleNote
            fetchedAt={spend.data!.fetchedAt}
            stale={spend.data!.stale}
            reason={spend.data!.staleReason}
          />
          {data ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ["Cost", money(data.totals.spend)],
                  ["Requests", count(data.totals.requests)],
                  ["Failed requests", count(data.totals.failedRequests)],
                  ["Tokens", count(data.totals.totalTokens)],
                ].map(([k, v]) => (
                  <Card key={k}>
                    <CardContent className="pt-4">
                      <div className="text-muted-foreground text-xs">{k}</div>
                      <div className="text-xl font-bold">{v}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <UsageTable
                heading="By key"
                rows={data.byKey}
                label={(r) => (
                  <>
                    {r.displayName}{" "}
                    {r.status !== "ACTIVE" ? (
                      <Badge variant="outline">{r.status.toLowerCase()}</Badge>
                    ) : null}
                  </>
                )}
              />
              <UsageTable
                heading="By team"
                rows={data.byTeam}
                label={(r) => r.teamAlias}
              />
              <UsageTable
                heading="By model"
                rows={data.byModel}
                label={(r) => r.model}
              />
              <UsageTable
                heading="By day (UTC)"
                rows={data.byDay}
                label={(r) => r.date}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change record
// ---------------------------------------------------------------------------

function EventsTab({ projectId }: { projectId: string }) {
  const [page, setPage] = useState(0);
  const limit = 50;
  const events = api.acmeLitellm.events.useQuery({ projectId, page, limit });
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Change record</CardTitle>
        <p className="text-muted-foreground text-xs">
          Every change CAIRO made to the gateway for this project. An
          &quot;intent&quot; row is written before the gateway is called and an
          &quot;outcome&quot; row before the user sees a result; rows of one
          operation share a correlation ID. CAIRO only adds rows here; it never
          edits or deletes them. It never contains a key.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {events.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : events.error ? (
          <Banner tone="error" title="Could not load the change record">
            {events.error.message}
          </Banner>
        ) : events.data!.events.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Phase</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Correlation</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.data!.events.map((e) => (
                  <Fragment key={e.id}>
                    <TableRow>
                      <TableCell className="text-xs whitespace-nowrap">
                        {when(e.eventTime)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {e.actor.name ?? e.actor.email ?? e.actor.id}
                        <div className="text-muted-foreground">
                          {e.actorProjectRole ?? e.actorOrgRole ?? ""}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.action}
                      </TableCell>
                      <TableCell>
                        {e.phase === "INTENT" ? (
                          <Badge variant="outline">Intent</Badge>
                        ) : e.outcome === "SUCCESS" ? (
                          <Badge variant="success">Succeeded</Badge>
                        ) : e.outcome === "PARTIAL" ? (
                          <Badge variant="error">Partial</Badge>
                        ) : (
                          <Badge variant="error">Failed</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.resourceType === "litellmTeam" ? "team" : "key"}{" "}
                        {e.resourceId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.correlationId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                        >
                          {open === e.id ? "Hide" : "Details"}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {open === e.id ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <pre className="bg-muted overflow-x-auto rounded p-3 text-xs">
                            {JSON.stringify(
                              {
                                correlationId: e.correlationId,
                                resourceId: e.resourceId,
                                error: e.errorMessage,
                                before: e.before,
                                after: e.after,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {page * limit + 1}–
                {Math.min((page + 1) * limit, events.data!.totalCount)} of{" "}
                {events.data!.totalCount}
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
                  disabled={(page + 1) * limit >= events.data!.totalCount}
                  onClick={() => setPage(page + 1)}
                >
                  Older
                </Button>
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page body
// ---------------------------------------------------------------------------

export function AcmeLitellmGateway({ projectId }: { projectId: string }) {
  const status = api.acmeLitellm.status.useQuery({ projectId });
  // ADR-0011 §6: each tab is shown only to roles that may use it. Keys, teams
  // and models: the operational scope or the Auditor's evidence scope. Spend:
  // the operational scope or the Spend-only scope (Business Analyst, Prompt
  // Analyst).
  const canReadOps = useHasProjectAccess({
    projectId,
    scope: "llmGateway:read",
  });
  const canReadEvidence = useHasProjectAccess({
    projectId,
    scope: "evidence:read",
  });
  const canReadSpendOnly = useHasProjectAccess({
    projectId,
    scope: "llmGatewaySpend:read",
  });
  const canRead = canReadOps || canReadEvidence;
  const canReadSpend = canReadOps || canReadSpendOnly;
  const canManage = useHasProjectAccess({ projectId, scope: "llmGateway:CUD" });
  const canManageModels = useHasProjectAccess({
    projectId,
    scope: "llmGatewayModels:CUD",
  });
  const canReadLogs = useHasProjectAccess({
    projectId,
    scope: "llmGatewayLogs:read",
  });

  if (status.isLoading)
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (status.error) {
    return (
      <Banner tone="error" title="Could not load the gateway status">
        {status.error.message}
      </Banner>
    );
  }
  const s = status.data!;

  if (!s.enabled) {
    return (
      <Banner
        tone="info"
        title="LLM Gateway management is switched off on this deployment"
      >
        Nothing here is active and CAIRO is not calling the gateway. An operator
        turns it on with CAIRO_LITELLM_MANAGEMENT_ENABLED.
      </Banner>
    );
  }
  if (!s.configured) {
    return (
      <Banner
        tone="error"
        title="LLM Gateway management is switched on but not configured"
      >
        The gateway address or its admin credential is not set on the server.
        Nothing can be read or changed until an operator sets them.
      </Banner>
    );
  }
  if (!canRead && !canReadSpend && !canReadLogs) {
    return (
      <Banner
        tone="info"
        title="You do not have access to the LLM Gateway in this project"
      >
        Ask a project owner or admin.
      </Banner>
    );
  }

  // Mutations need the gateway AND the append-only record. Without the
  // record's writer connection the server refuses every change anyway; say so
  // up front instead of letting each button fail.
  const writable = s.reachable === true && s.auditConfigured;
  const firstTab = canRead ? "keys" : canReadSpend ? "spend" : "record";

  return (
    <div className="flex flex-col gap-4">
      {s.reachable === false ? (
        <Banner
          tone="warning"
          title="The LLM gateway is unreachable: this page is read-only"
        >
          CAIRO&apos;s own records and the last answers it received are shown,
          marked with their age. Keys already issued are not affected by CAIRO
          being unable to reach the gateway&apos;s management API. Nothing can
          be created, rotated or revoked until the gateway is back.
        </Banner>
      ) : null}
      {s.reachable !== false && !s.auditConfigured ? (
        <Banner
          tone="error"
          title="Changes are disabled: the change record is not configured"
        >
          CAIRO refuses to change the gateway unless it can first write the
          change to its append-only record. An operator must set the
          record&apos;s database connection (RAYIN_LITELLM_WRITER_DATABASE_URL).
        </Banner>
      ) : null}

      <TabsBar defaultValue={firstTab}>
        <TabsBarList>
          {canRead ? <TabsBarTrigger value="keys">Keys</TabsBarTrigger> : null}
          {canRead ? (
            <TabsBarTrigger value="teams">Teams</TabsBarTrigger>
          ) : null}
          {canRead ? (
            <TabsBarTrigger value="models">Models</TabsBarTrigger>
          ) : null}
          {canReadSpend ? (
            <TabsBarTrigger value="spend">Spend</TabsBarTrigger>
          ) : null}
          {canReadLogs ? (
            <TabsBarTrigger value="record">Change record</TabsBarTrigger>
          ) : null}
          {canReadLogs && s.requestLogsEnabled ? (
            <TabsBarTrigger value="requests">Requests</TabsBarTrigger>
          ) : null}
        </TabsBarList>
        {canRead ? (
          <>
            <TabsBarContent value="keys" className="mt-6">
              <KeysTab
                projectId={projectId}
                canManage={canManage}
                writable={writable}
              />
            </TabsBarContent>
            <TabsBarContent value="teams" className="mt-6">
              <TeamsTab
                projectId={projectId}
                canManage={canManage}
                writable={writable}
              />
            </TabsBarContent>
            <TabsBarContent value="models" className="mt-6">
              <ModelsTab
                projectId={projectId}
                canManage={canManage}
                canManageModels={canManageModels}
                modelManagementEnabled={s.modelManagementEnabled}
                writable={writable}
              />
            </TabsBarContent>
          </>
        ) : null}
        {canReadSpend ? (
          <TabsBarContent value="spend" className="mt-6">
            <SpendTab projectId={projectId} />
          </TabsBarContent>
        ) : null}
        {canReadLogs ? (
          <TabsBarContent value="record" className="mt-6">
            <EventsTab projectId={projectId} />
          </TabsBarContent>
        ) : null}
        {canReadLogs && s.requestLogsEnabled ? (
          <TabsBarContent value="requests" className="mt-6">
            <AcmeLitellmRequestLogs projectId={projectId} />
          </TabsBarContent>
        ) : null}
      </TabsBar>
    </div>
  );
}
