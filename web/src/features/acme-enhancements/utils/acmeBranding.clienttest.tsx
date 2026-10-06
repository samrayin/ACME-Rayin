// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LangfuseInternalTraceEnvironment } from "@langfuse/shared";
import {
  useSidebarFilterState,
  type CategoricalUIFilter,
} from "@/src/features/filters/hooks/useSidebarFilterState";
import type { FilterConfig } from "@/src/features/filters/lib/filter-config";
import { getPageMetadata } from "@/src/components/layouts/default-head/getPageMetadata";
import { EnvironmentBadge } from "@/src/features/traces/components/TraceMetadataBadges";
import {
  acmeEnvironmentLabel,
  acmeEnvironmentOptions,
  acmePageTitle,
} from "./acmeBranding";

// The sidebar hook calls useQueryParam even for "memory" state; stub it so no
// QueryParamProvider is needed.
vi.mock("use-query-params", async () => {
  const actual = await vi.importActual("use-query-params");
  return {
    ...actual,
    StringParam: {},
    useQueryParam: () => [null, () => {}] as const,
  };
});

describe("acmePageTitle (CHG-2026-085)", () => {
  it("names the page and EYEON, or EYEON alone", () => {
    expect(acmePageTitle("Home")).toBe("Home | EYEON");
    expect(acmePageTitle()).toBe("EYEON");
    expect(acmePageTitle("")).toBe("EYEON");
  });

  it("titles every self-hosted page EYEON, never Langfuse", () => {
    for (const pathname of [
      "/auth/sign-in",
      "/auth/sign-up",
      "/auth/reset-password",
      "/auth/setup-password",
      "/project/p1/traces",
    ]) {
      const { title, description } = getPageMetadata(pathname, undefined);
      expect(title).toMatch(/EYEON$/);
      expect(title).not.toContain("Langfuse");
      expect(description ?? "").not.toContain("Langfuse");
    }
    expect(getPageMetadata("/auth/sign-in", undefined).title).toBe(
      "Sign in | EYEON",
    );
  });
});

describe("acmeEnvironmentLabel (CHG-2026-085)", () => {
  it("shows every Langfuse internal environment as eyeon-…", () => {
    for (const environment of Object.values(LangfuseInternalTraceEnvironment)) {
      const label = acmeEnvironmentLabel(environment);
      expect(label).toBe(environment.replace(/^langfuse-/, "eyeon-"));
      expect(label).not.toContain("langfuse");
    }
    expect(acmeEnvironmentLabel("langfuse-llm-as-a-judge")).toBe(
      "eyeon-llm-as-a-judge",
    );
    expect(acmeEnvironmentLabel("langfuse-evaluation")).toBe(
      "eyeon-evaluation",
    );
  });

  it("leaves customer environments as they are", () => {
    for (const environment of [
      "production",
      "default",
      "sdk-experiment",
      "langfuse",
      "my-langfuse-env",
      "",
    ]) {
      expect(acmeEnvironmentLabel(environment)).toBe(environment);
    }
  });
});

describe("acmeEnvironmentOptions (CHG-2026-085)", () => {
  it("labels internal environments and keeps every stored value", () => {
    const options = acmeEnvironmentOptions([
      { value: "production", count: 3 },
      { value: "langfuse-llm-as-a-judge", count: 2 },
      { value: "langfuse-code-eval", displayValue: "Code eval" },
      { value: "" },
    ]);

    expect(options.map((option) => option.value)).toEqual([
      "production",
      "langfuse-llm-as-a-judge",
      "langfuse-code-eval",
      "",
    ]);
    expect(options[0]).toEqual({ value: "production", count: 3 });
    expect(options[1]).toEqual({
      value: "langfuse-llm-as-a-judge",
      count: 2,
      displayValue: "eyeon-llm-as-a-judge",
    });
    // An option that already has a label keeps it.
    expect(options[2]?.displayValue).toBe("Code eval");
    // The empty environment keeps the "(empty)" fallback of the selects.
    expect(options[3]).toEqual({ value: "" });
  });
});

describe("EnvironmentBadge (CHG-2026-085)", () => {
  it("shows the EYEON label for an internal environment", () => {
    render(
      <>
        <EnvironmentBadge environment="langfuse-llm-as-a-judge" />
        <EnvironmentBadge environment="production" />
      </>,
    );

    expect(screen.getByText("Env: eyeon-llm-as-a-judge")).toBeInTheDocument();
    expect(screen.getByText("Env: production")).toBeInTheDocument();
    expect(screen.queryByText(/langfuse-/)).not.toBeInTheDocument();
  });
});

const ENVIRONMENT_FILTER_CONFIG: FilterConfig = {
  tableName: "traces",
  columnDefinitions: [
    {
      id: "environment",
      name: "Environment",
      type: "stringOptions",
      options: [],
      internal: 't."environment"',
    },
  ],
  facets: [
    { type: "categorical", column: "environment", label: "Environment" },
  ],
};

function EnvironmentFacetHarness() {
  const { filters } = useSidebarFilterState(
    ENVIRONMENT_FILTER_CONFIG,
    { environment: ["production", "langfuse-llm-as-a-judge"] },
    { stateLocation: "memory" },
  );
  const facet = filters.find(
    (f): f is CategoricalUIFilter => f.column === "environment",
  );
  return (
    <pre data-testid="facet">
      {JSON.stringify({
        options: facet?.options,
        labels: Object.fromEntries(facet?.displayByValue ?? []),
      })}
    </pre>
  );
}

describe("sidebar environment facet (CHG-2026-085)", () => {
  it("labels internal environments and keeps the values it filters on", () => {
    render(<EnvironmentFacetHarness />);

    expect(JSON.parse(screen.getByTestId("facet").textContent ?? "")).toEqual({
      options: ["production", "langfuse-llm-as-a-judge"],
      labels: { "langfuse-llm-as-a-judge": "eyeon-llm-as-a-judge" },
    });
  });
});
