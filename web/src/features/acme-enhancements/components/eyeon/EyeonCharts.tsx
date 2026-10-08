import { type ReactNode } from "react";
import { cn } from "@/src/utils/tailwind";
import {
  bulletScale,
  clampFraction,
  ringArcPath,
  sparklinePaths,
  stackSegments,
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
 * CHG-2026-137 follow-up: how a sparkline of shares or rates is written,
 * where a sum over the points means nothing. `format` writes a value (e.g.
 * "87%"); `max` fixes the top of the scale (100 for a share); `missing` is
 * what a point without a value means (e.g. "no checks"), drawn as a gap.
 */
type EyeonSparkRate = {
  format: (value: number) => string;
  max?: number;
  missing: string;
};

/**
 * A series as a line over a light area, its own scale, zero at the bottom.
 * `label` names what one point counts, e.g. "Guardrail checks per day".
 * With `rate`, the accessible name states the range of the values rather
 * than their total, and a null value is a gap in the line, never a zero.
 */
export function EyeonSparkline({
  label,
  points,
  tone = "accent",
  size = "sm",
  rate,
}: {
  label: string;
  points: { label: string; value: number | null }[];
  tone?: EyeonTone;
  size?: "sm" | "lg";
  rate?: EyeonSparkRate;
}) {
  const { width, height } = SPARK_BOX[size];
  const values = points.map((p) => p.value);
  const present = values.filter((v): v is number => v !== null);
  const { line, area } = sparklinePaths(values, width, height, 2, rate?.max);
  const total = present.reduce((sum, v) => sum + v, 0);
  const max = Math.max(0, ...present);
  const first = points[0]?.label;
  const last = points[points.length - 1]?.label;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const written = (v: number | null) =>
    v === null
      ? (rate?.missing ?? "no data")
      : rate
        ? rate.format(v)
        : v.toLocaleString();
  const range = (low: string, high: string) =>
    low === high ? `each ${high}` : `from ${low} to ${high}`;
  const figures = !rate
    ? `${total.toLocaleString()} in total, at most ${max.toLocaleString()}`
    : present.length === 0
      ? `none with a value (${rate.missing})`
      : `${present.length.toLocaleString()} with a value, ${range(rate.format(Math.min(...present)), rate.format(max))}`;
  const summary =
    points.length === 0
      ? `${label}: no data.`
      : `${label}, ${points.length} points from ${first} to ${last}: ${figures}.`;
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
          <title>{`${p.label}: ${written(p.value)}`}</title>
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

// ACME (CHG-2026-133, ADR-0027): stacked bars and a bar list, for the
// Guardrail decisions page. Same rules as the charts above: SVG only, tones
// through currentColor, an accessible name that states the figures, a hover
// title on each bar, and words beside every colour (a legend, or the value
// text). A series drawn "muted" is the same status, not applied (Would block
// beside Blocked), and is always named as such.

/** One series of a stack: its name, its status tone, and whether muted. */
export type EyeonStackSeries = {
  name: string;
  tone: EyeonTone;
  muted?: boolean;
};

/** The fill opacity of a series: a muted one is lighter, never hidden. */
function seriesOpacity(muted: boolean | undefined): number {
  return muted ? 0.4 : 1;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

/** A small square in a series' colour, beside its name. */
function EyeonSwatch({ series }: { series: EyeonStackSeries }) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className={cn("size-2.5 shrink-0", EYEON_TONE_TEXT[series.tone])}
    >
      <rect
        width={10}
        height={10}
        rx={2}
        fill="currentColor"
        fillOpacity={seriesOpacity(series.muted)}
      />
    </svg>
  );
}

/** The plot's height: md for a strip, lg for a card's main chart. */
const BARS_HEIGHT = {
  md: { height: 96, className: "h-24" },
  lg: { height: 224, className: "h-56" },
} as const;

/**
 * A series of stacked bars, one per point (e.g. per UTC day), the series
 * stacked from the baseline in the order given, on one scale: the tallest
 * stack fills the height. A legend names every series with its total.
 * `label` names what one bar counts, e.g. "Interventions per UTC day".
 * CHG-2026-137 follow-up: `size` "lg" draws a card's main chart (224 px,
 * after the prototype's 230) with its scale written around it: the top
 * value above a dashed top line, and the first and last point under it.
 * With `emptyText`, a series with nothing to draw says so instead of an
 * empty plot.
 */
export function EyeonStackedBars({
  label,
  series,
  points,
  legendValues,
  size = "md",
  emptyText,
}: {
  label: string;
  series: EyeonStackSeries[];
  /** One value per series, in the series' order. */
  points: { label: string; values: number[] }[];
  /**
   * CHG-2026-137: what the legend and the accessible name state for each
   * series, where a sum over the bars means nothing (e.g. rates per day).
   * By default, each series' total.
   */
  legendValues?: string[];
  size?: keyof typeof BARS_HEIGHT;
  /** What to say, in place of the plot, when every value is zero. */
  emptyText?: string;
}) {
  const width = 300;
  const { height, className: heightClass } = BARS_HEIGHT[size];
  const max = Math.max(0, ...points.map((p) => sum(p.values)));
  const band = points.length > 0 ? width / points.length : width;
  const barWidth = band * 0.7;
  const totals = series.map((_, j) => sum(points.map((p) => p.values[j] ?? 0)));
  const legend = series.map(
    (_, j) => legendValues?.[j] ?? (totals[j] ?? 0).toLocaleString(),
  );
  const named = (values: readonly number[]) =>
    series
      .map((s, j) => `${s.name} ${(values[j] ?? 0).toLocaleString()}`)
      .join(", ");
  const summary =
    points.length === 0
      ? `${label}: no data.`
      : `${label}, ${points.length} bars from ${points[0]!.label} to ${points[points.length - 1]!.label}: ${series.map((s, j) => `${s.name} ${legend[j]}`).join(", ")}; at most ${max.toLocaleString()} in one bar.`;
  const empty = emptyText !== undefined && points.length > 0 && max === 0;
  const plot = (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn(heightClass, "w-full")}
      role="img"
      aria-label={summary}
    >
      <line
        x1={0}
        x2={width}
        y1={height - 0.5}
        y2={height - 0.5}
        className="stroke-border"
        vectorEffect="non-scaling-stroke"
      />
      {size === "lg" ? (
        // The top of the scale, where the tallest bar ends; its value is
        // written above the plot.
        <line
          x1={0}
          x2={width}
          y1={0.5}
          y2={0.5}
          className="stroke-border"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {points.map((p, i) => {
        const segments = stackSegments(p.values, max, height - 1);
        const x = i * band + (band - barWidth) / 2;
        return (
          <g key={p.label}>
            <title>{`${p.label}: ${named(p.values)}`}</title>
            {segments.map((seg, j) => {
              const s = series[j];
              return s && seg.size > 0 ? (
                <rect
                  key={s.name}
                  x={x}
                  y={height - 1 - seg.start - seg.size}
                  width={barWidth}
                  height={seg.size}
                  className={EYEON_TONE_TEXT[s.tone]}
                  fill="currentColor"
                  fillOpacity={seriesOpacity(s.muted)}
                />
              ) : null;
            })}
            <rect
              x={i * band}
              y={0}
              width={band}
              height={height}
              fill="transparent"
            />
          </g>
        );
      })}
    </svg>
  );
  return (
    <div className="flex flex-col gap-2">
      {empty ? (
        <p className="text-muted-foreground text-sm">{emptyText}</p>
      ) : size === "lg" ? (
        // The scale in words around the plot, which keeps the card's full
        // width (so a strip under it, such as the gateway's mode per day,
        // lines up with the bars): the top value above it, the first and
        // last point under it. The accessible name already states the
        // figures, so these labels are hidden from it.
        <div className="flex flex-col gap-1">
          <span
            className="text-muted-foreground text-xs tabular-nums"
            aria-hidden
          >
            {max.toLocaleString()}
          </span>
          {plot}
          <div
            className="text-muted-foreground flex justify-between gap-2 text-xs tabular-nums"
            aria-hidden
          >
            <span>{points[0]?.label}</span>
            <span>
              {points.length > 1 ? points[points.length - 1]?.label : null}
            </span>
          </div>
        </div>
      ) : (
        plot
      )}
      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
        aria-label="Legend"
      >
        {series.map((s, j) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <EyeonSwatch series={s} />
            <span>{s.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {legend[j]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * CHG-2026-137 follow-up: one horizontal bar, a stack of named segments on a
 * scale where `max` fills the bar (the bar of each EyeonBarList row, also
 * drawn in a table cell). Its accessible name states every segment.
 */
export function EyeonStackBar({
  title,
  segments,
  max,
}: {
  /** What the bar is, e.g. "Jailbreak or misuse"; it starts the name. */
  title: string;
  segments: (EyeonStackSeries & { value: number })[];
  max: number;
}) {
  const width = 200;
  const parts = stackSegments(
    segments.map((s) => s.value),
    max,
    width,
  );
  return (
    <svg
      viewBox={`0 0 ${width} 8`}
      preserveAspectRatio="none"
      className="h-2 w-full"
      role="img"
      aria-label={`${title}: ${segments
        .map((s) => `${s.name} ${s.value.toLocaleString()}`)
        .join(", ")}.`}
    >
      <rect width={width} height={8} rx={4} className="fill-muted" />
      {parts.map((seg, j) => {
        const s = segments[j];
        return s && seg.size > 0 ? (
          <rect
            key={s.name}
            x={seg.start}
            width={seg.size}
            height={8}
            className={EYEON_TONE_TEXT[s.tone]}
            fill="currentColor"
            fillOpacity={seriesOpacity(s.muted)}
          />
        ) : null;
      })}
    </svg>
  );
}

/**
 * A ranked list, one horizontal bar per item on one scale (the largest item
 * fills its row), each bar a stack of named segments. The item's figures are
 * also written beside it (`valueText`), so the list reads without the bars.
 */
export function EyeonBarList({
  label,
  items,
}: {
  /** The list's accessible name. */
  label: string;
  items: {
    key: string;
    /** What the row is: text, or a link. */
    name: ReactNode;
    /** The row's name as text, for the hover title and the bar's name. */
    title: string;
    valueText: string;
    segments: (EyeonStackSeries & { value: number })[];
    /** An optional line under the bar. */
    note?: ReactNode;
  }[];
}) {
  const max = Math.max(
    0,
    ...items.map((item) => sum(item.segments.map((s) => s.value))),
  );
  return (
    <ol className="flex flex-col gap-3" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate" title={item.title}>
              {item.name}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {item.valueText}
            </span>
          </div>
          <EyeonStackBar
            title={item.title}
            segments={item.segments}
            max={max}
          />
          {item.note}
        </li>
      ))}
    </ol>
  );
}
