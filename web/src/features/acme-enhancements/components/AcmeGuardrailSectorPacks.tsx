import { Switch } from "@/src/components/ui/switch";
import { Label } from "@/src/components/ui/label";
import {
  SECTOR_PACKS,
  SECTOR_PACKS_NOTE,
  type SectorPackId,
  sectorsInPackOrder,
} from "@/src/features/acme-enhancements/utils/guardrailSectorPacks";

// ACME (CHG-2026-151, ADR-0031 phase 1): the Policies card's "Sector policy
// packs" section. One switch per pack, with its label and its answer scope
// in one line, and the note that conduct rules and protections apply in
// every case. The card owns the draft and saves it through its existing
// flow, with the reason; this section only edits the selection.
//
// The last enabled pack cannot be switched off: rayin-guardrails refuses a
// version with no pack, and the server refuses to store one. Read-only for
// anyone the card does not let edit (a content-free role, or a viewer who is
// not a guardrail administrator).

export function AcmeGuardrailSectorPacks({
  selected,
  onChange,
  readOnly,
  pending = false,
  topicalEnabled = true,
}: {
  /** The enabled packs in the card's draft. */
  selected: readonly SectorPackId[];
  onChange: (next: SectorPackId[]) => void;
  /** No switch can be changed (the card's canEdit is false). */
  readOnly: boolean;
  /** A save is in flight. */
  pending?: boolean;
  /** The draft's Topical Rail, the check that applies the answer scope. */
  topicalEnabled?: boolean;
}) {
  const onlyOne = selected.length === 1;

  function toggle(id: SectorPackId, on: boolean) {
    if (readOnly) return;
    if (on) {
      onChange(sectorsInPackOrder([...selected, id]));
      return;
    }
    // Never leave none: the switch is disabled too, this is the backstop.
    if (onlyOne && selected.includes(id)) return;
    onChange(selected.filter((s) => s !== id));
  }

  return (
    <div
      role="group"
      aria-labelledby="guardrail-sector-packs-title"
      className="flex flex-col gap-2 border-t py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div id="guardrail-sector-packs-title" className="text-sm">
          Sector policy packs
        </div>
        <span className="text-muted-foreground text-xs tabular-nums">
          {selected.length} of {SECTOR_PACKS.length} enabled
        </span>
      </div>
      <p className="text-muted-foreground text-xs">{SECTOR_PACKS_NOTE}</p>
      {!topicalEnabled ? (
        <p className="text-xs">
          The Topical Rail is off. It is the check that keeps answers to the
          enabled packs&apos; topics, so the packs change no answer until it is
          on.
        </p>
      ) : null}
      <ul className="flex flex-col" aria-label="Sector policy packs">
        {SECTOR_PACKS.map((pack) => {
          const on = selected.includes(pack.id);
          const isLast = on && onlyOne;
          const switchId = `guardrail-sector-pack-${pack.id}`;
          const scopeId = `${switchId}-scope`;
          return (
            <li
              key={pack.id}
              className="flex items-start justify-between gap-3 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <Label htmlFor={switchId} className="text-sm font-normal">
                  {pack.label}
                </Label>
                <p id={scopeId} className="text-muted-foreground text-xs">
                  {pack.scope}
                </p>
                {isLast && !readOnly ? (
                  <p className="text-muted-foreground text-xs">
                    The last enabled pack stays on: at least one is needed.
                  </p>
                ) : null}
              </div>
              <Switch
                id={switchId}
                checked={on}
                aria-describedby={scopeId}
                disabled={readOnly || pending || isLast}
                onCheckedChange={(checked) => toggle(pack.id, checked)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
