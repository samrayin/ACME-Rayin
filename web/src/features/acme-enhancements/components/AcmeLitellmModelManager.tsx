/**
 * ACME addition (ADR-0010, CHG-2026-056): add, edit and delete gateway models
 * and endpoints, and the smart (complexity) router.
 *
 * Provider-key rules for this file:
 *  - A typed provider key lives only in the `secret` state of <ModelDialog>,
 *    from typing until the dialog closes or the save returns. It is a
 *    password field, never pre-filled, never put in a toast, the URL or a
 *    query cache, and the server never sends one back.
 *  - The server applies every rule (endpoint allowlist, providers, protected
 *    models). This file only explains them.
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
import { api, type RouterOutputs } from "@/src/utils/api";
import { showErrorToast, showSuccessToast } from "@/src/features/notifications";

export type ModelRow = RouterOutputs["acmeLitellm"]["models"][number];

const TIERS = ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"] as const;
type Tier = (typeof TIERS)[number];

const TIER_HELP: Record<Tier, string> = {
  SIMPLE: "Greetings and short factual questions",
  MEDIUM: "Everyday requests",
  COMPLEX: "Technical or multi-part requests",
  REASONING: "Step-by-step reasoning and analysis",
};

type CredentialKind = "keep" | "secret" | "reference" | "none";

function optionalInt(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

// ---------------------------------------------------------------------------
// Model dialog (add and edit)
// ---------------------------------------------------------------------------

function ModelDialog({
  projectId,
  editing,
  open,
  onClose,
  onSaved,
}: {
  projectId: string;
  editing: ModelRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.modelName ?? "");
  const [providerModel, setProviderModel] = useState(
    editing?.providerModel ?? "",
  );
  const [apiBase, setApiBase] = useState(editing?.apiBase ?? "");
  const [apiVersion, setApiVersion] = useState(editing?.apiVersion ?? "");
  const [rpm, setRpm] = useState(editing?.rpm ? String(editing.rpm) : "");
  const [tpm, setTpm] = useState(editing?.tpm ? String(editing.tpm) : "");
  const [kind, setKind] = useState<CredentialKind>(editing ? "keep" : "secret");
  const [secret, setSecret] = useState("");
  const [reference, setReference] = useState("");

  const close = () => {
    setSecret("");
    onClose();
  };
  const onDone = {
    onSuccess: () => {
      setSecret("");
      showSuccessToast({
        title: editing ? "Model updated" : "Model added",
        description: "The gateway is serving the change now.",
      });
      onSaved();
      onClose();
    },
    onError: (e: { message: string }) => {
      showErrorToast(
        editing ? "Model was not updated" : "Model was not added",
        e.message,
      );
    },
  };
  const create = api.acmeLitellm.createModel.useMutation(onDone);
  const update = api.acmeLitellm.updateModel.useMutation(onDone);
  const pending = create.isPending || update.isPending;

  const rpmN = optionalInt(rpm);
  const tpmN = optionalInt(tpm);
  const error =
    name.trim() === ""
      ? "Give the model a name."
      : !/^[a-z0-9_]+\/.+/i.test(providerModel.trim())
        ? 'The provider model looks like "provider/model", e.g. "groq/llama-3.3-70b-versatile".'
        : Number.isNaN(rpmN) || Number.isNaN(tpmN)
          ? "Limits must be whole numbers above zero, or empty."
          : kind === "secret" && secret.trim() === ""
            ? "Enter the provider key, or choose another option."
            : kind === "reference" && reference.trim() === ""
              ? "Enter the name of the key in the gateway Secret."
              : null;

  const submit = () => {
    const credential =
      kind === "secret"
        ? { kind, value: secret }
        : kind === "reference"
          ? { kind, name: reference.trim() }
          : { kind };
    const body = {
      projectId,
      modelName: name.trim(),
      providerModel: providerModel.trim(),
      apiBase: apiBase.trim() === "" ? null : apiBase.trim(),
      apiVersion: apiVersion.trim() === "" ? null : apiVersion.trim(),
      rpm: rpmN,
      tpm: tpmN,
      credential,
    };
    if (editing) update.mutate({ ...body, modelId: editing.id });
    else create.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? close() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit model" : "Add a model"}</DialogTitle>
          <DialogDescription>
            Keys and teams choose models by this name. Every change is written
            to the change record first.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div>
            <Label htmlFor="model-name">Name</Label>
            <Input
              id="model-name"
              className="mt-1.5"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="model-provider">Provider model</Label>
            <Input
              id="model-provider"
              className="mt-1.5"
              placeholder="groq/llama-3.3-70b-versatile"
              maxLength={220}
              value={providerModel}
              onChange={(e) => setProviderModel(e.target.value)}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Providers allowed: anthropic, openrouter, groq, gemini, openai,
              azure.
            </p>
          </div>
          <div>
            <Label htmlFor="model-endpoint">Endpoint (optional)</Label>
            <Input
              id="model-endpoint"
              className="mt-1.5"
              placeholder="Leave empty for the provider's default endpoint"
              maxLength={500}
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              https only, and only approved provider hosts. Private and internal
              addresses are refused.
            </p>
          </div>
          {providerModel.trim().startsWith("azure/") ? (
            <div>
              <Label htmlFor="model-api-version">API version</Label>
              <Input
                id="model-api-version"
                className="mt-1.5"
                placeholder="2024-10-21"
                maxLength={40}
                value={apiVersion}
                onChange={(e) => setApiVersion(e.target.value)}
              />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="model-rpm">Requests per minute</Label>
              <Input
                id="model-rpm"
                className="mt-1.5"
                inputMode="numeric"
                placeholder="no limit"
                value={rpm}
                onChange={(e) => setRpm(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="model-tpm">Tokens per minute</Label>
              <Input
                id="model-tpm"
                className="mt-1.5"
                inputMode="numeric"
                placeholder="no limit"
                value={tpm}
                onChange={(e) => setTpm(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="model-credential">Provider key</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as CredentialKind);
                setSecret("");
              }}
            >
              <SelectTrigger id="model-credential" className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {editing ? (
                  <SelectItem value="keep">Keep the stored key</SelectItem>
                ) : null}
                <SelectItem value="secret">Enter a key</SelectItem>
                <SelectItem value="reference">
                  Use a key from the gateway Secret
                </SelectItem>
                {!editing ? (
                  <SelectItem value="none">
                    Provider default from the gateway
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            {kind === "secret" ? (
              <>
                <Input
                  aria-label="Provider key"
                  className="mt-1.5"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Sent once to the gateway, which stores it encrypted. CAIRO
                  does not keep it, and nobody can read it back.
                </p>
              </>
            ) : null}
            {kind === "reference" ? (
              <Input
                aria-label="Key name in the gateway Secret"
                className="mt-1.5"
                placeholder="GROQ_API_KEY"
                maxLength={64}
                value={reference}
                onChange={(e) => setReference(e.target.value.toUpperCase())}
              />
            ) : null}
          </div>
          {error ? <p className="text-dark-red text-xs">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={pending || error !== null} onClick={submit}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Smart router dialog (add, edit, test)
// ---------------------------------------------------------------------------

function RouterDialog({
  projectId,
  editing,
  models,
  open,
  onClose,
  onSaved,
}: {
  projectId: string;
  editing: ModelRow | null;
  models: string[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const first = models[0] ?? "";
  const [name, setName] = useState(editing?.modelName ?? "smart-router");
  const [tiers, setTiers] = useState<Record<Tier, string>>({
    SIMPLE: editing?.tiers?.SIMPLE ?? first,
    MEDIUM: editing?.tiers?.MEDIUM ?? first,
    COMPLEX: editing?.tiers?.COMPLEX ?? first,
    REASONING: editing?.tiers?.REASONING ?? first,
  });
  const [defaultModel, setDefaultModel] = useState(
    editing?.defaultModel ?? first,
  );
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const onDone = {
    onSuccess: () => {
      showSuccessToast({
        title: editing ? "Router updated" : "Router added",
        description: "Callers can use it by its name.",
      });
      onSaved();
      onClose();
    },
    onError: (e: { message: string }) => {
      showErrorToast(
        editing ? "Router was not updated" : "Router was not added",
        e.message,
      );
    },
  };
  const create = api.acmeLitellm.createRouter.useMutation(onDone);
  const update = api.acmeLitellm.updateRouter.useMutation(onDone);
  const test = api.acmeLitellm.testRouting.useMutation({
    onSuccess: (r) =>
      setResult(`${r.tier ? `${r.tier} → ` : ""}${r.routedModel}`),
    onError: (e) => setResult(`Test failed: ${e.message}`),
  });
  const pending = create.isPending || update.isPending;
  const error =
    name.trim() === ""
      ? "Give the router a name."
      : [...Object.values(tiers), defaultModel].some((m) => m === "")
        ? "Choose a model for every tier and a default."
        : null;

  const modelSelect = (id: string, value: string, set: (v: string) => void) => (
    <Select value={value} onValueChange={set}>
      <SelectTrigger id={id} className="mt-1.5">
        <SelectValue placeholder="Choose a model" />
      </SelectTrigger>
      <SelectContent>
        {models.map((m) => (
          <SelectItem key={m} value={m}>
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit smart router" : "Add a smart router"}
          </DialogTitle>
          <DialogDescription>
            Callers use the router&apos;s name as the model. The gateway scores
            each request on the spot (no call out, under a millisecond) and
            sends it to the model for its tier. Guardrails still check every
            request.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div>
            <Label htmlFor="router-name">Name</Label>
            <Input
              id="router-name"
              className="mt-1.5"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {TIERS.map((t) => (
            <div key={t}>
              <Label htmlFor={`router-tier-${t}`}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  {TIER_HELP[t]}
                </span>
              </Label>
              {modelSelect(`router-tier-${t}`, tiers[t], (v) =>
                setTiers({ ...tiers, [t]: v }),
              )}
            </div>
          ))}
          <div>
            <Label htmlFor="router-default">Default model</Label>
            {modelSelect("router-default", defaultModel, setDefaultModel)}
            <p className="text-muted-foreground mt-1 text-xs">
              Used when a request can&apos;t be scored.
            </p>
          </div>
          <div className="border-border rounded-md border p-3">
            <Label htmlFor="router-test">Test routing</Label>
            <Input
              id="router-test"
              className="mt-1.5"
              placeholder="Type a sample prompt"
              maxLength={4000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={
                  test.isPending || prompt.trim() === "" || error !== null
                }
                onClick={() =>
                  test.mutate({ projectId, tiers, defaultModel, prompt })
                }
              >
                {test.isPending ? "Testing…" : "Test"}
              </Button>
              {result ? <span className="text-xs">{result}</span> : null}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Shows where the prompt would go. Nothing is sent to a model or
              stored.
            </p>
          </div>
          {error ? <p className="text-dark-red text-xs">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || error !== null}
            onClick={() => {
              const body = {
                projectId,
                modelName: name.trim(),
                tiers,
                defaultModel,
              };
              if (editing) update.mutate({ ...body, modelId: editing.id });
              else create.mutate(body);
            }}
          >
            {pending ? "Saving…" : editing ? "Save changes" : "Add router"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function GatewayModelsCard({
  projectId,
  canManageModels,
  managementEnabled,
  writable,
}: {
  projectId: string;
  canManageModels: boolean;
  managementEnabled: boolean;
  writable: boolean;
}) {
  const utils = api.useUtils();
  const models = api.acmeLitellm.models.useQuery({ projectId });
  const [modelDialog, setModelDialog] = useState<{
    editing: ModelRow | null;
  } | null>(null);
  const [routerDialog, setRouterDialog] = useState<{
    editing: ModelRow | null;
  } | null>(null);
  const [toDelete, setToDelete] = useState<ModelRow | null>(null);

  const refresh = () => {
    utils.acmeLitellm.models.invalidate({ projectId });
    utils.acmeLitellm.catalogue.invalidate({ projectId });
    utils.acmeLitellm.events.invalidate({ projectId });
  };
  const remove = api.acmeLitellm.deleteModel.useMutation({
    onSuccess: () => {
      showSuccessToast({
        title: "Removed",
        description: "It was removed from the gateway.",
      });
      refresh();
    },
    onError: (e) => showErrorToast("Not removed", e.message),
  });

  const manage = managementEnabled && canManageModels;
  const rows = models.data ?? [];
  const routable = rows
    .filter((m) => m.kind === "model")
    .map((m) => m.modelName)
    .sort();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Gateway models</CardTitle>
        <p className="text-muted-foreground text-xs">
          {manage
            ? "Models from the gateway configuration are read-only. Models and smart routers added here can be edited or removed. Guardrails models can't be changed from here."
            : managementEnabled
              ? "Only project owners and admins can add or change models."
              : "Model management is switched off on this deployment: models are set in the gateway configuration."}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {manage ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!writable}
              onClick={() => setModelDialog({ editing: null })}
            >
              Add model
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!writable || routable.length === 0}
              onClick={() => setRouterDialog({ editing: null })}
            >
              Add smart router
            </Button>
          </div>
        ) : null}
        {models.isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : models.error ? (
          <p className="text-dark-red text-sm">{models.error.message}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Serves</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Source</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id || m.modelName}>
                  <TableCell className="font-bold">
                    {m.modelName}
                    {m.protected ? (
                      <Badge variant="outline" className="ml-2">
                        Guardrails
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">
                    {m.kind === "router" ? (
                      <>
                        <Badge variant="outline" className="mr-2">
                          Smart router
                        </Badge>
                        {TIERS.map(
                          (t) => `${t.toLowerCase()}: ${m.tiers?.[t] ?? "—"}`,
                        ).join(" · ")}
                      </>
                    ) : (
                      m.providerModel
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {m.apiBaseHost ?? "provider default"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {m.source === "config" ? "Configuration" : "Console"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {manage && m.source === "console" && !m.protected ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!writable}
                          onClick={() =>
                            m.kind === "router"
                              ? setRouterDialog({ editing: m })
                              : setModelDialog({ editing: m })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            !writable ||
                            remove.isPending ||
                            m.usedByRouters.length > 0
                          }
                          title={
                            m.usedByRouters.length > 0
                              ? `Used by ${m.usedByRouters.join(", ")}`
                              : undefined
                          }
                          onClick={() => setToDelete(m)}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {modelDialog ? (
        <ModelDialog
          key={modelDialog.editing?.id ?? "new"}
          projectId={projectId}
          editing={modelDialog.editing}
          open
          onClose={() => setModelDialog(null)}
          onSaved={refresh}
        />
      ) : null}
      {routerDialog ? (
        <RouterDialog
          key={routerDialog.editing?.id ?? "new"}
          projectId={projectId}
          editing={routerDialog.editing}
          models={routable}
          open
          onClose={() => setRouterDialog(null)}
          onSaved={refresh}
        />
      ) : null}

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(o) => (!o ? setToDelete(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove this {toDelete?.kind === "router" ? "router" : "model"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-bold">{toDelete?.modelName}</span>
              <br />
              Requests that name it will fail. Keys and teams that list it keep
              the name until you edit them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete)
                  remove.mutate({ projectId, modelId: toDelete.id });
                setToDelete(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
