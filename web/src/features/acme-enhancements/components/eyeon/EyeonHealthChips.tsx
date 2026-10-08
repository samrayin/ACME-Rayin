import {
  CheckCircle2,
  Clock,
  MinusCircle,
  OctagonAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import {
  MIRROR_STATE,
  type MirrorState,
  type ModelHealthStatus,
} from "@/src/features/acme-enhancements/utils/eyeonGatewayHealthLabels";

// ACME (CHG-2026-139, ADR-0027): the EYEON kit's health chips, after the
// prototype's Gateway health page: a model's state at its last health check,
// and whether the request-log mirror is as complete as it should be. As with
// every kit chip, a status colour always comes with a label and an icon.

const MODEL_HEALTH: Record<
  ModelHealthStatus,
  {
    label: string;
    variant: "success" | "error" | "secondary";
    icon: LucideIcon;
  }
> = {
  healthy: { label: "Healthy", variant: "success", icon: CheckCircle2 },
  unhealthy: { label: "Unhealthy", variant: "error", icon: XCircle },
  unknown: {
    label: "Not in the check",
    variant: "secondary",
    icon: MinusCircle,
  },
};

/** A model's state at its last health check: point in time, never a trend. */
export function EyeonModelHealthChip({
  status,
}: {
  status: ModelHealthStatus;
}) {
  const { label, variant, icon: Icon } = MODEL_HEALTH[status];
  return (
    <Badge variant={variant} className="gap-1">
      <Icon aria-hidden className="size-3" />
      {label}
    </Badge>
  );
}

const MIRROR_ICON: Record<MirrorState, LucideIcon> = {
  withinLag: Clock,
  behind: OctagonAlert,
  noReconciliation: MinusCircle,
};

const MIRROR_VARIANT: Record<MirrorState, "secondary" | "error" | "outline"> = {
  withinLag: "secondary",
  behind: "error",
  noReconciliation: "outline",
};

/** The request-log mirror's freshness against its expected lag. */
export function EyeonMirrorChip({ state }: { state: MirrorState }) {
  const Icon = MIRROR_ICON[state];
  return (
    <Badge variant={MIRROR_VARIANT[state]} className="gap-1">
      <Icon aria-hidden className="size-3" />
      {MIRROR_STATE[state].label}
    </Badge>
  );
}
