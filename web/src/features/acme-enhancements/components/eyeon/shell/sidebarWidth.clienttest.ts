import {
  SIDEBAR_WIDTH_DEFAULT_REM,
  SIDEBAR_WIDTH_MAX_REM,
  SIDEBAR_WIDTH_MIN_REM,
  SIDEBAR_WIDTH_STEP_REM,
  clampSidebarWidth,
  loadSidebarWidth,
  readStoredSidebarWidth,
  sanitiseSidebarWidth,
  sidebarMaxForWindow,
  sidebarWidthAfterDrag,
  sidebarWidthForKey,
  sidebarWidthKey,
  sidebarWidthText,
  stepSidebarWidth,
  writeStoredSidebarWidth,
} from "@/src/features/acme-enhancements/components/eyeon/shell/sidebarWidth";

// CHG-2026-142 (ADR-0026 §12.4): the sidebar width's rules, without a
// browser: the limits, what is accepted from storage, the keyboard steps,
// the reset and the drag. The follow-up (owner, 2026-10-08): the window's
// own maximum, one key per signed-in person, and the one-time move of the
// browser's old key.

const USER = "u1";
const KEY = "cairo.sidebarWidth.v1:u1";
const LEGACY_KEY = "cairo.sidebarWidth.v1";

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

describe("the limits (CHG-2026-142)", () => {
  it("are today's width at the narrow end and 24rem at the wide end", () => {
    expect(SIDEBAR_WIDTH_DEFAULT_REM).toBe(11.5);
    expect(SIDEBAR_WIDTH_MIN_REM).toBe(SIDEBAR_WIDTH_DEFAULT_REM);
    expect(SIDEBAR_WIDTH_MAX_REM).toBe(24);
    expect(SIDEBAR_WIDTH_STEP_REM).toBe(0.5);
  });
});

describe("sidebarMaxForWindow (CHG-2026-142 follow-up)", () => {
  it("is a quarter of the window, in rem", () => {
    expect(sidebarMaxForWindow(800, 16)).toBe(12.5);
    expect(sidebarMaxForWindow(1024, 16)).toBe(16);
    expect(sidebarMaxForWindow(1280, 16)).toBe(20);
    expect(sidebarMaxForWindow(1440, 16)).toBe(22.5);
  });

  it("is never below the default, however narrow the window", () => {
    expect(sidebarMaxForWindow(736, 16)).toBe(SIDEBAR_WIDTH_DEFAULT_REM);
    expect(sidebarMaxForWindow(500, 16)).toBe(SIDEBAR_WIDTH_DEFAULT_REM);
    expect(sidebarMaxForWindow(375, 16)).toBe(SIDEBAR_WIDTH_DEFAULT_REM);
    expect(sidebarMaxForWindow(1, 16)).toBe(SIDEBAR_WIDTH_DEFAULT_REM);
  });

  it("is never above 24rem, however wide the window", () => {
    expect(sidebarMaxForWindow(1536, 16)).toBe(24);
    expect(sidebarMaxForWindow(1920, 16)).toBe(24);
    expect(sidebarMaxForWindow(3840, 16)).toBe(24);
  });

  it("rounds down to 1/16 rem, so it never exceeds a quarter", () => {
    // 1001 / 4 = 250.25px: 15.625rem, not 15.640625rem.
    expect(sidebarMaxForWindow(1001, 16)).toBe(15.625);
    expect(sidebarMaxForWindow(1003, 16)).toBe(15.625);
    expect(sidebarMaxForWindow(1004, 16)).toBe(15.6875);
  });

  it("follows the root font size, and assumes 16px when it is unknown", () => {
    expect(sidebarMaxForWindow(1280, 20)).toBe(16);
    expect(sidebarMaxForWindow(1280, Number.NaN)).toBe(20);
    expect(sidebarMaxForWindow(1280, 0)).toBe(20);
  });

  it("allows the full 24rem when the window cannot be measured", () => {
    expect(sidebarMaxForWindow(0, 16)).toBe(24);
    expect(sidebarMaxForWindow(-100, 16)).toBe(24);
    expect(sidebarMaxForWindow(Number.NaN, 16)).toBe(24);
    expect(sidebarMaxForWindow(Number.POSITIVE_INFINITY, 16)).toBe(24);
  });
});

