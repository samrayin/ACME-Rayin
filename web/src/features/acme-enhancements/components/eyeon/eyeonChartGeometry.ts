/**
 * ACME (CHG-2026-132, ADR-0027): the geometry of the EYEON charts, ported
 * from the prototype's hand-written SVG charts (sparkline, ring, bullet).
 *
 * Pure functions only, so they are tested without a browser. Colours are not
 * here: the components take them from the console's tokens (eyeonTones.ts).
 */

function fixed(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * A series scaled into a width x height box, zero at the bottom, the largest
 * value `pad` below the top. `line` traces the values; `area` closes it to
 * the bottom edge. A single value is drawn as a flat line; no values draw
 * nothing.
 */
export function sparklinePaths(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): { line: string; area: string } {
  if (values.length === 0) return { line: "", area: "" };
  const max = Math.max(0, ...values);
  const y = (v: number) =>
    height - pad - (max > 0 ? (Math.max(0, v) / max) * (height - 2 * pad) : 0);
  const points =
    values.length === 1
      ? [
          [0, y(values[0]!)],
          [width, y(values[0]!)],
        ]
      : values.map((v, i) => [(i * width) / (values.length - 1), y(v)]);
  const line = points
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${fixed(px!)} ${fixed(py!)}`)
    .join(" ");
  const lastX = points[points.length - 1]![0]!;
  const firstX = points[0]![0]!;
  return {
    line,
    area: `${line} L${fixed(lastX)} ${fixed(height)} L${fixed(firstX)} ${fixed(height)} Z`,
  };
}

/** A point on a circle, `degrees` clockwise from 12 o'clock. */
function polar(cx: number, cy: number, r: number, degrees: number) {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
}

/** A fraction clamped to 0..1; anything not a finite number is 0. */
export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * The stroke path of a ring's filled arc, clockwise from 12 o'clock, for a
 * fraction of the full circle. Empty for 0; a full circle (two half arcs, as
 * one arc cannot start and end on the same point) for 1.
 */
export function ringArcPath(
  cx: number,
  cy: number,
  r: number,
  fraction: number,
): string {
  const f = clampFraction(fraction);
  if (f === 0) return "";
  if (f >= 0.9999) {
    const [tx, ty] = polar(cx, cy, r, 0);
    const [bx, by] = polar(cx, cy, r, 180);
    return (
      `M${fixed(tx)} ${fixed(ty)} A${r} ${r} 0 1 1 ${fixed(bx)} ${fixed(by)} ` +
      `A${r} ${r} 0 1 1 ${fixed(tx)} ${fixed(ty)}`
    );
  }
  const end = 360 * f;
  const [x0, y0] = polar(cx, cy, r, 0);
  const [x1, y1] = polar(cx, cy, r, end);
  const large = end > 180 ? 1 : 0;
  return `M${fixed(x0)} ${fixed(y0)} A${r} ${r} 0 ${large} 1 ${fixed(x1)} ${fixed(y1)}`;
}

/**
 * A bullet chart's scale: the value and the target as positions in 0..width.
 * The scale runs to 15% past the larger of the two, as in the prototype, so
 * the target mark is never on the edge; with both at zero it runs to 1.
 */
export function bulletScale(
  value: number,
  target: number,
  width: number,
): { max: number; valueX: number; targetX: number } {
  const v = Math.max(0, Number.isFinite(value) ? value : 0);
  const t = Math.max(0, Number.isFinite(target) ? target : 0);
  const max = (Math.max(v, t) * 115) / 100 || 1;
  const at = (n: number) => Math.min(width, (n * width) / max);
  return { max, valueX: at(v), targetX: at(t) };
}

/**
 * ACME (CHG-2026-133, ADR-0027): a stack of values as segments along a bar
 * `length` long, each from where the previous one ends, on a scale where
 * `max` fills the bar. Negative and non-finite values count as zero; with no
 * positive `max` every segment is empty. The stack never runs past the bar.
 * Used by the stacked bars (upwards from the baseline) and the bar list
 * (rightwards from the start).
 */
export function stackSegments(
  values: readonly number[],
  max: number,
  length: number,
): { start: number; size: number }[] {
  const scale = Number.isFinite(max) && max > 0 ? length / max : 0;
  let start = 0;
  return values.map((v) => {
    const value = Number.isFinite(v) ? Math.max(0, v) : 0;
    const size = Math.max(0, Math.min(length - start, value * scale));
    const segment = { start, size };
    start += size;
    return segment;
  });
}
