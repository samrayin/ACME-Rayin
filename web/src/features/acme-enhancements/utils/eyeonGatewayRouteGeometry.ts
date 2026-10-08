/**
 * ACME (CHG-2026-139 follow-up): the geometry of the Gateway health route
 * map, after the prototype's: wires drawn from the gateway to each model.
 *
 * The map uses fixed sizes, so no element is measured in the browser: each
 * model row is 64 px (Tailwind `h-16`) with an 8 px gap (`gap-2`), the
 * gateway card is 176 px (`h-44`), and the row they share is as tall as the
 * longer of the two. Both are centred in that row, so the gateway's anchor
 * is the row's middle and each model's anchor is its row's middle. Pure
 * functions, tested without a browser.
 */

/** A model row's height and the gap between rows, in px. */
export const ROUTE_ROW_PX = 64;
export const ROUTE_GAP_PX = 8;

/** The gateway card's height, in px: the row is never shorter. */
export const ROUTE_GATEWAY_PX = 176;

/** The width of the band the wires are drawn in, in px (Tailwind `w-28`). */
const ROUTE_WIRE_PX = 112;

/** The width of the short wire from the applications to the gateway. */
export const ROUTE_LEAD_PX = 48;

type Wire = {
  /** The model row's middle, from the top of the band. */
  y: number;
  /** An SVG path from the gateway's anchor to the model's. */
  path: string;
  /** The curve's middle, where a failing route shows its mark. */
  mid: { x: number; y: number };
};

/**
 * The band's height, the gateway's anchor and one wire per model. Each wire
 * is a cubic curve that leaves the gateway level and arrives at the model
 * level; its middle (t = 0.5) is halfway along and halfway between the two
 * heights.
 */
export function routeLayout(models: number): {
  width: number;
  height: number;
  gatewayY: number;
  wires: Wire[];
} {
  const n = Math.max(0, Math.floor(models));
  const list = n > 0 ? n * ROUTE_ROW_PX + (n - 1) * ROUTE_GAP_PX : 0;
  const height = Math.max(list, ROUTE_GATEWAY_PX);
  const top = (height - list) / 2;
  const gatewayY = height / 2;
  const w = ROUTE_WIRE_PX;
  const wires = Array.from({ length: n }, (_, i) => {
    const y = top + i * (ROUTE_ROW_PX + ROUTE_GAP_PX) + ROUTE_ROW_PX / 2;
    return {
      y,
      path: `M 0 ${gatewayY} C ${w / 2} ${gatewayY} ${w / 2} ${y} ${w} ${y}`,
      mid: { x: w / 2, y: (gatewayY + y) / 2 },
    };
  });
  return { width: w, height, gatewayY, wires };
}
