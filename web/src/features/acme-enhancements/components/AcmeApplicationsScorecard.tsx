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
import { api, type RouterOutputs } from "@/src/utils/api";

// ACME (CHG-2026-122, ADR-0023): one scorecard per connected application (a
// gateway key lineage), plus a summary for the whole project. Metadata only.

type Scorecards = Extract<
  RouterOutputs["acmeApplications"]["scorecards"],
  { enabled: true }
>;
type Application = Scorecards["applications"][number];
type Band = Application["overall"];
type Dimension = Application["dimensions"][number]["dimension"];

const BAND_LABEL: Record<Band, string> = {
  green: "On track",
  amber: "Watch",
  red: "Act now",
  none: "Not rated",
};

const BAND_VARIANT: Record<
  Band,
  "success" | "warning" | "error" | "secondary"
> = {
  green: "success",
  amber: "warning",
  red: "error",
  none: "secondary",
};

const DIMENSION_LABEL: Record<Dimension, string> = {
  protection: "Protection",
  threats: "Threat activity",
  dataProtection: "Data protection",
  accessHygiene: "Access hygiene",
  spend: "Spend",
  reliability: "Reliability",
};

function BandBadge({ band }: { band: Band }) {
  return <Badge variant={BAND_VARIANT[band]}>{BAND_LABEL[band]}</Badge>;
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-bold">{value}</div>
        {note ? (
          <div className="text-muted-foreground text-xs">{note}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Summary({ data }: { data: Scorecards }) {
  const s = data.summary;
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Stat
        label="Applications"
        value={s.applications}
        note={
          <span className="flex flex-wrap gap-1 pt-1">
            <Badge variant="error">{s.byOverall.red} act now</Badge>
            <Badge variant="warning">{s.byOverall.amber} watch</Badge>
            <Badge variant="success">{s.byOverall.green} on track</Badge>
          </span>
        }
      />
      <Stat
        label="Guardrail mode"
        value={data.mode === "enforce" ? "Enforce" : "Record"}
        note={
          data.mode === "enforce"
            ? "Refusals and redactions are applied."
            : "Decisions are recorded, not applied."
        }
      />
      <Stat
        label="Calls"
        value={s.calls.toLocaleString()}
        note={`Last ${data.windowDays} days`}
      />
      <Stat
        label="Prompts refused"
        value={s.promptBlocks.toLocaleString()}
        note={`${s.answerBlocks.toLocaleString()} answers withheld`}
      />
      <Stat
        label="Personal data redacted"
        value={s.redactions.toLocaleString()}
        note="Prompts and answers"
      />
      <Stat
        label="Spend"
        value={s.spendUsd === null ? "—" : `$${s.spendUsd.toFixed(2)}`}
        note={s.spendUsd === null ? "Not shown for your role" : undefined}
      />
      <Stat
        label="Keys without a budget"
        value={s.missingBudget}
        note="Set one when the key is created"
      />
    </div>
  );
}

function ApplicationCard({
  app,
  projectId,
}: {
  app: Application;
  projectId: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base" title={app.name}>
              {app.name}
            </CardTitle>
            <div
              className="text-muted-foreground truncate font-mono text-xs"
              title={app.alias}
            >
              {app.alias}
            </div>
          </div>
          <BandBadge band={app.overall} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {app.dimensions.map((d) => (
          <div
            key={d.dimension}
            className="grid grid-cols-[8.5rem_6rem_1fr] items-start gap-2 text-sm"
          >
            <span>{DIMENSION_LABEL[d.dimension]}</span>
            <span>
              <BandBadge band={d.band} />
            </span>
            <span className="text-muted-foreground text-xs">{d.evidence}</span>
          </div>
        ))}
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs">
          <span>
            {app.calls.toLocaleString()} calls ·{" "}
            {app.models.length ? app.models.join(", ") : "all models"}
          </span>
          <Link
            href={`/project/${projectId}/acme-enhancements/security-logs?tab=guardrails`}
            className="underline"
          >
            Guardrail decisions
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function AcmeApplicationsScorecard({
  projectId,
}: {
  projectId: string;
}) {
  const [windowDays, setWindowDays] = useState<7 | 30>(30);
  const scorecards = api.acmeApplications.scorecards.useQuery({
    projectId,
    windowDays,
  });

  if (scorecards.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }
  if (scorecards.isError) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Could not load the scorecards: {scorecards.error.message}
      </div>
    );
  }
  if (!scorecards.data.enabled) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-4 text-sm">
          Gateway management is switched off on this deployment, so there are no
          applications to score.
        </CardContent>
      </Card>
    );
  }
  const data = scorecards.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground max-w-3xl text-sm">
          One scorecard per connected application. Each dimension is rated on
          metadata only (guardrail decisions, gateway calls and the key&apos;s
          settings), never on prompt or answer text. Rates need at least 10
          calls in the period.
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

      <Summary data={data} />

      {data.applications.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground p-4 text-sm">
            No applications yet. Create a key for an application under
            Governance Controls › LLM Gateway, and it appears here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {data.applications.map((app) => (
            <ApplicationCard
              key={`${app.alias}`}
              app={app}
              projectId={projectId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
