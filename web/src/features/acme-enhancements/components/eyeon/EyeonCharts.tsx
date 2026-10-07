import { cn } from "@/src/utils/tailwind";
import {
  bulletScale,
  clampFraction,
  ringArcPath,
  sparklinePaths,
} from "@/src/features/acme-enhancements/components/eyeon/eyeonChartGeometry";
import {
  EYEON_TONE_TEXT,
  type EyeonTone,
} from "@/src/features/acme-enhancements/components/eyeon/eyeonTones";

// ACME (CHG-2026-132, ADR-0027): the EYEON kit's small charts, ported from
// the prototype's SVG charts: a sparkline, a ring (a share) and a bullet (a
// value against a target). No chart library. Each has a text alternative:
// an accessible name that states the figures, hover titles on the points,
// and, for a series, a table view (EyeonChartTable). Colours come from the
// console's tokens through currentColor.

const SPARK_BOX = {
  sm: { width: 120, height: 32 },
  lg: { width: 300, height: 96 },
} as const;

/**
 * A series as a line over a light area, its own scale, zero at the bottom.
 * `label` names what one point counts, e.g. "Guardrail checks per day".
 */
export function EyeonSparkline({
  label,
  points,
  tone = "accent",
  size = "sm",
}: {
  label: string;
  points: { label: string; value: number }[];
  tone?: EyeonTone;
  size?: "sm" | "lg";
}) {
  const { width, height } = SPARK_BOX[size];
  const values = points.map((p) => p.value);
  const { line, area } = sparklinePaths(values, width, height);
  const total = values.reduce((sum, v) => sum + v, 0);
  const max = Math.max(0, ...values);
  const first = points[0]?.label;
  const last = points[points.length - 1]?.label;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const summary =
    points.length === 0
      ? `${label}: no data.`
      : `${label}, ${points.length} points from ${first} to ${last}: ${total.toLocaleString()} in total, at most ${max.toLocaleString()}.`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn(
        "w-full",
        size === "sm" ? "h-8" : "h-24",
        EYEON_TONE_TEXT[tone],
      )}
      role="img"
      aria-label={summary}
    >
      <path d={area} fill="currentColor" fillOpacity={0.12} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={size === "sm" ? 1.5 : 2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((p, i) => (
        <rect
          key={p.label}
          x={i * step - step / 2}
          y={0}
          width={step}
          height={height}
          fill="transparent"
        >
          <title>{`${p.label}: ${p.value.toLocaleString()}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/**
 * A share as a ring, filled clockwise from 12 o'clock. `fraction` is 0..1;
 * null draws the empty track, for a share that does not exist (no checks).
 * The text in the middle is the caller's, so it can say why it is empty.
 */
export function EyeonRing({
  label,
  fraction,
  centerText,
  caption,
  tone = "accent",
}: {
  label: string;
  fraction: number | null;
  centerText: string;
  caption?: string;
  tone?: EyeonTone;
}) {
  const arc = fraction === null ? "" : ringArcPath(60, 60, 50, fraction);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        viewBox="0 0 120 120"
        className={cn("size-32", EYEON_TONE_TEXT[tone])}
        role="img"
        aria-label={label}
      >
        <circle
          cx={60}
          cy={60}
          r={50}
          fill="none"
          className="stroke-muted"
          strokeWidth={10}
        />
        {arc ? (
          <path
            d={arc}
            fill="none"
            stroke="currentColor"
            strokeWidth={10}
            strokeLinecap="round"
          />
        ) : null}
        <text
          x={60}
          y={60}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground text-xl font-bold"
        >
          {centerText}
        </text>
      </svg>
      {caption ? (
        <span className="text-muted-foreground text-center text-xs">
          {caption}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A value against a target: a bar for the value, a mark for the target,
 * on a scale that runs a little past the larger of the two.
 */
export function EyeonBullet({
  label,
  value,
  target,
  valueText,
  targetText,
  tone = "accent",
}: {
  label: string;
  value: number;
  target: number;
  valueText: string;
  targetText: string;
  tone?: EyeonTone;
}) {
  const width = 200;
  const { valueX, targetX } = bulletScale(value, target, width);
  const used = target > 0 ? Math.round(100 * clampFraction(value / target)) : 0;
  const over = target > 0 && value > target;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-bold" title={label}>
          {label}
        </span>
        <span className="text-muted-foreground shrink-0">
          {valueText} of {targetText} ({over ? "over" : `${used}%`})
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} 16`}
        preserveAspectRatio="none"
        className={cn("h-4 w-full", EYEON_TONE_TEXT[tone])}
        role="img"
        aria-label={`${label}: ${valueText} against ${targetText}${over ? ", over the target" : ""}.`}
      >
        <rect
          x={0}
          y={4}
          width={width}
          height={8}
          rx={4}
          className="fill-muted"
        />
        <rect
          x={0}
          y={5}
          width={Math.max(1, valueX)}
          height={6}
          rx={3}
          fill="currentColor"
        />
        <line
          x1={targetX}
          x2={targetX}
          y1={0}
          y2={16}
          className="stroke-foreground"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/**
 * A chart's numbers as a table, folded away under "Show as table": every
 * chart in the kit has one for readers who cannot use the plot.
 */
export function EyeonChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: { key: string; cells: (string | number)[] }[];
}) {
  return (
    <details className="text-xs">
      <summary className="text-muted-foreground cursor-pointer">
        Show as table
      </summary>
      <div className="max-h-64 overflow-y-auto pt-2">
        <table className="w-full">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b">
              {columns.map((c, i) => (
                <th
                  key={c}
                  scope="col"
                  className={cn(
                    "py-1 font-bold",
                    i === 0 ? "text-left" : "text-right",
                  )}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                {r.cells.map((cell, i) => (
                  <td
                    key={columns[i] ?? i}
                    className={cn(
                      "py-1",
                      i === 0 ? "text-left" : "text-right tabular-nums",
                    )}
                  >
                    {typeof cell === "number" ? cell.toLocaleString() : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
