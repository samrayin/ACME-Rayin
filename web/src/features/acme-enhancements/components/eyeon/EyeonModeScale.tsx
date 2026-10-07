import { cn } from "@/src/utils/tailwind";
import { EYEON_TONE_TEXT } from "@/src/features/acme-enhancements/components/eyeon/eyeonTones";
import {
  type GatewayMode,
  gatewayModeLabel,
} from "@/src/features/acme-enhancements/utils/guardrailVerdictLabel";

// ACME (CHG-2026-138, ADR-0027): the mode against its ceiling, after the
// prototype's mode dial: the two modes on one scale, a marker over the mode
// EYEON serves, and a stop at the deployment ceiling. A mode above the
// ceiling is outlined, never filled; with no mode reported there is no
// marker. Every colour has its word beside it (each mode is labelled), and
// the accessible name states the mode and the ceiling.

const WIDTH = 240;
const HEIGHT = 76;
const ZONE_WIDTH = 116;

const ZONES = [
  { mode: "record", x: 0, tone: "redact" },
  { mode: "enforce", x: WIDTH - ZONE_WIDTH, tone: "allow" },
] as const;

/** The accessible name: the mode served, the ceiling, and what that rules out. */
export function modeScaleLabel(
  mode: GatewayMode | null,
  ceiling: GatewayMode,
): string {
  const served =
    mode === null ? "not reported" : `${gatewayModeLabel(mode)} mode`;
  const above =
    ceiling === "record"
      ? " Enforce is above the ceiling, so it cannot be served."
      : "";
  return `Mode against ceiling. Mode: ${served}. Ceiling: ${gatewayModeLabel(ceiling)}.${above}`;
}

export function EyeonModeScale({
  mode,
  ceiling,
}: {
  mode: GatewayMode | null;
  ceiling: GatewayMode;
}) {
  const ceilingX = ceiling === "enforce" ? WIDTH - 1 : WIDTH / 2;
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full max-w-xs"
      role="img"
      aria-label={modeScaleLabel(mode, ceiling)}
    >
      {ZONES.map((zone) => {
        const served = zone.mode === mode;
        const aboveCeiling = zone.mode === "enforce" && ceiling === "record";
        const centre = zone.x + ZONE_WIDTH / 2;
        const name = gatewayModeLabel(zone.mode);
        return (
          <g key={zone.mode}>
            <title>
              {aboveCeiling
                ? `${name}: above the ceiling`
                : `${name} mode${served ? ": served now" : ""}`}
            </title>
            {served ? (
              <>
                <path
                  d={`M${centre - 6} 6 L${centre + 6} 6 L${centre} 16 Z`}
                  className={EYEON_TONE_TEXT[zone.tone]}
                  fill="currentColor"
                />
                <rect
                  x={zone.x}
                  y={22}
                  width={ZONE_WIDTH}
                  height={14}
                  rx={7}
                  className={EYEON_TONE_TEXT[zone.tone]}
                  fill="currentColor"
                />
              </>
            ) : (
              <rect
                x={zone.x + 0.5}
                y={22.5}
                width={ZONE_WIDTH - 1}
                height={13}
                rx={6.5}
                className={
                  aboveCeiling ? "stroke-muted-foreground" : "fill-muted"
                }
                fill={aboveCeiling ? "none" : undefined}
                strokeDasharray={aboveCeiling ? "4 3" : undefined}
              />
            )}
            <text
              x={centre}
              y={52}
              textAnchor="middle"
              className={cn(
                "text-xs",
                served ? "fill-foreground font-bold" : "fill-muted-foreground",
              )}
            >
              {name}
            </text>
            {aboveCeiling ? (
              <text
                x={centre}
                y={68}
                textAnchor="middle"
                className="fill-muted-foreground text-xs"
              >
                Above the ceiling
              </text>
            ) : null}
          </g>
        );
      })}
      <line
        x1={ceilingX}
        x2={ceilingX}
        y1={16}
        y2={42}
        className="stroke-foreground"
        strokeWidth={2}
      />
      <text
        x={ceilingX}
        y={ceiling === "enforce" ? 68 : 14}
        textAnchor={ceiling === "enforce" ? "end" : "middle"}
        className="fill-foreground text-xs font-bold"
      >
        Ceiling
      </text>
    </svg>
  );
}
