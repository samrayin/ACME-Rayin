import { type ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/src/components/ui/card";
import { cn } from "@/src/utils/tailwind";
import {
  type EyeonFigure,
  EyeonFigureValue,
} from "@/src/features/acme-enhancements/components/eyeon/EyeonHonestLabels";

// ACME (CHG-2026-132, ADR-0027): the EYEON KPI tile, after the prototype's:
// a label, the figure, an optional trend, an optional delta or status line,
// and one line saying what the figure counts. With a link, the whole tile
// opens the page behind the figure.

const DELTA_TONE = {
  good: "text-dark-green",
  bad: "text-dark-red",
  neutral: "text-muted-foreground",
} as const;

export function EyeonKpiTile({
  label,
  figure,
  subtitle,
  delta,
  href,
  trend,
}: {
  label: string;
  /** "Not recorded" and "Preview" are states of the figure, not values. */
  figure: EyeonFigure;
  /** One line: what is counted, over which period. */
  subtitle: string;
  /** A change or a status against a threshold, always in words. */
  delta?: { text: string; tone: keyof typeof DELTA_TONE };
  href?: string;
  /** A small chart under the figure, usually an EyeonSparkline. */
  trend?: ReactNode;
}) {
  const content = (
    <CardContent className="flex h-full flex-col gap-1 p-4">
      <span className="text-muted-foreground truncate text-xs" title={label}>
        {label}
      </span>
      <EyeonFigureValue figure={figure} />
      {trend}
      {delta ? (
        <span className={cn("text-xs font-bold", DELTA_TONE[delta.tone])}>
          {delta.text}
        </span>
      ) : null}
      <span
        className="text-muted-foreground mt-auto truncate text-xs"
        title={subtitle}
      >
        {subtitle}
      </span>
    </CardContent>
  );
  return (
    <Card className="h-full min-w-0">
      {href ? (
        <Link
          href={href}
          className="hover:bg-muted/50 focus-visible:ring-ring block h-full rounded-lg focus-visible:ring-2 focus-visible:outline-hidden"
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </Card>
  );
}
