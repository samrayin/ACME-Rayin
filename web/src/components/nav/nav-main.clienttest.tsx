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

  // CHG-2026-081 b, c: white, not the sidebar's grey. CHG-2026-131: through
  // the sidebar-label token, white in light mode (checked against globals.css
  // in acmeThemePresets.clienttest.ts) and the prototype's uppercase ink grey
  // in dark mode.
  it("section names use the section-label colour, not the sidebar's grey", () => {
    renderNav();
    const label = section("Governance Controls");
    expect(label).toHaveClass("text-sidebar-label");
    expect(label).not.toHaveClass("text-sidebar-foreground/70");
    expect(label).not.toHaveClass("text-sidebar-foreground");
    expect(label).toHaveClass("dark:uppercase", "dark:tracking-caps");
  });

  // CHG-2026-131: hover has its own shade; the active item keeps the accent.
  it("hover uses the hover shade, and the active item keeps the accent", () => {
    renderNav();
    for (const name of ["Logs", "Guardrails"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveClass(
        "hover:bg-sidebar-hover",
        "hover:text-sidebar-hover-foreground",
        "data-[active=true]:bg-sidebar-accent",
        "data-[active=true]:text-sidebar-accent-foreground",
      );
      expect(link).not.toHaveClass("hover:bg-sidebar-accent");
      expect(link).not.toHaveClass("hover:text-sidebar-accent-foreground");
    }
    expect(screen.getByRole("link", { name: "Logs" })).toHaveAttribute(
      "data-active",
      "true",
    );
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