describe("clampSidebarWidth", () => {
  it("keeps a width within the limits", () => {
    expect(clampSidebarWidth(15)).toBe(15);
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MIN_REM)).toBe(11.5);
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MAX_REM)).toBe(24);
  });

  it("brings a width outside the limits to the nearest limit", () => {
    expect(clampSidebarWidth(4)).toBe(11.5);
    expect(clampSidebarWidth(-20)).toBe(11.5);
    expect(clampSidebarWidth(30)).toBe(24);
    expect(clampSidebarWidth(Number.MAX_VALUE)).toBe(24);
  });

  it("rounds to a pixel (1/16 rem)", () => {
    expect(clampSidebarWidth(15.03)).toBe(15);
    expect(clampSidebarWidth(15.04)).toBe(15.0625);
  });

  it("gives the default for anything that is not a finite number", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(11.5);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(11.5);
    expect(clampSidebarWidth(Number.NEGATIVE_INFINITY)).toBe(11.5);
  });

  it("stops at the window's maximum when given (CHG-2026-142 follow-up)", () => {
    const narrow = sidebarMaxForWindow(1000, 16); // 15.625rem
    expect(clampSidebarWidth(20, narrow)).toBe(15.625);
    expect(clampSidebarWidth(24, narrow)).toBe(15.625);
    expect(clampSidebarWidth(13, narrow)).toBe(13);
    expect(clampSidebarWidth(4, narrow)).toBe(11.5);
    expect(clampSidebarWidth(20, sidebarMaxForWindow(600, 16))).toBe(11.5);
  });

  it("keeps a given maximum within the fixed limits", () => {
    expect(clampSidebarWidth(30, 40)).toBe(24);
    expect(clampSidebarWidth(20, 5)).toBe(11.5);
    expect(clampSidebarWidth(20, Number.NaN)).toBe(20);
  });
});

describe("sanitiseSidebarWidth", () => {
  it("accepts a number within the limits", () => {
    expect(sanitiseSidebarWidth(16)).toBe(16);
    expect(sanitiseSidebarWidth(11.5)).toBe(11.5);
    expect(sanitiseSidebarWidth(24)).toBe(24);
  });

  it("gives the default for anything else, rather than clamping it", () => {
    for (const value of [
      11,
      24.5,
      999,
      -3,
      0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "16",
      "16rem",
      null,
      undefined,
      true,
      {},
      [16],
    ]) {
      expect(sanitiseSidebarWidth(value)).toBe(11.5);
    }
  });
});

describe("stepSidebarWidth", () => {
  it("moves half a rem at a time", () => {
    expect(stepSidebarWidth(15, "wider")).toBe(15.5);
    expect(stepSidebarWidth(15, "narrower")).toBe(14.5);
  });

  it("stops at the limits", () => {
    expect(stepSidebarWidth(11.5, "narrower")).toBe(11.5);
    expect(stepSidebarWidth(23.75, "wider")).toBe(24);
    expect(stepSidebarWidth(24, "wider")).toBe(24);
  });

  it("stops at the window's maximum when given (CHG-2026-142 follow-up)", () => {
    expect(stepSidebarWidth(15.5, "wider", 15.625)).toBe(15.625);
    expect(stepSidebarWidth(15.625, "wider", 15.625)).toBe(15.625);
    expect(stepSidebarWidth(15.625, "narrower", 15.625)).toBe(15.125);
  });
});

describe("sidebarWidthForKey", () => {
  it("steps with the arrow keys: right widens a left sidebar", () => {
    expect(sidebarWidthForKey("ArrowRight", 15, "left")).toBe(15.5);
    expect(sidebarWidthForKey("ArrowLeft", 15, "left")).toBe(14.5);
  });

  it("moves the edge, not the width, for a right sidebar", () => {
    expect(sidebarWidthForKey("ArrowLeft", 15, "right")).toBe(15.5);
    expect(sidebarWidthForKey("ArrowRight", 15, "right")).toBe(14.5);
  });

  it("goes to the limits with Home and End", () => {
    expect(sidebarWidthForKey("Home", 18, "left")).toBe(SIDEBAR_WIDTH_MIN_REM);
    expect(sidebarWidthForKey("End", 18, "left")).toBe(SIDEBAR_WIDTH_MAX_REM);
  });

  it("goes no wider than the window's maximum (CHG-2026-142 follow-up)", () => {
    expect(sidebarWidthForKey("End", 12, "left", 20)).toBe(20);
    expect(sidebarWidthForKey("ArrowRight", 20, "left", 20)).toBe(20);
    expect(sidebarWidthForKey("ArrowLeft", 20, "right", 20)).toBe(20);
    expect(sidebarWidthForKey("Home", 20, "left", 20)).toBe(11.5);
    expect(sidebarWidthForKey("Enter", 20, "left", 20)).toBe(11.5);
    // A maximum outside the limits is brought within them.
    expect(sidebarWidthForKey("End", 12, "left", 99)).toBe(24);
  });

  it("resets to the default with Enter", () => {
    expect(sidebarWidthForKey("Enter", 20, "left")).toBe(
      SIDEBAR_WIDTH_DEFAULT_REM,
    );
  });

  it("ignores every other key", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Escape", " ", "Tab", "a"]) {
      expect(sidebarWidthForKey(key, 15, "left")).toBeNull();
    }
  });
});

