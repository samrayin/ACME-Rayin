import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VersionUpdateBannerView } from "@/src/features/version-update/VersionUpdateBannerView";
import { AgentToolsBanner } from "@/src/features/developer-tools/components/AgentToolsBanner";
import { ErrorNotification } from "@/src/features/notifications/ErrorNotification";
import { CopyWidgetDialog } from "@/src/features/widgets/components/CopyWidgetDialog";
import { MatchedModelCard } from "@/src/features/models/components/test-match/MatchedModelCard";
import { MaintainerTooltip } from "@/src/features/evals/components/maintainer-tooltip";
import { getMaintainer } from "@/src/features/evals/utils/typeHelpers";
import { ACME_BUILT_IN_LABEL, ACME_PRODUCT_NAME } from "./acmeBranding";

// CHG-2026-146, ADR-0029: the ten most visible "Langfuse" texts say EYEON or
// use neutral wording. The CI guard (scripts/ci/check_langfuse_text.py) stops
// new ones; these tests pin the replacements themselves.

const h = vi.hoisted(() => ({ setSupportOpen: vi.fn() }));

vi.mock("@/src/features/support-chat/SupportDrawerProvider", () => ({
  useSupportDrawer: () => ({ setOpen: h.setSupportOpen }),
}));
vi.mock("@/src/features/v4-migration/V4MigrationPanelProvider", () => ({
  useV4MigrationPanel: () => ({ setOpen: vi.fn() }),
}));
vi.mock("@/src/features/posthog-analytics", () => ({
  usePostHogClientCapture: () => vi.fn(),
}));

describe("banners and toasts (CHG-2026-146)", () => {
  it("the version-update banner names EYEON", () => {
    const { container } = render(
      <VersionUpdateBannerView onReload={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      `${ACME_PRODUCT_NAME} just got an update`,
    );
    expect(container.textContent).not.toContain("Langfuse");
  });

  it("the Organizations page banner names the tools without Langfuse", () => {
    const { container } = render(<AgentToolsBanner />);
    expect(container).toHaveTextContent(
      "with the Agent Skill, MCP server, and CLI.",
    );
    expect(container.textContent).not.toContain("Langfuse");
  });

  it("an error toast offers a neutral Report issue that still opens support", () => {
    const { container } = render(
      <ErrorNotification
        error="Something failed"
        description="Details"
        type="ERROR"
        dismissToast={vi.fn()}
        toast="t1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Report issue" }));
    expect(h.setSupportOpen).toHaveBeenCalledWith(true);
    expect(container.textContent).not.toContain("Langfuse");
  });
});

describe('"Built-in" replaces "Maintained by Langfuse" (CHG-2026-146)', () => {
  it("is one label", () => {
    expect(ACME_BUILT_IN_LABEL).toBe("Built-in");
  });

  it("a built-in widget's copy dialog says built-in", () => {
    render(
      <CopyWidgetDialog
        open
        onOpenChange={vi.fn()}
        widgetName="Latency"
        onConfirm={vi.fn()}
        isPending={false}
      />,
    );
    expect(document.body).toHaveTextContent(
      "is built-in and can’t be edited directly",
    );
    expect(document.body.textContent).not.toContain("Langfuse");
  });

  it("a built-in model is badged Built-in; a project's own model is not", () => {
    const { rerender } = render(
      <MatchedModelCard
        model={{ modelName: "gpt-4o", matchPattern: "gpt-4o", projectId: null }}
      />,
    );
    expect(screen.getByText(ACME_BUILT_IN_LABEL)).toBeInTheDocument();
    rerender(
      <MatchedModelCard
        model={{ modelName: "mine", matchPattern: "mine", projectId: "p1" }}
      />,
    );
    expect(screen.queryByText(ACME_BUILT_IN_LABEL)).not.toBeInTheDocument();
  });

  it("evaluator templates: built-in, a partner's, or the user's", () => {
    expect(getMaintainer({ projectId: null })).toBe(ACME_BUILT_IN_LABEL);
    expect(getMaintainer({ projectId: null, partner: "ragas" })).toBe(
      "Ragas maintained",
    );
    expect(getMaintainer({ projectId: "p1" })).toBe("User maintained");
  });

  it("the maintainer icon still follows the label", () => {
    const { rerender } = render(
      <MaintainerTooltip maintainer={ACME_BUILT_IN_LABEL} />,
    );
    const builtIn = screen.getByRole("button", {
      name: `Maintainer: ${ACME_BUILT_IN_LABEL}`,
    });
    expect(builtIn.querySelector("img")?.getAttribute("src")).toMatch(
      /icon\.svg$/,
    );

    rerender(
      <MaintainerTooltip maintainer={`${ACME_BUILT_IN_LABEL} (Ragas)`} />,
    );
    expect(screen.getByAltText("Ragas Logo")).toBeInTheDocument();

    rerender(<MaintainerTooltip maintainer="User maintained" />);
    expect(
      screen
        .getByRole("button", { name: "Maintainer: User maintained" })
        .querySelector("img"),
    ).toBeNull();
  });
});

