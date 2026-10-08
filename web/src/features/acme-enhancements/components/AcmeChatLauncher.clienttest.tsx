import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AcmeChatLauncher,
  AcmeChatTopbarLauncher,
  useIsAcmeChatLauncherVisible,
} from "./AcmeChatLauncher";
import { AcmeChatPanelHost, AcmeChatWidget } from "./AcmeChatWidget";
import { useAcmeChatPanel } from "./acmeChatPanelStore";

// switchedOn: acmeChat.status's answer (CHG-2026-141); undefined while it is
// loading or after it failed.
const h = vi.hoisted(() => ({
  canUse: true,
  switchedOn: undefined as boolean | undefined,
  statusQuery: vi.fn(),
}));

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
      status: {
        useQuery: (...args: unknown[]) => {
          h.statusQuery(...args);
          return {
            data:
              h.switchedOn === undefined
                ? undefined
                : { enabled: h.switchedOn },
          };
        },
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

// CHG-2026-141: the top bars mount AcmeChatTopbarLauncher and the layout
// AcmeChatPanelHost; both follow CAIRO_ACME_AI_ENABLED, as acmeChat.status
// reports it.
const renderAsTheAppMountsThem = () =>
  render(
    <>
      <AcmeChatTopbarLauncher />
      <AcmeChatPanelHost projectId="p1" />
    </>,
  );

describe("ACME AI behind CAIRO_ACME_AI_ENABLED (CHG-2026-141)", () => {
  beforeEach(() => {
    h.canUse = true;
    h.switchedOn = undefined;
    h.statusQuery.mockClear();
    useAcmeChatPanel.setState({ open: false });
  });

  it.each([false, undefined])(
    "switch %s: no launcher and no panel, even with the panel's state open",
    (switchedOn) => {
      h.switchedOn = switchedOn;
      useAcmeChatPanel.setState({ open: true });
      renderAsTheAppMountsThem();

      expect(screen.queryByRole("button", { name: /ACME AI/ })).toBeNull();
      expect(screen.queryByRole("dialog", { name: "ACME AI" })).toBeNull();
      expect(screen.queryByPlaceholderText("Ask ACME AI…")).toBeNull();
    },
  );

  it("switch on: the launcher opens the panel the layout hosts", () => {
    h.switchedOn = true;
    renderAsTheAppMountsThem();

    fireEvent.click(screen.getByRole("button", { name: "Open ACME AI" }));
    expect(screen.getByRole("dialog", { name: "ACME AI" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask ACME AI…")).toHaveFocus();
  });

  it("switch on, a role that can't use ACME AI sees nothing and never asks", () => {
    h.switchedOn = true;
    h.canUse = false;
    useAcmeChatPanel.setState({ open: true });
    renderAsTheAppMountsThem();

    expect(screen.queryByRole("button", { name: /ACME AI/ })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "ACME AI" })).toBeNull();
    expect(h.statusQuery).not.toHaveBeenCalled();
  });

  it("asks the server for the switch with no input", () => {
    h.switchedOn = true;
    renderAsTheAppMountsThem();

    expect(h.statusQuery).toHaveBeenCalled();
    for (const [input] of h.statusQuery.mock.calls) {
      expect(input).toBeUndefined();
    }
  });
});
