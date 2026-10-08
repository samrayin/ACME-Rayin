import { describe, expect, it } from "vitest";
import {
  EYEON_HOME_CARDS,
  EYEON_HOME_CARD_WIDTH,
  EYEON_HOME_TILES,
  type ArrangeZone,
  cardSpans,
  clearEyeonHomeLayout,
  defaultEyeonHomeLayout,
  eyeonHomeLayoutKey,
  hiddenWidgets,
  hideWidget,
  isDefaultEyeonHomeLayout,
  moveWidget,
  moveWidgetTo,
  readEyeonHomeLayout,
  sanitiseEyeonHomeLayout,
  showWidget,
  shownWidgets,
  writeEyeonHomeLayout,
} from "@/src/features/acme-enhancements/utils/eyeonHomeLayout";

// CHG-2026-136 (ADR-0028): arranging EYEON Home. Moving steps over hidden
// widgets; a stored arrangement is sanitised (unknown ids and duplicates
// dropped, new widgets back in their default place); storage failures never
// throw; the default card layout is the overview's own.

const zone = (order: string[], hidden: string[] = []): ArrangeZone<string> => ({
  order,
  hidden,
});

describe("moving a widget", () => {
  it("moves one place earlier or later, and not past either end", () => {
    const z = zone(["a", "b", "c"]);
    expect(moveWidget(z, "b", "earlier").order).toEqual(["b", "a", "c"]);
    expect(moveWidget(z, "b", "later").order).toEqual(["a", "c", "b"]);
    expect(moveWidget(z, "a", "earlier")).toBe(z);
    expect(moveWidget(z, "c", "later")).toBe(z);
  });

  it("steps over hidden and unavailable widgets, so each press visibly moves it", () => {
    const z = zone(["a", "h", "b", "u", "c"], ["h"]);
    const available = (id: string) => id !== "u";
    expect(moveWidget(z, "b", "earlier", available).order).toEqual([
      "b",
      "a",
      "h",
      "u",
      "c",
    ]);
    expect(moveWidget(z, "b", "later", available).order).toEqual([
      "a",
      "h",
      "u",
      "c",
      "b",
    ]);
  });

  it("leaves the group unchanged for an unknown or hidden widget", () => {
    const z = zone(["a", "b"], ["b"]);
    expect(moveWidget(z, "x", "later")).toBe(z);
    expect(moveWidget(z, "b", "earlier")).toBe(z);
  });

  it("a drop takes the target's place, before it moving back and after it moving forward", () => {
    const z = zone(["a", "b", "c", "d"]);
    expect(moveWidgetTo(z, "a", "c").order).toEqual(["b", "c", "a", "d"]);
    expect(moveWidgetTo(z, "d", "b").order).toEqual(["a", "d", "b", "c"]);
    expect(moveWidgetTo(z, "a", "a")).toBe(z);
    expect(moveWidgetTo(z, "a", "x")).toBe(z);
  });
});

describe("hiding and showing", () => {
  it("hides a widget once and lists it, in its place's order, for showing again", () => {
    let z = zone(["a", "b", "c"]);
    z = hideWidget(z, "c");
    z = hideWidget(z, "a");
    expect(hideWidget(z, "a")).toBe(z);
    expect(hideWidget(z, "x")).toBe(z);
    expect(shownWidgets(z)).toEqual(["b"]);
    expect(hiddenWidgets(z)).toEqual(["a", "c"]);
    z = showWidget(z, "a");
    expect(shownWidgets(z)).toEqual(["a", "b"]);
    expect(showWidget(z, "a")).toBe(z);
  });

  it("does not list a hidden widget the viewer cannot have", () => {
    const z = zone(["a", "spend"], ["spend"]);
    expect(hiddenWidgets(z, (id) => id !== "spend")).toEqual([]);
  });
});

