import {
  SIDEBAR_WIDTH_DEFAULT_REM,
  SIDEBAR_WIDTH_MAX_REM,
  SIDEBAR_WIDTH_MIN_REM,
  SIDEBAR_WIDTH_STEP_REM,
  clampSidebarWidth,
  readStoredSidebarWidth,
  sanitiseSidebarWidth,
  sidebarWidthAfterDrag,
  sidebarWidthForKey,
  sidebarWidthText,
  stepSidebarWidth,
  writeStoredSidebarWidth,
} from "@/src/features/acme-enhancements/components/eyeon/shell/sidebarWidth";

// CHG-2026-142 (ADR-0026 §12.4): the sidebar width's rules, without a
// browser: the limits, what is accepted from storage, the keyboard steps,
// the reset and the drag.

const KEY = "cairo.sidebarWidth.v1";

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
    expect(writeStoredSidebarWidth(storage, 17.5)).toBe(true);
    expect(storage.values.get(KEY)).toBe("17.5");
    expect(readStoredSidebarWidth(storage)).toBe(17.5);
  });

  it("is the default when nothing is kept", () => {
    expect(readStoredSidebarWidth(memoryStorage())).toBe(11.5);
    expect(readStoredSidebarWidth(null)).toBe(11.5);
  });

  it("is the default when what is kept is not a width within the limits", () => {
    for (const raw of ["999", "-3", "abc", '"16"', "{}", "", "null", "1e400"]) {
      expect(readStoredSidebarWidth(memoryStorage({ [KEY]: raw }))).toBe(11.5);
    }
  });

  it("is removed, not kept, when it is the default (a reset leaves no trace)", () => {
    const storage = memoryStorage({ [KEY]: "20" });
    expect(writeStoredSidebarWidth(storage, SIDEBAR_WIDTH_DEFAULT_REM)).toBe(
      true,
    );
    expect(storage.values.has(KEY)).toBe(false);
  });

  it("is clamped before it is kept", () => {
    const storage = memoryStorage();
    writeStoredSidebarWidth(storage, 40);
    expect(storage.values.get(KEY)).toBe("24");
  });

  it("never throws when the browser refuses", () => {
    expect(readStoredSidebarWidth(refusing)).toBe(11.5);
    expect(writeStoredSidebarWidth(refusing, 16)).toBe(false);
    expect(writeStoredSidebarWidth(refusing, 11.5)).toBe(false);
    expect(writeStoredSidebarWidth(null, 16)).toBe(false);
  });
});
