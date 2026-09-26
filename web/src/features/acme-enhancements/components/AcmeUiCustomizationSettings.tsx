import { Check } from "lucide-react";
import { api } from "@/src/utils/api";
import { cn } from "@/src/utils/tailwind";
import { useHasProjectAccess } from "@/src/features/rbac";
import { showErrorToast, showSuccessToast } from "@/src/features/notifications";
import { Button } from "@/src/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/src/components/ui/card";
import {
  ACME_ACCENT_COLOR_KEYS,
  ACME_ACCENT_COLOR_PRESETS,
  ACME_HEADER_BACKGROUND_KEYS,
  ACME_HEADER_BACKGROUND_PRESETS,
  ACME_THEME_DEFAULT,
  type AcmeAccentColorKey,
  type AcmeHeaderBackgroundKey,
  type AcmeTheme,
} from "@/src/features/acme-enhancements/theme/acmeThemePresets";
import {
  effectiveTheme,
  usePersonalTheme,
} from "@/src/features/acme-enhancements/theme/usePersonalTheme";

function ThemeOptions({
  value,
  disabled,
  onAccentColor,
  onHeaderBackground,
}: {
  value: AcmeTheme;
  disabled: boolean;
  onAccentColor: (key: AcmeAccentColorKey) => void;
  onHeaderBackground: (key: AcmeHeaderBackgroundKey) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold">Accent color</p>
        <p className="text-muted-foreground text-xs">
          Used for buttons, links, and active navigation across the app.
        </p>
        <div className="flex flex-wrap gap-3">
          {ACME_ACCENT_COLOR_KEYS.map((key) => {
            const preset = ACME_ACCENT_COLOR_PRESETS[key];
            const isSelected = value.accentColor === key;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => onAccentColor(key)}
                className={cn(
                  "flex w-24 flex-col items-center gap-2 rounded-md border p-3 text-xs transition-colors",
                  isSelected
                    ? "border-primary ring-primary ring-1"
                    : "border-border hover:border-primary/50",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ backgroundColor: preset.swatch }}
                >
                  {isSelected && (
                    <Check className="h-4 w-4 text-white" strokeWidth={3} />
                  )}
                </span>
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold">Top bar background</p>
        <p className="text-muted-foreground text-xs">
          The strip behind the breadcrumb at the top of every page.
        </p>
        <div className="flex flex-wrap gap-3">
          {ACME_HEADER_BACKGROUND_KEYS.map((key) => {
            const preset = ACME_HEADER_BACKGROUND_PRESETS[key];
            const isSelected = value.headerBackground === key;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => onHeaderBackground(key)}
                className={cn(
                  "flex w-40 flex-col items-start gap-2 rounded-md border p-3 text-left text-xs transition-colors",
                  isSelected
                    ? "border-primary ring-primary ring-1"
                    : "border-border hover:border-primary/50",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-bold">{preset.label}</span>
                  {isSelected && (
                    <Check className="text-primary h-4 w-4" strokeWidth={3} />
                  )}
                </div>
                <div
                  className={cn(
                    "h-6 w-full rounded border",
                    key === "plain" && "bg-background",
                    key === "tinted" && "bg-[hsl(var(--primary)/0.10)]",
                    key === "gradient" &&
                      "to-background bg-gradient-to-b from-[hsl(var(--primary)/0.25)]",
                  )}
                />
                <span className="text-muted-foreground">
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * ACME (CHG-2026-074): every user can pick a personal theme that applies only
 * to them; Owners and Admins also set the project default that applies to
 * everyone who has not chosen.
 */
export function AcmeUiCustomizationSettings({
  projectId,
}: {
  projectId: string;
}) {
  const utils = api.useUtils();
  const canEdit = useHasProjectAccess({ projectId, scope: "project:update" });
  const { personal, hasPersonal, setPersonal, clearPersonal } =
    usePersonalTheme();

  const theme = api.acmeTheme.get.useQuery({ projectId });
  const projectTheme = theme.data ?? ACME_THEME_DEFAULT;
  const yours = effectiveTheme(theme.data, personal) ?? projectTheme;

  const update = api.acmeTheme.update.useMutation({
    onSuccess: () => {
      utils.acmeTheme.get.invalidate({ projectId }).catch(() => {});
      showSuccessToast({
        title: "Project default updated",
        description:
          "Everyone in this project without a personal theme now sees it.",
      });
    },
    onError: (error) => {
      showErrorToast("Failed to update theme", error.message);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Your theme</CardTitle>
          <CardDescription>
            Only you see this, in every project, in this browser.{" "}
            {hasPersonal
              ? "You are using your own theme."
              : "You are using the project default."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ThemeOptions
            value={yours}
            disabled={false}
            onAccentColor={(accentColor) =>
              setPersonal({ ...personal, accentColor })
            }
            onHeaderBackground={(headerBackground) =>
              setPersonal({ ...personal, headerBackground })
            }
          />
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPersonal}
              onClick={clearPersonal}
            >
              Use the project default
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Project default</CardTitle>
          <CardDescription>
            What everyone in this project sees unless they choose their own
            theme.
            {canEdit ? "" : " Only project owners and admins can change it."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeOptions
            value={projectTheme}
            disabled={!canEdit || update.isPending}
            onAccentColor={(accentColor) =>
              update.mutate({
                projectId,
                accentColor,
                headerBackground: projectTheme.headerBackground,
              })
            }
            onHeaderBackground={(headerBackground) =>
              update.mutate({
                projectId,
                accentColor: projectTheme.accentColor,
                headerBackground,
              })
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
