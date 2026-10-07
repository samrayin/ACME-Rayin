import { CircleSlash } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";

// ACME (CHG-2026-132, ADR-0027): the honest states of the EYEON kit, from
// the prototype's honesty rules (README §10). "Not recorded" stands where
// EYEON holds no data, so a missing figure is never shown as a zero or a
// guess; "Preview" marks a figure or feature that is not yet the product's.

/**
 * A figure every reader can tell apart from a measurement. "Not recorded"
 * carries no value at all; "Preview" carries one, always with its tag.
 */
export type EyeonFigure =
  | { state: "measured"; value: string }
  | { state: "notRecorded"; reason: string }
  | { state: "preview"; value: string; reason: string };

/** "Not recorded", with why in its title and for screen readers. */
export function EyeonNotRecorded({ reason }: { reason: string }) {
  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-1 font-bold"
      title={reason}
    >
      <CircleSlash aria-hidden className="size-3.5" />
      Not recorded
      <span className="sr-only">: {reason}</span>
    </span>
  );
}

/** The "Preview" tag, with what it previews in its title. */
function EyeonPreviewTag({ reason }: { reason: string }) {
  return (
    <Badge variant="outline" title={reason}>
      Preview
      <span className="sr-only">: {reason}</span>
    </Badge>
  );
}

/** A figure in its state: the value, or the honest label in its place. */
export function EyeonFigureValue({ figure }: { figure: EyeonFigure }) {
  if (figure.state === "notRecorded") {
    return (
      <span className="text-lg">
        <EyeonNotRecorded reason={figure.reason} />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-2xl font-bold tabular-nums">{figure.value}</span>
      {figure.state === "preview" ? (
        <EyeonPreviewTag reason={figure.reason} />
      ) : null}
    </span>
  );
}
