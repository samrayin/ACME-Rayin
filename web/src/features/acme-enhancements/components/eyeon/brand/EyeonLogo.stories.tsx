import preview from "@/.storybook/preview";
import { EyeonLogo } from "@/src/features/acme-enhancements/components/eyeon/brand/EyeonLogo";

/**
 * CHG-2026-150 (ADR-0026 §12.5): the EYEON logo, the owner's image in place
 * of the text wordmark, with fixed colours.
 *
 * The logo always sits on a surface that follows the theme: the phone's top
 * bar, and the sidebar's logo row, which takes the page header's background
 * (owner's option B, 2026-10-11). Switch the toolbar's theme to see the
 * light-theme logo (black lettering) and the dark-theme logo (white
 * lettering). The Variant Matrix shows both themes side by side, at 24px and
 * at 20px, above the navy (light theme) or near-black (dark theme) sidebar
 * that the logo row sits over.
 */

const meta = preview.meta({ component: EyeonLogo });

export const Default = meta.story({
  args: {},
});

export const Small = meta.story({
  args: { size: "sm" },
});

const THEMES = [
  { name: "Light theme", theme: "" },
  { name: "Dark theme", theme: "dark" },
] as const;

export const VariantMatrix = meta.story({
  render: () => (
    <div className="grid w-fit grid-cols-2 gap-3">
      {THEMES.map(({ name, theme }) => (
        <figure key={name} className={theme}>
          <div className="overflow-hidden rounded-md border">
            <div className="bg-background dark:bg-header flex h-11 w-46 items-center gap-6 border-b px-3">
              <EyeonLogo />
              <EyeonLogo size="sm" />
            </div>
            <div className="bg-sidebar h-16 w-46" />
          </div>
          <figcaption className="text-muted-foreground bg-background pt-1 text-xs">
            {name}
          </figcaption>
        </figure>
      ))}
    </div>
  ),
});
