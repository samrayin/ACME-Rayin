import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AcmeChatLauncher,
  useIsAcmeChatLauncherVisible,
} from "./AcmeChatLauncher";
import { AcmeChatWidget } from "./AcmeChatWidget";
import { useAcmeChatPanel } from "./acmeChatPanelStore";

const h = vi.hoisted(() => ({ canUse: true }));

vi.mock("next/router", () => ({
  useRouter: () => ({ query: { projectId: "p1" } }),
}));
vi.mock("@/src/features/rbac", () => ({
  useHasProjectAccess: () => h.canUse,
}));
vi.mock("@/src/utils/api", () => ({
  api: {
    acmeChat: {
      sendMessage: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));
vi.mock("@/src/components/design-system/Layer/Layer", () => ({
  Layer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The top bar shows the launcher when the hook says so.
function TopBarSlot() {
  const visible = useIsAcmeChatLauncherVisible();
  return visible ? <AcmeChatLauncher /> : <span />;
}

// The launcher lives in the top bar and the panel in the persistent layout;
// render both, as the app does, sharing one store (ADR-0015).
const renderBoth = () =>
  render(
    <>
      <TopBarSlot />
      <AcmeChatWidget projectId="p1" />
    </>,
  );

describe("ACME AI launcher and panel", () => {
  beforeEach(() => {
    h.canUse = true;
    useAcmeChatPanel.setState({ open: false });
  });

  it("renders no panel until the launcher is used", () => {
    renderBoth();
    expect(screen.queryByRole("dialog", { name: "ACME AI" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open ACME AI" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the panel from the launcher and focuses the message box", () => {
    renderBoth();
    fireEvent.click(screen.getByRole("button", { name: "Open ACME AI" }));

    expect(screen.getByRole("dialog", { name: "ACME AI" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask ACME AI…")).toHaveFocus();
    expect(
      screen.getAllByRole("button", { name: "Close ACME AI" })[0],
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape and from the launcher", () => {
    renderBoth();
    fireEvent.click(screen.getByRole("button", { name: "Open ACME AI" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "ACME AI" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open ACME AI" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Close ACME AI" })[0],
    );
    expect(screen.queryByRole("dialog", { name: "ACME AI" })).toBeNull();
  });

  it("shows nothing to a role that can't use the assistant", () => {
    h.canUse = false;
    renderBoth();
    expect(screen.queryByRole("button", { name: /ACME AI/ })).toBeNull();
  });
});
