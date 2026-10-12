import {
  isRailToggleShortcut,
  railAriaKeyShortcuts,
  railExpandedKey,
  railShortcutLabel,
  readRailExpanded,
  writeRailExpanded,
} from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailExpanded";
import { EYEON_RAIL_WIDTH_CLASS } from "@/src/features/acme-enhancements/components/eyeon/rail/eyeonRailLayout";

// CHG-2026-150 (ADR-0026 §12.5): the rail's compact or expanded choice,
// kept per person in this browser, and the shortcut that switches it, without
// a browser. Compact is the default and is kept as nothing; storage that
// refuses never throws; the shortcut is Ctrl+\ (Cmd+\ on a Mac) and never
// fires while typing.

const USER = "u1";
const KEY = "cairo.railExpanded.v1:u1";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

const refusing = {
  getItem: () => {
    throw new Error("refused");
  },
  setItem: () => {
    throw new Error("refused");
  },
  removeItem: () => {
    throw new Error("refused");
  },
};

describe("the kept choice (CHG-2026-150)", () => {
  it("is one versioned key per signed-in person, as the sidebar width is", () => {
    expect(railExpandedKey(USER)).toBe(KEY);
    expect(railExpandedKey("u2")).toBe("cairo.railExpanded.v1:u2");
  });

  it("is compact unless this person kept it expanded", () => {
    expect(readRailExpanded(memoryStorage(), USER)).toBe(false);
    expect(readRailExpanded(memoryStorage({ [KEY]: "true" }), USER)).toBe(true);
    // Another person's choice is theirs alone.
    expect(readRailExpanded(memoryStorage({ [KEY]: "true" }), "u2")).toBe(
      false,
    );
  });

  it("reads anything other than the expanded value as compact", () => {
    for (const value of ["false", "1", "TRUE", "yes", "", '{"x":1}']) {
      expect(readRailExpanded(memoryStorage({ [KEY]: value }), USER)).toBe(
        false,
      );
    }
  });

  it("is compact, and reads nothing, with no person or no storage", () => {
    const storage = memoryStorage({ [KEY]: "true" });
    const getItem = vi.spyOn(storage, "getItem");
    expect(readRailExpanded(storage, undefined)).toBe(false);
    expect(readRailExpanded(null, USER)).toBe(false);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("keeps expanded as a value and compact as nothing", () => {
    const storage = memoryStorage();
    expect(writeRailExpanded(storage, USER, true)).toBe(true);
    expect(storage.values.get(KEY)).toBe("true");
    expect(writeRailExpanded(storage, USER, false)).toBe(true);
    expect(storage.values.has(KEY)).toBe(false);
  });

  it("writes nothing with no person", () => {
    const storage = memoryStorage();
    expect(writeRailExpanded(storage, undefined, true)).toBe(false);
    expect(storage.values.size).toBe(0);
  });

  it("never throws when the browser refuses storage", () => {
    expect(readRailExpanded(refusing, USER)).toBe(false);
    expect(writeRailExpanded(refusing, USER, true)).toBe(false);
    expect(writeRailExpanded(refusing, USER, false)).toBe(false);
  });
});

/** A keydown as the window sees it; the target is the page unless given. */
function key(
  init: Partial<Parameters<typeof isRailToggleShortcut>[0]> = {},
): Parameters<typeof isRailToggleShortcut>[0] {
  return {
    key: "\\",
    code: "Backslash",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    target: document.body,
    ...init,
  };
}

describe("the shortcut (CHG-2026-150)", () => {
  it("is Ctrl+\\, or Cmd+\\ on a Mac", () => {
    expect(isRailToggleShortcut(key())).toBe(true);
    expect(isRailToggleShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(
      true,
    );
  });

  it("matches the backslash key by position too, for layouts that type it elsewhere", () => {
    // On a German layout the key in that position types "#".
    expect(isRailToggleShortcut(key({ key: "#" }))).toBe(true);
    // A backslash typed from another position (UK layout) also counts.
    expect(isRailToggleShortcut(key({ code: "IntlBackslash" }))).toBe(true);
  });

  it("needs Ctrl or Cmd, and nothing else held", () => {
    expect(isRailToggleShortcut(key({ ctrlKey: false }))).toBe(false);
    // The code editor binds Shift+Mod+\ and Mod+Alt+\; AltGr reports Alt.
    expect(isRailToggleShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isRailToggleShortcut(key({ altKey: true }))).toBe(false);
  });

  it("leaves other keys alone, including the sidebar's own Ctrl+B and the palette's Ctrl+K", () => {
    for (const [k, code] of [
      ["b", "KeyB"],
      ["k", "KeyK"],
      ["i", "KeyI"],
      ["[", "BracketLeft"],
      ["/", "Slash"],
    ]) {
      expect(isRailToggleShortcut(key({ key: k, code }))).toBe(false);
    }
  });

  it("ignores a held key's repeats and a key something else has handled", () => {
    expect(isRailToggleShortcut(key({ repeat: true }))).toBe(false);
    expect(isRailToggleShortcut(key({ defaultPrevented: true }))).toBe(false);
  });

  it("never fires while typing", () => {
    const editable = document.createElement("div");
    // jsdom does not compute isContentEditable; a browser does.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    const textbox = document.createElement("div");
    textbox.setAttribute("role", "textbox");
    for (const target of [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      editable,
      textbox,
    ]) {
      expect(isRailToggleShortcut(key({ target }))).toBe(false);
    }
  });

  it("fires with focus on a button or a link", () => {
    expect(
      isRailToggleShortcut(key({ target: document.createElement("button") })),
    ).toBe(true);
    expect(
      isRailToggleShortcut(key({ target: document.createElement("a") })),
    ).toBe(true);
  });

  it("is named for the platform in the tooltip and for assistive technology", () => {
    expect(railShortcutLabel(false)).toBe("Ctrl+\\");
    expect(railShortcutLabel(true)).toBe("⌘\\");
    expect(railAriaKeyShortcuts(false)).toBe("Control+\\");
    expect(railAriaKeyShortcuts(true)).toBe("Meta+\\");
  });
});

describe("the width the rail hands the sidebar (CHG-2026-150)", () => {
  // The sidebar's panel offset and its header row both read
  // --eyeon-rail-width; if it ever differs from the rail's own width, the
  // two overlap or leave a gap.
  const REM_PER_STEP = 0.25;

  it.each(Object.entries(EYEON_RAIL_WIDTH_CLASS))(
    "%s: the variable is the rail's own width",
    (_mode, classes) => {
      const width = /(?:^| )w-(\d+)(?: |$)/.exec(classes)?.[1];
      const handed = /--eyeon-rail-width:([\d.]+)rem/.exec(classes)?.[1];
      expect(width).toBeDefined();
      expect(handed).toBeDefined();
      expect(Number(width) * REM_PER_STEP).toBe(Number(handed));
    },
  );

  it("compact is today's rail; expanded is wider", () => {
    expect(EYEON_RAIL_WIDTH_CLASS.compact).toContain("w-22");
    expect(EYEON_RAIL_WIDTH_CLASS.expanded).toContain("w-52");
  });

  // CHG-2026-153: in a short window the rail is wider by the scrollbar's lane,
  // and the sidebar is handed the same wider width.
  it.each(Object.entries(EYEON_RAIL_WIDTH_CLASS))(
    "%s: on a short window the variable is still the rail's own width, one rem wider",
    (_mode, classes) => {
      const base = /(?:^| )w-(\d+)(?: |$)/.exec(classes)?.[1];
      const short = /\[@media\(max-height:700px\)\]:w-(\d+)(?: |$)/.exec(
        classes,
      )?.[1];
      const handed =
        /\[@media\(max-height:700px\)\]:\[&~\[data-side=left\]\]:\[--eyeon-rail-width:([\d.]+)rem\]/.exec(
          classes,
        )?.[1];
      expect(base).toBeDefined();
      expect(short).toBeDefined();
      expect(handed).toBeDefined();
      expect(Number(short) * REM_PER_STEP).toBe(Number(handed));
      expect((Number(short) - Number(base)) * REM_PER_STEP).toBe(1);
    },
  );
});
