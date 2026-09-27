import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Home } from "lucide-react";
import { NavMain, type NavMainItem } from "@/src/components/nav/nav-main";
import { SidebarProvider } from "@/src/components/ui/sidebar";

vi.mock("next/router", () => ({
  useRouter: () => ({
    asPath: "/project/p1/acme-enhancements/security-logs",
    pathname: "/project/[projectId]/acme-enhancements/security-logs",
    push: vi.fn(),
    query: { projectId: "p1" },
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

const item = (title: string, isActive = false): NavMainItem => ({
  title,
  url: `/${title.toLowerCase()}`,
  icon: Home,
  isActive,
});

// The user is on the Logs page, which sits in Reports / Logs.
const renderNav = () =>
  render(
    <SidebarProvider>
      <NavMain
        items={{
          ungrouped: [],
          grouped: {
            "Governance Controls": [item("Guardrails")],
            "Reports / Logs": [item("Logs", true)],
          },
        }}
      />
    </SidebarProvider>,
  );

const section = (name: string) => screen.getByRole("button", { name });

describe("sidebar sections collapse and expand (CHG-2026-081)", () => {
  beforeEach(() => localStorage.clear());

  it("the section holding the current page can be collapsed and reopened", () => {
    renderNav();
    expect(section("Reports / Logs")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Logs" })).toBeInTheDocument();

    fireEvent.click(section("Reports / Logs"));
    expect(section("Reports / Logs")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Logs" })).toBeNull();

    fireEvent.click(section("Reports / Logs"));
    expect(section("Reports / Logs")).toHaveAttribute("aria-expanded", "true");
  });

  it("any other section collapses and expands", () => {
    renderNav();
    fireEvent.click(section("Governance Controls"));
    expect(screen.queryByRole("link", { name: "Guardrails" })).toBeNull();
    fireEvent.click(section("Governance Controls"));
    expect(
      screen.getByRole("link", { name: "Guardrails" }),
    ).toBeInTheDocument();
  });

  it("a section label is a real button, so it works from the keyboard", () => {
    renderNav();
    expect(section("Governance Controls").tagName).toBe("BUTTON");
    expect(section("Reports / Logs")).toHaveAttribute("type", "button");
  });

  it("section names use the full sidebar text colour, not the 70% grey (CHG-2026-081 b)", () => {
    renderNav();
    const label = section("Governance Controls");
    expect(label).toHaveClass("text-sidebar-foreground");
    expect(label).not.toHaveClass("text-sidebar-foreground/70");
  });

  it("arriving on a page opens its section, even if it was left collapsed", () => {
    localStorage.setItem(
      "sidebarCollapsedGroups",
      JSON.stringify({ "Reports / Logs": true, "Governance Controls": true }),
    );
    renderNav();
    expect(section("Reports / Logs")).toHaveAttribute("aria-expanded", "true");
    // A section the user collapsed, without the current page, stays collapsed.
    expect(section("Governance Controls")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("sections render in the order they are given", () => {
    renderNav();
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t === "Governance Controls" || t === "Reports / Logs");
    expect(labels).toEqual(["Governance Controls", "Reports / Logs"]);
  });
});