describe("sidebarWidthAfterDrag", () => {
  it("adds the distance dragged, in rem", () => {
    expect(sidebarWidthAfterDrag(11.5, 64, 16, "left")).toBe(15.5);
    expect(sidebarWidthAfterDrag(15.5, -32, 16, "left")).toBe(13.5);
  });

  it("follows the root font size", () => {
    expect(sidebarWidthAfterDrag(11.5, 40, 20, "left")).toBe(13.5);
  });

  it("widens a right sidebar when dragged left", () => {
    expect(sidebarWidthAfterDrag(11.5, -64, 16, "right")).toBe(15.5);
  });

  it("stays within the limits however far it goes", () => {
    expect(sidebarWidthAfterDrag(11.5, 5000, 16, "left")).toBe(24);
    expect(sidebarWidthAfterDrag(20, -5000, 16, "left")).toBe(11.5);
  });

  it("stops at the window's maximum when given (CHG-2026-142 follow-up)", () => {
    expect(sidebarWidthAfterDrag(11.5, 5000, 16, "left", 16)).toBe(16);
    expect(sidebarWidthAfterDrag(11.5, 32, 16, "left", 16)).toBe(13.5);
  });

  it("assumes 16px to the rem when the root font size is unknown", () => {
    expect(sidebarWidthAfterDrag(11.5, 64, Number.NaN, "left")).toBe(15.5);
    expect(sidebarWidthAfterDrag(11.5, 64, 0, "left")).toBe(15.5);
  });
});

describe("sidebarWidthText", () => {
  it("names the width, and the default as such", () => {
    expect(sidebarWidthText(11.5)).toBe("11.5 rem, the default");
    expect(sidebarWidthText(15.0625)).toBe("15.06 rem");
    expect(sidebarWidthText(24)).toBe("24 rem");
  });
});

describe("the stored width", () => {
  it("is read back as it was kept", () => {
    const storage = memoryStorage();
    expect(writeStoredSidebarWidth(storage, USER, 17.5)).toBe(true);
    expect(storage.values.get(KEY)).toBe("17.5");
    expect(readStoredSidebarWidth(storage, USER)).toBe(17.5);
    expect(loadSidebarWidth(storage, USER)).toBe(17.5);
  });

  it("is the default when nothing is kept", () => {
    expect(readStoredSidebarWidth(memoryStorage(), USER)).toBe(11.5);
    expect(readStoredSidebarWidth(null, USER)).toBe(11.5);
    expect(loadSidebarWidth(memoryStorage(), USER)).toBe(11.5);
    expect(loadSidebarWidth(null, USER)).toBe(11.5);
  });

  it("is the default when what is kept is not a width within the limits", () => {
    for (const raw of ["999", "-3", "abc", '"16"', "{}", "", "null", "1e400"]) {
      expect(readStoredSidebarWidth(memoryStorage({ [KEY]: raw }), USER)).toBe(
        11.5,
      );
      expect(loadSidebarWidth(memoryStorage({ [KEY]: raw }), USER)).toBe(11.5);
    }
  });

  it("is removed, not kept, when it is the default (a reset leaves no trace)", () => {
    const storage = memoryStorage({ [KEY]: "20" });
    expect(
      writeStoredSidebarWidth(storage, USER, SIDEBAR_WIDTH_DEFAULT_REM),
    ).toBe(true);
    expect(storage.values.has(KEY)).toBe(false);
  });

  it("is clamped to the fixed limits before it is kept", () => {
    const storage = memoryStorage();
    writeStoredSidebarWidth(storage, USER, 40);
    expect(storage.values.get(KEY)).toBe("24");
  });

  it("never throws when the browser refuses", () => {
    expect(readStoredSidebarWidth(refusing, USER)).toBe(11.5);
    expect(loadSidebarWidth(refusing, USER)).toBe(11.5);
    expect(writeStoredSidebarWidth(refusing, USER, 16)).toBe(false);
    expect(writeStoredSidebarWidth(refusing, USER, 11.5)).toBe(false);
    expect(writeStoredSidebarWidth(null, USER, 16)).toBe(false);
  });
});