describe("sanitising a stored arrangement", () => {
  it("gives the default for anything unreadable", () => {
    for (const value of [null, undefined, 42, "x", [], { tiles: "x" }]) {
      expect(sanitiseEyeonHomeLayout(value)).toEqual(defaultEyeonHomeLayout());
    }
  });

  it("drops unknown ids and duplicates, in the order and in the hidden list", () => {
    const layout = sanitiseEyeonHomeLayout({
      tiles: {
        order: [
          "noVerdict",
          "bogus",
          "noVerdict",
          "checks",
          7,
          "promptsRefused",
          "answersWithheld",
          "redactions",
          "applicationsNeedingAction",
        ],
        hidden: ["checks", "checks", "spend", "bogus"],
      },
      cards: { order: ["spend", "checks"], hidden: ["spend"] },
      extra: true,
    });
    expect(layout.tiles.order).toEqual([
      "noVerdict",
      "checks",
      "promptsRefused",
      "answersWithheld",
      "redactions",
      "applicationsNeedingAction",
    ]);
    expect(layout.tiles.hidden).toEqual(["checks"]);
    expect(layout.cards.hidden).toEqual(["spend"]);
    expect([...layout.cards.order].sort()).toEqual(
      [...EYEON_HOME_CARDS].sort(),
    );
  });

  it("puts a widget missing from the stored order back in its default place", () => {
    // "answersWithheld" is new since this was saved: it follows
    // "promptsRefused", as by default, wherever that one now is.
    const layout = sanitiseEyeonHomeLayout({
      tiles: {
        order: [
          "promptsRefused",
          "checks",
          "redactions",
          "noVerdict",
          "applicationsNeedingAction",
        ],
        hidden: [],
      },
      // Only "spend" was stored: "decisions" and the others come back around
      // it in their default order, "decisions" first as it leads by default.
      cards: { order: ["spend"], hidden: [] },
    });
    expect(layout.tiles.order).toEqual([
      "promptsRefused",
      "answersWithheld",
      "checks",
      "redactions",
      "noVerdict",
      "applicationsNeedingAction",
    ]);
    expect(layout.cards.order).toEqual([
      "decisions",
      "enforcement",
      "applications",
      "spend",
      "notRecorded",
    ]);
  });

  it("knows the default arrangement, so Reset can say there is nothing to reset", () => {
    expect(isDefaultEyeonHomeLayout(defaultEyeonHomeLayout())).toBe(true);
    const layout = defaultEyeonHomeLayout();
    expect(
      isDefaultEyeonHomeLayout({
        ...layout,
        tiles: hideWidget(layout.tiles, "checks"),
      }),
    ).toBe(false);
    expect(
      isDefaultEyeonHomeLayout({
        ...layout,
        cards: moveWidget(layout.cards, "spend", "earlier"),
      }),
    ).toBe(false);
    expect(defaultEyeonHomeLayout().tiles.order).toEqual(EYEON_HOME_TILES);
  });
});

describe("card widths", () => {
  const width = (id: (typeof EYEON_HOME_CARDS)[number]) =>
    EYEON_HOME_CARD_WIDTH[id];

  it("the default order gives the overview's own layout", () => {
    expect(Object.fromEntries(cardSpans(EYEON_HOME_CARDS, width))).toEqual({
      decisions: 2,
      enforcement: 1,
      applications: 2,
      spend: 1,
      notRecorded: 3,
    });
  });

  it("without the spend card, Applications fills its row, as before", () => {
    const shown = EYEON_HOME_CARDS.filter((id) => id !== "spend");
    expect(cardSpans(shown, width).get("applications")).toBe(3);
  });

  it("widens the last card of a row so no row ends in a gap", () => {
    const spans = cardSpans(
      ["enforcement", "notRecorded", "spend", "decisions"] as const,
      width,
    );
    expect(Object.fromEntries(spans)).toEqual({
      enforcement: 3,
      notRecorded: 3,
      spend: 1,
      decisions: 2,
    });
    expect(Object.fromEntries(cardSpans(["spend"] as const, width))).toEqual({
      spend: 3,
    });
  });
});

describe("storage", () => {
  function memoryStorage() {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => {
        items.set(k, v);
      },
      removeItem: (k: string) => {
        items.delete(k);
      },
    };
  }
  const refusing = {
    getItem: () => {
      throw new Error("refused");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("refused");
    },
  };

  it("keys the arrangement by a versioned prefix, the person and the project", () => {
    expect(eyeonHomeLayoutKey("user-1", "proj-1")).toBe(
      "cairo.eyeonHomeLayout.v1:user-1:proj-1",
    );
  });

  it("writes, reads back and clears an arrangement", () => {
    const storage = memoryStorage();
    const key = eyeonHomeLayoutKey("u", "p");
    const layout = defaultEyeonHomeLayout();
    const moved = {
      ...layout,
      cards: hideWidget(
        moveWidget(layout.cards, "spend", "earlier"),
        "notRecorded",
      ),
    };
    expect(writeEyeonHomeLayout(storage, key, moved)).toBe(true);
    expect(readEyeonHomeLayout(storage, key)).toEqual(moved);
    expect(
      readEyeonHomeLayout(storage, eyeonHomeLayoutKey("u", "other")),
    ).toEqual(defaultEyeonHomeLayout());
    clearEyeonHomeLayout(storage, key);
    expect(storage.items.size).toBe(0);
    expect(readEyeonHomeLayout(storage, key)).toEqual(defaultEyeonHomeLayout());
  });

  it("reads corrupt or hand-edited JSON as the default, sanitised", () => {
    const storage = memoryStorage();
    storage.setItem("k", "{not json");
    expect(readEyeonHomeLayout(storage, "k")).toEqual(defaultEyeonHomeLayout());
    storage.setItem(
      "k",
      JSON.stringify({ tiles: { order: ["checks", "checks"], hidden: ["x"] } }),
    );
    expect(readEyeonHomeLayout(storage, "k").tiles).toEqual({
      order: [...EYEON_HOME_TILES],
      hidden: [],
    });
  });

  it("never throws when the browser refuses, or has no storage", () => {
    const layout = defaultEyeonHomeLayout();
    expect(readEyeonHomeLayout(refusing, "k")).toEqual(layout);
    expect(writeEyeonHomeLayout(refusing, "k", layout)).toBe(false);
    expect(() => clearEyeonHomeLayout(refusing, "k")).not.toThrow();
    expect(readEyeonHomeLayout(null, "k")).toEqual(layout);
    expect(writeEyeonHomeLayout(null, "k", layout)).toBe(false);
    expect(() => clearEyeonHomeLayout(null, "k")).not.toThrow();
  });
});
