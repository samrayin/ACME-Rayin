import { useState } from "react";
import Page from "@/src/components/layouts/page";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent } from "@/src/components/ui/card";
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
import useProjectIdFromURL from "@/src/hooks/useProjectIdFromURL";
import { api } from "@/src/utils/api";
import { EyeonCard } from "@/src/features/acme-enhancements/components/eyeon/EyeonCard";
import {
  SPEND_WINDOWS,
  type SpendWindow,
  WINDOW_WORDS,
  formatCount,
  formatUsd,
} from "@/src/features/acme-enhancements/utils/eyeonSpendLabels";

// ACME (ADR-0027): the EYEON Usage drill-down. Three levels on one page, each
// a click on a row of the last: applications (calls, tokens, cost, flagged
// prompts), then the people using the chosen application, then the types of
// prompt the chosen person sent that the guardrails flagged. Metadata only;
// the user id is the one the caller reported, and no prompt text is shown.

const headerProps = {
  title: "Usage drill-down",
  help: {
    description:
      "Start with the applications and what they cost. Click an application " +
      "to see who uses it and what each person costs, then click a person " +
      "to see what kinds of prompt they sent: malicious, personal data and " +
      "so on. Counts and costs only; prompt text is never shown.",
  },
};

/** Where the reader is: nothing chosen, an application, or a user of it. */
type Path = {
  app: { lineageId: string; name: string } | null;
  user: string | null;
};

const NO_USER_LABEL = "(user not reported)";

export default function EyeonUsageDrilldownPage() {
  const projectId = useProjectIdFromURL();
  return (
    <Page headerProps={headerProps} scrollable withPadding>
      {projectId ? <Drilldown projectId={projectId} /> : null}
    </Page>
  );
}

