import { fireEvent, render, screen, within } from "@testing-library/react";
import { EyeonTopbarUserMenu } from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonTopbarUserMenu";
import { type EyeonUserMenuItem } from "@/src/features/acme-enhancements/components/eyeon/shell/EyeonUserMenuContext";

// CHG-2026-134: the user menu moved from the sidebar footer to the top bar.
// It keeps the footer's block (avatar, name, email) and renders every item the
// layout passes, as the footer did: links, actions and submenus.

const USER = { name: "Ada Lovelace", email: "ada-email", avatar: "" };

function items(onSignOut: () => void, onPreview: () => void) {
  const list: EyeonUserMenuItem[] = [
    { type: "link", name: "Account Settings", href: "/account/settings" },
    { type: "link", name: "v4 Migration", href: "/v4-migration" },
    {
      type: "action",
      name: "Theme",
      onClick: () => {},
      content: <span>Theme switch</span>,
    },
    { type: "action", name: "Feature Preview", onClick: onPreview },
    {
      type: "submenu",
      name: "Instances",
      subItems: [{ type: "action", name: "Second instance", onClick: vi.fn() }],
    },
    { type: "action", name: "Sign out", onClick: onSignOut },
  ];
  return list;
}

function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /User menu/ }), {
    key: "Enter",
  });
  return screen.getByRole("menu");
}

describe("EyeonTopbarUserMenu (CHG-2026-134)", () => {
  it("shows the person and every item the sidebar footer had", () => {
    render(<EyeonTopbarUserMenu user={USER} items={items(vi.fn(), vi.fn())} />);

    const trigger = screen.getByRole("button", {
      name: "User menu, Ada Lovelace, ada-email",
    });
    expect(within(trigger).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(trigger).getByText("ada-email")).toBeInTheDocument();

    const menu = openMenu();
    expect(within(menu).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(menu).getByText("ada-email")).toBeInTheDocument();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Account Settings",
      "v4 Migration",
      "Theme switch",
      "Feature Preview",
      "Instances",
      "Sign out",
    ]);
    expect(
      within(menu).getByRole("menuitem", { name: "Account Settings" }),
    ).toHaveAttribute("href", "/account/settings");
  });

  it("runs an item's action, as the footer did", () => {
    const onSignOut = vi.fn();
    const onPreview = vi.fn();
    render(
      <EyeonTopbarUserMenu user={USER} items={items(onSignOut, onPreview)} />,
    );

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Feature Preview" }),
    );
    expect(onPreview).toHaveBeenCalledTimes(1);

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: "Sign out" }),
    );
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("shows only the avatar in the compact (mobile) trigger, with the full menu", () => {
    render(
      <EyeonTopbarUserMenu
        user={USER}
        items={items(vi.fn(), vi.fn())}
        compact
      />,
    );

    const trigger = screen.getByRole("button", { name: /^User menu/ });
    expect(within(trigger).queryByText("Ada Lovelace")).toBeNull();
    expect(within(openMenu()).getAllByRole("menuitem")).toHaveLength(6);
  });
});