describe("the upstream lines stay replaced (CHG-2026-146)", () => {
  // An upstream sync that rewrites these lines brings the old text back;
  // these fail first, naming the file.
  const source = (file: string) =>
    readFileSync(join(process.cwd(), file), "utf8");

  const replaced: Array<[file: string, old: string[], now: string[]]> = [
    [
      "src/pages/api/docs.ts",
      ["<title>Langfuse API Reference</title>"],
      ["<title>${ACME_PRODUCT_NAME} API Reference</title>"],
    ],
    [
      "src/features/organizations/components/ProjectOverview.tsx",
      ["to get started with Langfuse."],
      ["to get started with ${ACME_PRODUCT_NAME}."],
    ],
    [
      "src/features/projects/components/HostNameProject.tsx",
      ["When connecting to Langfuse"],
      ["When connecting to {ACME_PRODUCT_NAME}"],
    ],
    [
      "src/features/setup/components/TracesSetupOnboardingCard.tsx",
      ["observability with Langfuse", "send traces to Langfuse"],
      [
        "observability with ${ACME_PRODUCT_NAME}",
        "send traces to ${ACME_PRODUCT_NAME}",
      ],
    ],
    [
      "src/components/onboarding/PromptsOnboarding.tsx",
      ["Langfuse Prompt Management helps"],
      ['description="Prompt Management helps'],
    ],
    [
      "src/features/widgets/components/DashboardWidget.tsx",
      ["Maintained by Langfuse"],
      ["{ACME_BUILT_IN_LABEL}"],
    ],
    [
      "src/components/table/use-cases/models.tsx",
      ['"Langfuse maintained"', "Langfuse managed"],
      ["ACME_BUILT_IN_LABEL"],
    ],
    [
      "src/pages/project/[projectId]/settings/models/[modelId].tsx",
      ['? "Langfuse" : "User"'],
      ["ACME_BUILT_IN_LABEL"],
    ],
    [
      "src/features/evals/hooks/useEvaluatorTableData.ts",
      ['"Langfuse maintained"', '"Langfuse and Ragas maintained"'],
      ["ACME_BUILT_IN_LABEL"],
    ],
    [
      "src/features/evals/components/evaluator-selector.tsx",
      ['"Langfuse managed evaluators"'],
      ["ACME_BUILT_IN_LABEL"],
    ],
    [
      "src/features/evals/components/template-selector.tsx",
      ['"Langfuse managed evaluators"'],
      ["ACME_BUILT_IN_LABEL"],
    ],
    [
      "src/components/table/peek/peek-evaluator-config-detail.tsx",
      ['?? "Langfuse"'],
      ["?? ACME_BUILT_IN_LABEL"],
    ],
  ];

  it.each(replaced)("%s", (file, old, now) => {
    const text = source(file);
    for (const phrase of old) expect(text).not.toContain(phrase);
    for (const phrase of now) expect(text).toContain(phrase);
    expect(text).toContain("ACME (CHG-2026-146");
  });
});