function Drilldown({ projectId }: { projectId: string }) {
  const [window, setWindow] = useState<SpendWindow>("7d");
  const [path, setPath] = useState<Path>({ app: null, user: null });

  const status = api.eyeonUsageDrilldown.status.useQuery({ projectId });
  if (status.isPending) return <Note>Loading…</Note>;
  if (status.isError) {
    return <Note>Could not load usage: {status.error.message}</Note>;
  }
  if (!status.data.enabled) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-4 text-sm">
          The EYEON Usage drill-down is switched off on this deployment.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb path={path} onChange={setPath} />
        <Select
          value={window}
          onValueChange={(v) =>
            setWindow(SPEND_WINDOWS.find((w) => w === v) ?? "7d")
          }
        >
          <SelectTrigger className="w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEND_WINDOWS.map((w) => (
              <SelectItem key={w} value={w}>
                {WINDOW_WORDS[w].option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {path.app && path.user !== null ? (
        <PromptTypesLevel
          projectId={projectId}
          window={window}
          app={path.app}
          user={path.user}
        />
      ) : path.app ? (
        <UsersLevel
          projectId={projectId}
          window={window}
          app={path.app}
          onUser={(user) => setPath({ app: path.app, user })}
        />
      ) : (
        <ApplicationsLevel
          projectId={projectId}
          window={window}
          onApp={(app) => setPath({ app, user: null })}
        />
      )}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground p-4 text-sm">{children}</div>;
}

function Breadcrumb({
  path,
  onChange,
}: {
  path: Path;
  onChange: (p: Path) => void;
}) {
  return (
    <nav
      aria-label="Drill-down path"
      className="flex items-center gap-1 text-sm"
    >
      <Button
        variant="link"
        className="h-auto p-0"
        disabled={!path.app}
        onClick={() => onChange({ app: null, user: null })}
      >
        All applications
      </Button>
      {path.app ? (
        <>
          <span className="text-muted-foreground">/</span>
          <Button
            variant="link"
            className="h-auto p-0"
            disabled={path.user === null}
            onClick={() => onChange({ app: path.app, user: null })}
          >
            {path.app.name}
          </Button>
        </>
      ) : null}
      {path.user !== null ? (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold">{path.user || NO_USER_LABEL}</span>
        </>
      ) : null}
    </nav>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return <TableCell className="text-right tabular-nums">{children}</TableCell>;
}

function Head({ cols }: { cols: string[] }) {
  return (
    <TableHeader>
      <TableRow>
        {cols.map((c, i) => (
          <TableHead key={c} className={i === 0 ? "" : "text-right"}>
            {c}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

function ClickRow({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <TableRow
      className="hover:bg-muted/50 cursor-pointer"
      tabIndex={0}
      role="button"
      aria-label={label}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </TableRow>
  );
}

function ApplicationsLevel({
  projectId,
  window,
  onApp,
}: {
  projectId: string;
  window: SpendWindow;
  onApp: (app: { lineageId: string; name: string }) => void;
}) {
  const q = api.eyeonUsageDrilldown.applications.useQuery(
    { projectId, window },
    { placeholderData: (previous) => previous },
  );
  if (q.isPending) return <Note>Loading…</Note>;
  if (q.isError) return <Note>Could not load: {q.error.message}</Note>;
  if (!q.data.enabled) return <Note>Switched off.</Note>;
  if (!q.data.requestLog) {
    return (
      <Note>
        The gateway request log is switched off on this deployment, so there is
        no usage to show.
      </Note>
    );
  }
  const apps = q.data.applications;
  const total = apps.reduce((n, a) => n + a.spendUsd, 0);
  return (
    <EyeonCard
      title="Applications"
      subtitle={`Total usage and cost by application, ${WINDOW_WORDS[window].option.toLowerCase()}. Click one to see its users.`}
      footnote={`Total ${formatUsd(total)}. Cost is the gateway's price per call.`}
    >
      {apps.length === 0 ? (
        <Note>No gateway calls in this period.</Note>
      ) : (
        <Table>
          <Head
            cols={[
              "Application",
              "Calls",
              "Tokens",
              "Cost",
              "Prompts checked",
              "Flagged",
            ]}
          />
          <TableBody>
            {apps.map((a) => {
              const lineageId = a.lineageId;
              const row = (
                <>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <Num>{formatCount(a.calls)}</Num>
                  <Num>{formatCount(a.totalTokens)}</Num>
                  <Num>{formatUsd(a.spendUsd)}</Num>
                  <Num>{formatCount(a.checks)}</Num>
                  <Num>{formatCount(a.flagged)}</Num>
                </>
              );
              return lineageId ? (
                <ClickRow
                  key={lineageId}
                  label={`Show users of ${a.name}`}
                  onClick={() => onApp({ lineageId, name: a.name })}
                >
                  {row}
                </ClickRow>
              ) : (
                <TableRow key="other" className="text-muted-foreground">
                  {row}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </EyeonCard>
  );
}

function UsersLevel({
  projectId,
  window,
  app,
  onUser,
}: {
  projectId: string;
  window: SpendWindow;
  app: { lineageId: string; name: string };
  onUser: (user: string) => void;
}) {
  const q = api.eyeonUsageDrilldown.users.useQuery(
    { projectId, window, lineageId: app.lineageId },
    { placeholderData: (previous) => previous },
  );
  if (q.isPending) return <Note>Loading…</Note>;
  if (q.isError) return <Note>Could not load: {q.error.message}</Note>;
  if (!q.data.enabled) return <Note>Switched off.</Note>;
  const users = q.data.users;
  const total = users.reduce((n, u) => n + u.spendUsd, 0);
  return (
    <EyeonCard
      title={`Users of ${app.name}`}
      subtitle="Who uses this application and what each person costs. Click a user to see what kinds of prompt they sent."
      footnote={`Total ${formatUsd(total)}. The user is the id the caller reported; it is not verified against the sign-in.`}
    >
      {users.length === 0 ? (
        <Note>No calls or checks for this application in this period.</Note>
      ) : (
        <Table>
          <Head
            cols={[
              "User",
              "Calls",
              "Tokens",
              "Cost",
              "Prompts checked",
              "Flagged",
            ]}
          />
          <TableBody>
            {users.map((u) => (
              <ClickRow
                key={u.user || "none"}
                label={`Show prompt types for ${u.user || NO_USER_LABEL}`}
                onClick={() => onUser(u.user)}
              >
                <TableCell className="font-medium">
                  {u.user || NO_USER_LABEL}
                </TableCell>
                <Num>{formatCount(u.calls)}</Num>
                <Num>{formatCount(u.totalTokens)}</Num>
                <Num>{formatUsd(u.spendUsd)}</Num>
                <Num>{formatCount(u.checks)}</Num>
                <Num>{formatCount(u.flagged)}</Num>
              </ClickRow>
            ))}
          </TableBody>
        </Table>
      )}
    </EyeonCard>
  );
}

function PromptTypesLevel({
  projectId,
  window,
  app,
  user,
}: {
  projectId: string;
  window: SpendWindow;
  app: { lineageId: string; name: string };
  user: string;
}) {
  const q = api.eyeonUsageDrilldown.promptTypes.useQuery(
    { projectId, window, lineageId: app.lineageId, user },
    { placeholderData: (previous) => previous },
  );
  if (q.isPending) return <Note>Loading…</Note>;
  if (q.isError) return <Note>Could not load: {q.error.message}</Note>;
  if (!q.data.enabled) return <Note>Switched off.</Note>;
  const d = q.data;
  const flagged = d.types.reduce((n, t) => n + t.total, 0);
  return (
    <EyeonCard
      title={`Prompt types: ${user || NO_USER_LABEL}`}
      subtitle={`What the guardrails found in this person's prompts to ${app.name}.`}
      footnote="Counts only. The type comes from the guardrail's policy label; prompt text is never shown."
    >
      {d.checked === 0 ? (
        <Note>No prompts from this user were checked in this period.</Note>
      ) : (
        <>
          <p className="text-sm">
            {formatCount(d.checked)} prompts checked:{" "}
            <strong>{formatCount(flagged)} flagged</strong>,{" "}
            {formatCount(d.clean)} clean
            {d.noVerdict > 0
              ? `, ${formatCount(d.noVerdict)} with no verdict`
              : ""}
            .
          </p>
          {d.types.length === 0 ? (
            <Note>Nothing was flagged.</Note>
          ) : (
            <Table>
              <Head cols={["Type", "Blocked", "Redacted", "Total"]} />
              <TableBody>
                {d.types.map((t) => (
                  <TableRow key={t.type}>
                    <TableCell className="font-medium">{t.label}</TableCell>
                    <Num>{formatCount(t.blocked)}</Num>
                    <Num>{formatCount(t.redacted)}</Num>
                    <Num>{formatCount(t.total)}</Num>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </EyeonCard>
  );
}
