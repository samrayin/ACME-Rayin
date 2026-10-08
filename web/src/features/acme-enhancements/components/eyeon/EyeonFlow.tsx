import { type KeyboardEvent } from "react";
import { cn } from "@/src/utils/tailwind";
import { EyeonChartTable } from "@/src/features/acme-enhancements/components/eyeon/EyeonCharts";
import {
  type FlowBox,
  flowLayout,
} from "@/src/features/acme-enhancements/components/eyeon/eyeonFlowGeometry";
import {
  EYEON_TONE_TEXT,
  type EyeonTone,
} from "@/src/features/acme-enhancements/components/eyeon/eyeonTones";

// ACME (CHG-2026-137, ADR-0027): the EYEON flow chart, after the prototype's
// decision flow: columns of nodes joined by ribbons, e.g. checks, then
// direction, then verdict, then applied or recorded. SVG only, no chart
// library, the kit's rules: tones through currentColor, every node named in
// words with its value and share beside its bar, an accessible name that
// states the figures (the caller writes it), a hover title on every node and
// ribbon, and a table view under "Show as table". Small values are
// magnified so they stay visible (eyeonFlowGeometry). A node drawn "muted"
// is the same status, not applied (Would block beside Blocked).

export type EyeonFlowNode = {
  id: string;
  column: number;
  name: string;
  value: number;
  tone: EyeonTone;
  muted?: boolean;
  /** Pressed, when the chart filters the page. */
  selected?: boolean;
};

export type EyeonFlowLink = { source: string; target: string; value: number };

/** In pixels: the flow is drawn at this size, never scaled (see below). */
const BOX: FlowBox = {
  width: 720,
  height: 288,
  top: 30,
  bottom: 10,
  left: 132,
  right: 150,
  bar: 10,
  gap: 10,
  minNode: 4,
  labelGap: 34,
};

function share(value: number, total: number): string {
  if (total <= 0) return "–";
  const pct = (100 * value) / total;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  if (pct > 99.9 && pct < 100) return ">99.9%";
  return `${(Math.round(pct * 10) / 10).toLocaleString()}%`;
}

export function EyeonFlow({
  label,
  columns,
  nodes,
  links,
  total,
  totalName,
  tableCaption,
  onSelect,
}: {
  /** The accessible name: what flows, and its figures. */
  label: string;
  /** One caption per column, e.g. "Direction". */
  columns: string[];
  nodes: EyeonFlowNode[];
  links: EyeonFlowLink[];
  /** The base of every share, e.g. the checks. */
  total: number;
  /** What the base counts, for the table, e.g. "checks". */
  totalName: string;
  tableCaption: string;
  /** When given, each node is a button that calls it with the node's id. */
  onSelect?: (id: string) => void;
}) {
  const layout = flowLayout(nodes, links, BOX);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const columnX = (c: number) =>
    layout.nodes.find((n) => n.column === c)?.x ??
    BOX.left +
      (c * (BOX.width - BOX.left - BOX.right - BOX.bar)) /
        Math.max(1, columns.length - 1);

  function onKeyDown(event: KeyboardEvent<SVGGElement>, id: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(id);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* CHG-2026-137 follow-up (owner, 2026-10-08: "too large"): drawn at
          its natural size, one unit to one pixel, so its text stays the
          console's 12 px and it is as tall as the prototype's (about 280 px).
          It never stretches with the card: on a wide screen it is centred,
          and where the card is narrower than the chart, it scrolls. */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${BOX.width} ${BOX.height}`}
          width={BOX.width}
          height={BOX.height}
          className="mx-auto block max-w-none"
          role={onSelect ? "group" : "img"}
          aria-label={label}
        >
          {columns.map((caption, c) => (
            <text
              key={caption}
              x={c === 0 ? columnX(c) + BOX.bar : columnX(c)}
              y={14}
              textAnchor={c === 0 ? "end" : "start"}
              className="fill-muted-foreground text-xs uppercase"
              aria-hidden
            >
              {caption}
            </text>
          ))}
          {layout.links.map((l) => {
            const source = byId.get(l.source);
            const target = byId.get(l.target);
            if (!source || !target) return null;
            return (
              <path
                key={`${l.source}-${l.target}`}
                d={l.path}
                className={EYEON_TONE_TEXT[target.tone]}
                fill="currentColor"
                fillOpacity={target.muted ? 0.14 : 0.28}
              >
                <title>{`${source.name} to ${target.name}: ${l.value.toLocaleString()}, ${share(l.value, total)} of ${totalName}`}</title>
              </path>
            );
          })}
          {layout.nodes.map((placed) => {
            const node = byId.get(placed.id);
            if (!node) return null;
            const left = placed.column === 0;
            const textX = left ? placed.x - 8 : placed.x + BOX.bar + 6;
            const centre = placed.y + placed.h / 2;
            const figures = `${node.value.toLocaleString()} · ${share(node.value, total)}`;
            const name = `${node.name}: ${node.value.toLocaleString()}, ${share(node.value, total)} of ${totalName}`;
            return (
              <g
                key={node.id}
                role={onSelect ? "button" : undefined}
                tabIndex={onSelect ? 0 : undefined}
                aria-label={
                  onSelect
                    ? `${name}. ${node.selected ? "Selected; press to clear." : "Press to filter the page."}`
                    : undefined
                }
                aria-pressed={onSelect ? Boolean(node.selected) : undefined}
                onClick={onSelect ? () => onSelect(node.id) : undefined}
                onKeyDown={onSelect ? (e) => onKeyDown(e, node.id) : undefined}
                className={onSelect ? "cursor-pointer" : undefined}
              >
                <title>{name}</title>
                <rect
                  x={placed.x}
                  y={placed.y}
                  width={BOX.bar}
                  height={Math.max(1, placed.h)}
                  rx={2}
                  className={EYEON_TONE_TEXT[node.tone]}
                  fill="currentColor"
                  fillOpacity={node.muted ? 0.4 : 1}
                  stroke={node.selected ? "currentColor" : undefined}
                  strokeWidth={node.selected ? 2 : undefined}
                />
                {Math.abs(placed.labelY - centre) > 3 ? (
                  <line
                    x1={left ? placed.x - 1 : placed.x + BOX.bar + 1}
                    x2={left ? placed.x - 5 : placed.x + BOX.bar + 4}
                    y1={centre}
                    y2={placed.labelY}
                    className="stroke-muted-foreground"
                    strokeWidth={1}
                  />
                ) : null}
                <text
                  x={textX}
                  y={placed.labelY - 3}
                  textAnchor={left ? "end" : "start"}
                  className={cn(
                    "fill-foreground stroke-background text-xs",
                    node.selected && "font-bold",
                  )}
                  strokeWidth={3}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                >
                  {node.name}
                </text>
                <text
                  x={textX}
                  y={placed.labelY + 11}
                  textAnchor={left ? "end" : "start"}
                  className="fill-muted-foreground stroke-background text-xs tabular-nums"
                  strokeWidth={3}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                >
                  {figures}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <EyeonChartTable
        caption={tableCaption}
        columns={["Stage", "Step", "Count", `Share of ${totalName}`]}
        rows={nodes.map((n) => ({
          key: n.id,
          cells: [
            columns[n.column] ?? "",
            n.name,
            n.value,
            share(n.value, total),
          ],
        }))}
      />
    </div>
  );
}
