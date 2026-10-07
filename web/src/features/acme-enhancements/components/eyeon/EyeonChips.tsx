import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  EyeOff,
  MinusCircle,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { cn } from "@/src/utils/tailwind";
import {
  type GatewayMode,
  type GuardrailAction,
  gatewayModeLabel,
  guardrailVerdictLabel,
} from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";
import { type Band } from "@/src/features/acme-enhancements/server/acmeApplicationScorecard";

// ACME (CHG-2026-132, ADR-0027): the EYEON kit's chips, after the
// prototype's mode, decision and rating chips. Status colour always comes
// with a label and an icon, never alone. The wording is the console's own:
// a decision's label follows the mode the gateway reported (CHG-2026-116),
// and a rating is the Applications scorecard's band (CHG-2026-122).

/**
 * The guardrail mode EYEON serves, always with the deployment ceiling. A
 * null mode is "Not reported": nothing says what the gateways apply.
 */
export function EyeonModeChip({
  mode,
  ceiling,
}: {
  mode: GatewayMode | null;
  ceiling: GatewayMode;
}) {
  const label =
    mode === "enforce"
      ? "Enforce mode"
      : mode === "record"
        ? "Record mode"
        : "Not reported";
  return (
    <span
      className="inline-flex items-stretch overflow-hidden rounded-md border text-xs"
      title="The guardrail mode for gateway traffic, and the highest mode this deployment allows."
    >
      <span className="flex items-center gap-1.5 px-2 py-0.5 font-bold">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            mode === "enforce" && "bg-dark-green",
            mode === "record" && "bg-dark-yellow",
            mode === null && "border-muted-foreground border",
          )}
        />
        {label}
      </span>
      <span className="text-muted-foreground flex items-center gap-1 border-l px-2 py-0.5">
        Ceiling
        <span className="text-foreground font-bold">
          {gatewayModeLabel(ceiling)}
        </span>
      </span>
    </span>
  );
}

const DECISION_ICON: Record<GuardrailAction, LucideIcon> = {
  allow: CheckCircle2,
  redact: EyeOff,
  block: Ban,
  unavailable: MinusCircle,
};

/**
 * One guardrail decision. "Blocked" and "Redacted" only where the gateway
 * reported enforce mode; otherwise "Would block" and "Would redact", and with
 * `long`, the reason in brackets.
 */
export function EyeonDecisionChip({
  action,
  mode,
  long = false,
}: {
  action: GuardrailAction;
  mode: GatewayMode | null;
  long?: boolean;
}) {
  const { label, variant } = guardrailVerdictLabel(action, mode);
  const Icon = DECISION_ICON[action];
  const unapplied =
    long && mode !== "enforce" && (action === "block" || action === "redact");
  return (
    <Badge variant={variant} className="gap-1">
      <Icon aria-hidden className="size-3" />
      {unapplied
        ? `${label} (${mode === "record" ? "record mode" : "mode not reported"})`
        : label}
    </Badge>
  );
}

type EyeonRating = "ontrack" | "watch" | "actnow" | "notrated";

const RATING: Record<
  EyeonRating,
  {
    label: string;
    variant: "success" | "warning" | "error" | "secondary";
    icon: LucideIcon;
  }
> = {
  ontrack: { label: "On track", variant: "success", icon: CheckCircle2 },
  watch: { label: "Watch", variant: "warning", icon: AlertTriangle },
  actnow: { label: "Act now", variant: "error", icon: OctagonAlert },
  notrated: { label: "Not rated", variant: "secondary", icon: MinusCircle },
};

/** A scorecard band as the rating it is shown as. */
export function ratingFromBand(band: Band): EyeonRating {
  if (band === "red") return "actnow";
  if (band === "amber") return "watch";
  if (band === "green") return "ontrack";
  return "notrated";
}

/** An application's or a dimension's rating, with an optional count. */
export function EyeonRatingChip({
  rating,
  count,
}: {
  rating: EyeonRating;
  count?: number;
}) {
  const { label, variant, icon: Icon } = RATING[rating];
  return (
    <Badge variant={variant} className="gap-1">
      <Icon aria-hidden className="size-3" />
      {label}
      {count === undefined ? null : (
        <span className="tabular-nums">{count.toLocaleString()}</span>
      )}
    </Badge>
  );
}
