/**
 * ACME (CHG-2026-137, ADR-0027): the geometry of the EYEON flow chart, after
 * the prototype's decision flow: columns of nodes, each a bar whose height
 * follows its value, joined by ribbons from one column to the next.
 *
 * Small values are magnified rather than lost: every node with a value gets
 * at least a minimum height, and the rest of the column is shared in
 * proportion (the prototype's fitSizes). A ribbon takes the same share of
 * its source node as of its value, and of its target likewise, so its two
 * ends can differ in width where a node is magnified.
 *
 * Pure functions only, so they are tested without a browser. Colours are not
 * here: the component takes them from the console's tokens (eyeonTones.ts).
 */

function fixed(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * Sizes for `values` that fill `available`, in proportion, with every
 * positive value at least `min`. Zero and negative values get no size.
 * Values that would fall below `min` are pinned there and the rest shared
 * again, a few times over, as in the prototype.
 */
export function fitSizes(
  values: readonly number[],
  available: number,
  min: number,
): number[] {
  const out = values.map(() => 0);
  const pinned = new Set<number>();
  for (let pass = 0; pass < 5; pass++) {
    let rest = available;
    let free = 0;
    values.forEach((v, i) => {
      if (!(v > 0)) return;
      if (pinned.has(i)) rest -= min;
      else free += v;
    });
    const scale = free > 0 ? Math.max(0, rest) / free : 0;
    let changed = false;
    values.forEach((v, i) => {
      if (!(v > 0)) {
        out[i] = 0;
        return;
      }
      if (pinned.has(i)) {
        out[i] = min;
        return;
      }
      out[i] = v * scale;
      if (out[i]! < min) {
        pinned.add(i);
        changed = true;
      }
    });
    if (!changed) break;
  }
  return out;
}

/**
 * Label positions near their wanted positions, at least `gap` apart and
 * within [lo, hi], in the order of the wanted positions. Labels that do not
 * fit are packed from the bottom up.
 */
export function spreadLabels(
  wanted: readonly number[],
  lo: number,
  hi: number,
  gap: number,
): number[] {
  const order = wanted
    .map((want, i) => ({ want, i }))
    .sort((a, b) => a.want - b.want || a.i - b.i);
  const placed = order.map(() => 0);
  let next = lo;
  order.forEach((item, k) => {
    placed[k] = Math.max(item.want, next);
    next = placed[k]! + gap;
  });
  for (let k = order.length - 1; k >= 0; k--) {
    const limit = k === order.length - 1 ? hi : placed[k + 1]! - gap;
    if (placed[k]! > limit) placed[k] = limit;
  }
  const out = wanted.map(() => 0);
  order.forEach((item, k) => {
    out[item.i] = placed[k]!;
  });
  return out;
}

/** A horizontal ribbon from one bar's edge to the next bar's edge. */
export function ribbonPath(
  x0: number,
  a0: number,
  a1: number,
  x1: number,
  b0: number,
  b1: number,
): string {
  const mx = (x0 + x1) / 2;
  return (
    `M${fixed(x0)} ${fixed(a0)} C${fixed(mx)} ${fixed(a0)} ${fixed(mx)} ${fixed(b0)} ${fixed(x1)} ${fixed(b0)} ` +
    `L${fixed(x1)} ${fixed(b1)} C${fixed(mx)} ${fixed(b1)} ${fixed(mx)} ${fixed(a1)} ${fixed(x0)} ${fixed(a1)} Z`
  );
}

export type FlowNodeInput = { id: string; column: number; value: number };
export type FlowLinkInput = { source: string; target: string; value: number };

export type FlowBox = {
  width: number;
  height: number;
  /** Room above the bars (column captions) and below them. */
  top: number;
  bottom: number;
  /** Room left of the first column and right of the last (labels). */
  left: number;
  right: number;
  /** A bar's width. */
  bar: number;
  /** The gap between two nodes of a column. */
  gap: number;
  /** The least height of a node with a value. */
  minNode: number;
  /** The least distance between two labels of a column. */
  labelGap: number;
};

export type PlacedNode = {
  id: string;
  column: number;
  value: number;
  x: number;
  y: number;
  h: number;
  /** The centre of its label, which may sit off the bar's centre. */
  labelY: number;
};

export type PlacedLink = {
  source: string;
  target: string;
  value: number;
  path: string;
};

/**
 * Nodes placed in their columns, in the order given, and the ribbons between
 * them. Nodes without a value, and links without a value or without both
 * ends placed, are left out. Each node's outgoing ribbons leave it in the
 * order of their targets, and arrive in the order of their sources, so
 * ribbons do not cross more than they must.
 */
export function flowLayout(
  nodes: readonly FlowNodeInput[],
  links: readonly FlowLinkInput[],
  box: FlowBox,
): { nodes: PlacedNode[]; links: PlacedLink[] } {
  const columns = Math.max(0, ...nodes.map((n) => n.column)) + 1;
  const plotTop = box.top;
  const plotBottom = box.height - box.bottom;
  const plotHeight = Math.max(0, plotBottom - plotTop);
  const span = box.width - box.left - box.right - box.bar;
  const colX = (c: number) =>
    columns > 1 ? box.left + (c * span) / (columns - 1) : box.left;

  const placed: PlacedNode[] = [];
  for (let c = 0; c < columns; c++) {
    const column = nodes.filter((n) => n.column === c && n.value > 0);
    if (column.length === 0) continue;
    const available = plotHeight - box.gap * (column.length - 1);
    const sizes = fitSizes(
      column.map((n) => n.value),
      available,
      box.minNode,
    );
    let y = plotTop;
    const inColumn = column.map((n, i) => {
      const node = {
        id: n.id,
        column: c,
        value: n.value,
        x: colX(c),
        y,
        h: sizes[i]!,
        labelY: 0,
      };
      y += sizes[i]! + box.gap;
      return node;
    });
    const labels = spreadLabels(
      inColumn.map((n) => n.y + n.h / 2),
      plotTop + box.labelGap / 2,
      plotBottom - box.labelGap / 2,
      box.labelGap,
    );
    inColumn.forEach((n, i) => {
      n.labelY = labels[i]!;
    });
    placed.push(...inColumn);
  }

  const byId = new Map(placed.map((n) => [n.id, n]));
  const drawn = links.filter(
    (l) => l.value > 0 && byId.has(l.source) && byId.has(l.target),
  );
  const outOffset = new Map(placed.map((n) => [n.id, n.y]));
  const inOffset = new Map(placed.map((n) => [n.id, n.y]));
  const sourceEnds = new Map<FlowLinkInput, [number, number]>();
  // Leave each source in the order of the targets.
  for (const l of [...drawn].sort(
    (a, b) => byId.get(a.target)!.y - byId.get(b.target)!.y,
  )) {
    const s = byId.get(l.source)!;
    const start = outOffset.get(s.id)!;
    const end = Math.min(s.y + s.h, start + (s.h * l.value) / s.value);
    outOffset.set(s.id, end);
    sourceEnds.set(l, [start, end]);
  }
  const placedLinks: PlacedLink[] = [];
  // Arrive at each target in the order of the sources.
  for (const l of [...drawn].sort(
    (a, b) => byId.get(a.source)!.y - byId.get(b.source)!.y,
  )) {
    const s = byId.get(l.source)!;
    const t = byId.get(l.target)!;
    const start = inOffset.get(t.id)!;
    const end = Math.min(t.y + t.h, start + (t.h * l.value) / t.value);
    inOffset.set(t.id, end);
    const [a0, a1] = sourceEnds.get(l)!;
    placedLinks.push({
      source: l.source,
      target: l.target,
      value: l.value,
      path: ribbonPath(s.x + box.bar, a0, a1, t.x, start, end),
    });
  }
  // Back in the order given, so the drawing order is stable.
  placedLinks.sort(
    (a, b) =>
      drawn.findIndex((l) => l.source === a.source && l.target === a.target) -
      drawn.findIndex((l) => l.source === b.source && l.target === b.target),
  );
  return { nodes: placed, links: placedLinks };
}
