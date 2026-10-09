import { describe, expect, it } from "vitest";
import {
  COMMAND_LENSES,
  COMMAND_WIDGETS,
  clearCommandLayout,
  commandLayoutKey,
  defaultCommandLayout,
  isLensLayout,
  lensLayout,
  readCommandLayout,
  resizeWidget,
  sanitiseCommandLayout,
  widgetSize,
  withWidgets,
  writeCommandLayout,
} from "@/src/features/acme-enhancements/utils/eyeonCommandLayout";
import {
  hideWidget,
  moveWidgetTo,
  shownWidgets,
} from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";

// CHG-2026-147 (ADR-0030): each person's arrangement of the command centre,
// kept in this browser only. Every view holds every widget exactly once, a
// stored arrangement is read defensively, and storage never throws.

function memoryStorage(fail = false) {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => {
      if (fail) throw new Error("refused");
      return items.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (fail) throw new Error("refused");
      items.set(k, v);
    },
    removeItem: (k: string) => {
      if (fail) throw new Error("refused");
      items.delete(k);
    },
  };
}

describe("views (lenses)", () => {
  it.each(COMMAND_LENSES)(
    "the %s view orders every widget once, shown or hidden",
    (lens) => {
      const layout = lensLayout(lens);
      expect([...layout.widgets.order].sort()).toEqual(
        [...COMMAND_WIDGETS].sort(),
      );
      for (const id of layout.widgets.hidden)
        expect(layout.widgets.order).toContain(id);
      expect(isLensLayout(layout, lens)).toBe(true);
    },
  );

  it("every view leads with what needs attention", () => {
    for (const lens of COMMAND_LENSES)
      expect(shownWidgets(lensLayout(lens).widgets)[0]).toBe("attention");
  });

  it("the executive view leads with money and adoption and hides the security detail", () => {
    const layout = lensLayout("executive");
    expect(shownWidgets(layout.widgets).slice(0, 4)).toEqual([
      "attention",
      "spend",
      "adoption",
      "topApps",
    ]);
    expect(layout.widgets.hidden).toEqual(
      expect.arrayContaining(["threats", "integrity"]),
    );
  });

  it("the security view shows posture and integrity and hides the money", () => {
    const layout = lensLayout("security");
    const shown = shownWidgets(layout.widgets);
    expect(shown.slice(0, 4)).toEqual([
      "attention",
      "posture",
      "stopped",
      "integrity",
    ]);
    expect(shown).not.toContain("spend");
    expect(shown).not.toContain("budgets");
  });

  it("the default is the everything view, with nothing hidden", () => {
    const layout = defaultCommandLayout();
    expect(layout.lens).toBe("everything");
    expect(layout.widgets.hidden).toEqual([]);
    expect(layout.widgets.order).toEqual([...COMMAND_WIDGETS]);
  });
});

describe("changes make the arrangement the person's own", () => {
  it("moving or hiding marks the view as custom", () => {
    const start = defaultCommandLayout();
    const moved = withWidgets(
      start,
      moveWidgetTo(start.widgets, "notRecorded", "attention"),
    );
    expect(moved.lens).toBe("custom");
    expect(moved.widgets.order[0]).toBe("notRecorded");
    expect(isLensLayout(moved, "everything")).toBe(false);
    const hidden = withWidgets(start, hideWidget(start.widgets, "spend"));
    expect(hidden.widgets.hidden).toEqual(["spend"]);
  });

  it("resizes one step at a time, between a third and the full width", () => {
    const start = defaultCommandLayout();
    expect(widgetSize(start, "posture")).toBe(1);
    const wider = resizeWidget(start, "posture", "wider");
    expect(widgetSize(wider, "posture")).toBe(2);
    expect(wider.lens).toBe("custom");
    const full = resizeWidget(wider, "posture", "wider");
    expect(widgetSize(full, "posture")).toBe(3);
    expect(resizeWidget(full, "posture", "wider")).toBe(full);
    expect(resizeWidget(start, "posture", "narrower")).toBe(start);
  });
});

describe("a stored arrangement is read defensively", () => {
  it("drops unknown widgets, duplicates and impossible widths", () => {
    const layout = sanitiseCommandLayout({
      lens: "boardroom",
      widgets: {
        order: ["spend", "spend", "dropTables", "attention"],
        hidden: ["nope", "budgets"],
      },
      sizes: { spend: 3, posture: 7, attention: "2", nope: 1 },
    });
    expect(layout.lens).toBe("custom");
    // The stored order holds; a widget it does not name returns after its
    // nearest default predecessor (ADR-0028's rule): attention stays after
    // spend, and adoption follows spend.
    expect(layout.widgets.order[0]).toBe("spend");
    expect(layout.widgets.order[1]).toBe("adoption");
    expect(layout.widgets.order.indexOf("attention")).toBeGreaterThan(0);
    expect([...layout.widgets.order].sort()).toEqual(
      [...COMMAND_WIDGETS].sort(),
    );
    expect(layout.widgets.hidden).toEqual(["budgets"]);
    expect(layout.sizes).toEqual({ spend: 3 });
  });

  it("anything unreadable gives the default", () => {
    for (const raw of [null, 42, "x", [], { widgets: "no" }]) {
      const layout = sanitiseCommandLayout(raw);
      expect(layout.widgets.order).toEqual([...COMMAND_WIDGETS]);
    }
  });
});

describe("storage, per person and project, in this browser", () => {
  it("keys by person and project", () => {
    expect(commandLayoutKey("u1", "p1")).toBe(
      "cairo.eyeonCommandCentre.v1:u1:p1",
    );
  });

  it("writes, reads back and clears", () => {
    const storage = memoryStorage();
    const key = commandLayoutKey("u1", "p1");
    const layout = resizeWidget(lensLayout("security"), "posture", "wider");
    expect(writeCommandLayout(storage, key, layout)).toBe(true);
    expect(readCommandLayout(storage, key)).toEqual(layout);
    clearCommandLayout(storage, key);
    expect(readCommandLayout(storage, key)).toEqual(defaultCommandLayout());
  });

  it("never throws when the browser refuses storage", () => {
    const storage = memoryStorage(true);
    const key = commandLayoutKey("u1", "p1");
    expect(writeCommandLayout(storage, key, defaultCommandLayout())).toBe(
      false,
    );
    expect(readCommandLayout(storage, key)).toEqual(defaultCommandLayout());
    expect(() => clearCommandLayout(storage, key)).not.toThrow();
    expect(writeCommandLayout(null, key, defaultCommandLayout())).toBe(false);
  });

  it("a corrupt stored value gives the default", () => {
    const storage = memoryStorage();
    const key = commandLayoutKey("u1", "p1");
    storage.items.set(key, "{not json");
    expect(readCommandLayout(storage, key)).toEqual(defaultCommandLayout());
  });
});
