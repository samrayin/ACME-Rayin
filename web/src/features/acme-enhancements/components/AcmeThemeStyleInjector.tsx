import { api } from "@/src/utils/api";
import { acmeThemeCss } from "@/src/features/acme-enhancements/theme/acmeThemePresets";
import {
  effectiveTheme,
  usePersonalTheme,
} from "@/src/features/acme-enhancements/theme/usePersonalTheme";

/**
 * Applies the project's chosen accent-color preset (see
 * web/project/[projectId]/acme-enhancements/ui-customization.tsx) at
 * runtime by overriding the CSS custom properties globals.css defines --
 * lets an owner/admin change the look without a redeploy. Renders nothing
 * visible itself, just a <style> tag; safe to mount once near the app root.
 *
 * No risk of CSS injection: the stored value is one of four fixed preset
 * keys (validated server-side against an enum), never free-form user text.
 *
 * CHG-2026-127: the light accent applies only in light mode, and a separate
 * bright accent in dark mode (see acmeThemeCss).
 */
export function AcmeThemeStyleInjector({ projectId }: { projectId: string }) {
  const theme = api.acmeTheme.get.useQuery(
    { projectId },
    {
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

  // CHG-2026-074: the user's personal theme, if any, overrides the project's.
  const { personal } = usePersonalTheme();
  const effective = effectiveTheme(theme.data, personal);
  // Nothing to inject until a theme is known; this component only adds a
  // <style> tag, so rendering nothing is its normal idle state.
  // eslint-disable-next-line @repo/no-null-render
  if (!effective) return null;

  return (
    <style dangerouslySetInnerHTML={{ __html: acmeThemeCss(effective) }} />
  );
}