describe("one width per person (CHG-2026-142 follow-up)", () => {
  it("is kept under a versioned key that names the person", () => {
    expect(sidebarWidthKey("u1")).toBe("cairo.sidebarWidth.v1:u1");
    expect(sidebarWidthKey("clx9abc")).toBe("cairo.sidebarWidth.v1:clx9abc");
  });

  it("keeps each person's width apart in one browser", () => {
    const storage = memoryStorage();
    writeStoredSidebarWidth(storage, "u1", 18);
    writeStoredSidebarWidth(storage, "u2", 14);

    expect(readStoredSidebarWidth(storage, "u1")).toBe(18);
    expect(readStoredSidebarWidth(storage, "u2")).toBe(14);
    expect(readStoredSidebarWidth(storage, "u3")).toBe(11.5);

    writeStoredSidebarWidth(storage, "u2", SIDEBAR_WIDTH_DEFAULT_REM);
    expect(readStoredSidebarWidth(storage, "u1")).toBe(18);
    expect([...storage.values.keys()]).toEqual(["cairo.sidebarWidth.v1:u1"]);
  });

  it("with no person yet: the default, and nothing read or written", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: "20", [KEY]: "18" });
    const getItem = vi.spyOn(storage, "getItem");
    const setItem = vi.spyOn(storage, "setItem");
    const removeItem = vi.spyOn(storage, "removeItem");

    for (const userId of [undefined, ""]) {
      expect(loadSidebarWidth(storage, userId)).toBe(11.5);
      expect(readStoredSidebarWidth(storage, userId)).toBe(11.5);
      expect(writeStoredSidebarWidth(storage, userId, 16)).toBe(false);
      expect(writeStoredSidebarWidth(storage, userId, 11.5)).toBe(false);
    }

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(Object.fromEntries(storage.values)).toEqual({
      [LEGACY_KEY]: "20",
      [KEY]: "18",
    });
  });
});

describe("the move from the browser's old key (CHG-2026-142 follow-up)", () => {
  it("gives the old width to a person with none of their own, once", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: "20" });

    expect(loadSidebarWidth(storage, USER)).toBe(20);
    expect(storage.values.get(KEY)).toBe("20");
    expect(storage.values.has(LEGACY_KEY)).toBe(false);

    // Once moved, it is theirs only: the next person starts at the default.
    expect(loadSidebarWidth(storage, "u2")).toBe(11.5);
    expect(storage.values.has("cairo.sidebarWidth.v1:u2")).toBe(false);
    // And a second load only reads.
    const setItem = vi.spyOn(storage, "setItem");
    expect(loadSidebarWidth(storage, USER)).toBe(20);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("leaves the old key alone when the person already has their own", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: "20", [KEY]: "14" });

    expect(loadSidebarWidth(storage, USER)).toBe(14);
    expect(storage.values.get(KEY)).toBe("14");
    expect(storage.values.get(LEGACY_KEY)).toBe("20");
  });

  it("does not move an old value that is not a width: it is removed, nothing is kept", () => {
    for (const raw of ["999", "abc", '"16"', "{}"]) {
      const storage = memoryStorage({ [LEGACY_KEY]: raw });
      expect(loadSidebarWidth(storage, USER)).toBe(11.5);
      expect(storage.values.size).toBe(0);
    }
  });

  it("an old value at the default is removed and nothing is kept", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: "11.5" });
    expect(loadSidebarWidth(storage, USER)).toBe(11.5);
    expect(storage.values.size).toBe(0);
  });

  it("keeps the old key when the person's key cannot be written, so nothing is lost", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: "20" });
    storage.setItem = () => {
      throw new Error("refused");
    };

    expect(loadSidebarWidth(storage, USER)).toBe(20);
    expect(storage.values.get(LEGACY_KEY)).toBe("20");
    expect(storage.values.has(KEY)).toBe(false);
  });

  it("still gives the old width when only its removal is refused", () => {
    const storage = memoryStorage({ [LEGACY_KEY]: "20" });
    storage.removeItem = () => {
      throw new Error("refused");
    };

    expect(loadSidebarWidth(storage, USER)).toBe(20);
    expect(storage.values.get(KEY)).toBe("20");
  });
});
