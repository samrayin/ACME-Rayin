import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { LangfuseLogo } from "@/src/components/design-system/LangfuseLogo/LangfuseLogo";
import { TopbarBrand } from "@/src/components/nav/topbar-brand";
import {
  EYEON_LOGO_ALT,
  EyeonLogo,
} from "@/src/features/acme-enhancements/components/eyeon/brand/EyeonLogo";
import { EyeonSidebarLogo } from "@/src/features/acme-enhancements/components/eyeon/brand/EyeonSidebarLogo";

// CHG-2026-150 (ADR-0026 §12.5): the owner's logo replaces the "EYE" + "ON"
// text wordmark, one image for the light theme and one for the dark theme,
// with fixed colours. Everywhere it shows it sits on a surface that follows
// the theme: the phone's top bar, and the sidebar's logo row, which takes the
// page header's background (owner's option B, 2026-10-11). So the light-theme
// logo shows in light mode and the dark-theme logo in dark mode. 24px on its
// own, 20px beside a customer's logo (ADR-0025).

vi.mock("@/src/ee/features/ui-customization/useUiCustomization", () => ({
  useUiCustomization: () => null,
}));

const LIGHT = "/eyeon/eyeon-logo-light.png";
const DARK = "/eyeon/eyeon-logo-dark.png";

const logos = () => screen.getAllByRole("img", { name: EYEON_LOGO_ALT });
const src = (image: HTMLElement) => image.getAttribute("src") ?? "";

describe("EyeonLogo (CHG-2026-150)", () => {
  it("follows the theme: the light-theme logo in light mode, the dark-theme logo in dark mode", () => {
    render(<EyeonLogo />);

    const [light, dark] = logos();
    expect(logos()).toHaveLength(2);
    expect(src(light)).toMatch(new RegExp(`${LIGHT}$`));
    expect(light).toHaveClass("dark:hidden");
    expect(light).not.toHaveClass("hidden");
    expect(src(dark)).toMatch(new RegExp(`${DARK}$`));
    expect(dark).toHaveClass("hidden", "dark:block");
  });

  it("in the sidebar's logo row it follows the theme too (option B: the row is light in the light theme)", () => {
    render(<EyeonSidebarLogo besideCustomerLogo={false} />);

    const [light, dark] = logos();
    expect(logos()).toHaveLength(2);
    expect(src(light)).toMatch(new RegExp(`${LIGHT}$`));
    expect(light).toHaveClass("dark:hidden");
    expect(src(dark)).toMatch(new RegExp(`${DARK}$`));
    expect(dark).toHaveClass("hidden", "dark:block");
  });

  it("is 24px high on its own and 20px when smaller, keeping its proportions", () => {
    const { rerender } = render(<EyeonLogo />);
    for (const logo of logos()) expect(logo).toHaveClass("h-6", "w-auto");

    rerender(<EyeonLogo size="sm" />);
    for (const logo of logos()) expect(logo).toHaveClass("h-5", "w-auto");
  });

  it("is served as the file it is, with its own width and height", () => {
    render(<EyeonLogo />);

    for (const logo of logos()) {
      // Not through Next's image optimiser.
      expect(src(logo)).not.toContain("/_next/image");
      expect(logo).toHaveAttribute("width", "172");
      expect(logo).toHaveAttribute("height", "64");
    }
  });
});

describe("the logo files (CHG-2026-150)", () => {
  // The PNG header holds the width and height right after the IHDR tag.
  const pngSize = (bytes: Buffer) => ({
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  });

  it.each([LIGHT, DARK])(
    "%s is a small PNG of the size the component declares",
    (file) => {
      const path = join(process.cwd(), "public", file);
      const bytes = readFileSync(path);
      expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(pngSize(bytes)).toEqual({ width: 172, height: 64 });
      expect(statSync(path).size).toBeLessThan(20 * 1024);
    },
  );
});

describe("where the wordmark was (CHG-2026-150)", () => {
  it("the sidebar header: the logo for the theme, 24px on its own, hidden when the sidebar is collapsed to icons", () => {
    const { container } = render(
      <LangfuseLogo brand={<EyeonSidebarLogo besideCustomerLogo={false} />} />,
    );

    const [logo] = logos();
    expect(logos()).toHaveLength(2);
    expect(src(logo)).toMatch(new RegExp(`${LIGHT}$`));
    expect(logo).toHaveClass("h-6");
    expect(logo.parentElement?.parentElement).toHaveClass(
      "group-data-[collapsible=icon]:hidden",
    );
    // No text wordmark left.
    expect(container).not.toHaveTextContent("EYE");
  });

  it("the sidebar header beside a customer's logo: 20px, so both fit (ADR-0025)", () => {
    render(
      <LangfuseLogo
        customerLogoSrc="data:image/png;base64,AAAA"
        brand={<EyeonSidebarLogo besideCustomerLogo />}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Organization logo" }),
    ).toBeInTheDocument();
    const [logo] = logos();
    expect(logo).toHaveClass("h-5");
  });

  it("AppSidebar passes the logo in, sized by whether a customer logo is there (an upstream sync must keep it)", () => {
    const appSidebar = readFileSync(
      join(process.cwd(), "src/components/nav/AppSidebar/AppSidebar.tsx"),
      "utf8",
    );
    expect(appSidebar).toMatch(
      /<LangfuseLogo[\s\S]{0,400}brand=\{\s*<EyeonSidebarLogo\s+besideCustomerLogo=\{Boolean\(logo\.customerSrc\)\}/,
    );
  });

  it("the logo row takes the page header's background, as the connected sidebar passes it in (option B; an upstream sync must keep it)", () => {
    const appSidebar = readFileSync(
      join(process.cwd(), "src/components/nav/AppSidebar/AppSidebar.tsx"),
      "utf8",
    );
    expect(appSidebar).toContain(
      "logo.rowClassName ?? acmeHeaderBackgroundClass(undefined)",
    );
    const layout = readFileSync(
      join(
        process.cwd(),
        "src/components/layouts/app-layout/variants/AuthenticatedLayout.tsx",
      ),
      "utf8",
    );
    expect(layout).toContain(
      "const logoRowClassName = useAcmeHeaderBackgroundClassName();",
    );
    expect(layout).toContain("rowClassName: logoRowClassName,");
  });

  it("the phone's top bar: the logo follows the theme, and the link is named for EYEON", () => {
    render(<TopbarBrand variant="wordmark" />);

    const link = screen.getByRole("link", { name: "EYEON home" });
    expect(link).toHaveAttribute("href", "/");
    const images = within(link).getAllByRole("img", { name: EYEON_LOGO_ALT });
    expect(images.map(src)).toEqual([
      expect.stringMatching(new RegExp(`${LIGHT}$`)),
      expect.stringMatching(new RegExp(`${DARK}$`)),
    ]);
    expect(images[0]).toHaveClass("h-5");
  });

  it("the top bar's icon variant keeps its icon, and its link is named for EYEON too", () => {
    render(<TopbarBrand />);

    expect(
      screen.getByRole("link", { name: "EYEON home" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: EYEON_LOGO_ALT }),
    ).not.toBeInTheDocument();
  });
});
