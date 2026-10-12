import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { AcmeGuardrailSectorPacks } from "@/src/features/acme-enhancements/components/AcmeGuardrailSectorPacks";
import { AcmeGuardrailsPolicies } from "@/src/features/acme-enhancements/components/AcmeGuardrailsTable";
import {
  SECTOR_PACK_IDS,
  type SectorPackId,
} from "@/src/features/acme-enhancements/utils/guardrailSectorPacks";

// CHG-2026-151 (ADR-0031 phase 1): the Policies card's "Sector policy packs"
// section. Six switches with their scope; the last enabled pack cannot be
// switched off; read-only for anyone the card does not let edit, which
// includes the content-free roles; saving goes through the card's existing
// flow, with its reason.

const h = vi.hoisted(() => ({
  config: {} as unknown,
  mutate: vi.fn(),
}));

vi.mock("@/src/utils/api", () => ({
  api: {
    useUtils: () => ({
      acmeGuardrails: { getConfig: { invalidate: vi.fn() } },
    }),
    acmeGuardrails: {
      getConfig: { useQuery: () => h.config },
      updateConfig: {
        useMutation: () => ({ mutate: h.mutate, isPending: false }),
      },
    },
  },
}));

const SIX = [...SECTOR_PACK_IDS];

function Harness({
  initial,
  readOnly = false,
}: {
  initial: SectorPackId[];
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState<SectorPackId[]>(initial);
  return (
    <>
      <AcmeGuardrailSectorPacks
        selected={selected}
        onChange={setSelected}
        readOnly={readOnly}
      />
      <output data-testid="selected">{selected.join(",")}</output>
    </>
  );
}

function packSwitch(name: string) {
  return screen.getByRole("switch", { name });
}

describe("AcmeGuardrailSectorPacks (CHG-2026-151)", () => {
  it("shows six switches, each with its label and scope, and the note", () => {
    render(<Harness initial={SIX} />);
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(6);
    for (const s of switches) expect(s).toHaveAttribute("aria-checked", "true");
    expect(packSwitch("Banking and finance")).toHaveAccessibleDescription(
      /Islamic finance/,
    );
    expect(packSwitch("HR and staff services")).toBeTruthy();
    expect(screen.getByText("6 of 6 enabled")).toBeTruthy();
    expect(
      screen.getByText(
        /Packs set only which topics answers may cover\. Every pack's conduct rules and the universal protections \(personal data, fraud, general harm, jailbreak and prompt injection\) apply in every case/,
      ),
    ).toBeTruthy();
  });

  it("switches a pack off and on again, keeping pack order", () => {
    render(<Harness initial={SIX} />);
    fireEvent.click(packSwitch("Healthcare"));
    expect(screen.getByTestId("selected").textContent).toBe(
      "banking,government,hr,retail_telecom,education",
    );
    fireEvent.click(packSwitch("Healthcare"));
    expect(screen.getByTestId("selected").textContent).toBe(SIX.join(","));
  });

  it("does not let the last enabled pack be switched off", () => {
    render(<Harness initial={["education"]} />);
    const last = packSwitch("Education");
    expect(last).toBeDisabled();
    expect(last).toHaveAttribute("aria-checked", "true");
    fireEvent.click(last);
    expect(screen.getByTestId("selected").textContent).toBe("education");
    expect(
      screen.getByText(
        /The last enabled pack stays on: at least one is needed/,
      ),
    ).toBeTruthy();
    // The others can still be switched on.
    expect(packSwitch("Banking and finance")).not.toBeDisabled();
  });

  it("disables the last pack once the others are switched off", () => {
    render(<Harness initial={["banking", "hr"]} />);
    expect(packSwitch("HR and staff services")).not.toBeDisabled();
    fireEvent.click(packSwitch("Banking and finance"));
    expect(screen.getByTestId("selected").textContent).toBe("hr");
    expect(packSwitch("HR and staff services")).toBeDisabled();
  });

  it("is read-only when the viewer cannot edit", () => {
    render(<Harness initial={["banking", "hr"]} readOnly />);
    for (const s of screen.getAllByRole("switch")) expect(s).toBeDisabled();
    fireEvent.click(packSwitch("Healthcare"));
    expect(screen.getByTestId("selected").textContent).toBe("banking,hr");
    expect(screen.queryByText(/The last enabled pack stays on/)).toBeNull();
  });

  it("says the packs change no answer while the Topical Rail is off", () => {
    render(
      <AcmeGuardrailSectorPacks
        selected={SIX}
        onChange={() => {}}
        readOnly={false}
        topicalEnabled={false}
      />,
    );
    expect(screen.getByText(/The Topical Rail is off/)).toBeTruthy();
  });
});

function config(over: Record<string, unknown> = {}) {
  return {
    isPending: false,
    isError: false,
    data: {
      configured: true,
      current: {
        version: 4,
        mode: "record",
        piiEntities: ["EMAIL_ADDRESS"],
        jailbreakEnabled: true,
        topicalEnabled: true,
        sectors: ["banking", "hr"],
        reason: "A reason that is long enough",
        createdByEmail: null,
        createdByInitialSetup: false,
        createdAt: new Date("2026-10-11T10:00:00.000Z"),
      },
      availablePiiEntities: ["EMAIL_ADDRESS", "PERSON"],
      pods: [],
      podStaleAfterSeconds: 120,
      canEdit: true,
      readOnlyRole: false,
      adminsConfigured: true,
      signupClosed: true,
      ...over,
    },
  };
}

describe("the Policies card's sector packs (CHG-2026-151)", () => {
  beforeEach(() => {
    h.mutate.mockReset();
    h.config = config();
  });

  it("is read-only for a content-free role, with the card's reason", () => {
    h.config = config({ canEdit: false, readOnlyRole: true });
    render(<AcmeGuardrailsPolicies projectId="p1" />);
    const group = screen.getByRole("group", { name: "Sector policy packs" });
    const switches = within(group).getAllByRole("switch");
    expect(switches).toHaveLength(6);
    for (const s of switches) expect(s).toBeDisabled();
    expect(
      screen.getByText("Editing is off: your role here is read-only"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Save new version" }),
    ).toBeNull();
  });

  it("is read-only for a viewer who is not a guardrail administrator", () => {
    h.config = config({ canEdit: false, readOnlyRole: false });
    render(<AcmeGuardrailsPolicies projectId="p1" />);
    const group = screen.getByRole("group", { name: "Sector policy packs" });
    for (const s of within(group).getAllByRole("switch"))
      expect(s).toBeDisabled();
  });

  it("shows the stored packs and saves a change through the existing flow, with the reason", () => {
    render(<AcmeGuardrailsPolicies projectId="p1" />);
    const group = screen.getByRole("group", { name: "Sector policy packs" });
    expect(
      within(group)
        .getAllByRole("switch")
        .map((s) => s.getAttribute("aria-checked")),
    ).toEqual(["true", "false", "false", "true", "false", "false"]);

    fireEvent.click(within(group).getByRole("switch", { name: "Education" }));
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save new version" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Reason/), {
      target: { value: "Add the education pack for the pilot" },
    });
    fireEvent.click(save);
    expect(h.mutate).toHaveBeenCalledWith({
      projectId: "p1",
      piiEntities: ["EMAIL_ADDRESS"],
      jailbreakEnabled: true,
      topicalEnabled: true,
      sectors: ["banking", "hr", "education"],
      reason: "Add the education pack for the pilot",
    });
  });
});
