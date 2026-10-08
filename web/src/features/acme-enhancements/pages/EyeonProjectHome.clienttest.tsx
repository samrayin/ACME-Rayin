import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import EyeonProjectHome from "@/src/features/acme-enhancements/pages/EyeonProjectHome";
import { projectHomeLanding } from "@/src/features/acme-enhancements/utils/eyeonHomeLanding";

// CHG-2026-136 (ADR-0028): the project home per role. With EYEON Home's flag
// off nothing changes; with it on, the roles that can open the overview get
// it as Home and every other role keeps the classic Home. The Security
// Analyst and the Auditor never see a Home: they go to Guardrail decisions
// while that page is on, whatever Home's flag says, and to Guardrails
// otherwise. A flag that cannot be read falls back to the old landing.

type Status = { data?: { enabled: boolean }; isError: boolean };

const h = vi.hoisted(() => ({
  session: {} as unknown,
  replace: vi.fn(),
  decisions: { isError: false } as Status,
  home: { isError: false } as Status,
  asked: new Set<string>(),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({ query: { projectId: "p1" }, replace: h.replace }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => h.session,
}));
vi.mock("@/src/utils/api", () => {
  const status = (name: string, result: () => Status) => ({
    useQuery: (_input: unknown, options: { enabled: boolean }) => {
      if (!options.enabled) return { data: undefined, isError: false };
      h.asked.add(name);
      return result();
    },
  });
  return {
    api: {
      eyeonGuardrailDecisions: {
        status: status("decisions", () => h.decisions),
      },
      eyeonOverview: { homeStatus: status("home", () => h.home) },
    },
  };
});
vi.mock("@/src/features/dashboard/ProjectHomePage", () => ({
  default: () => <p>Classic Home</p>,
}));
vi.mock("@/src/features/acme-enhancements/pages/EyeonOverviewPage", () => ({
  default: ({ asHome }: { asHome?: boolean }) => (
    <p>{asHome ? "EYEON overview as Home" : "EYEON overview"}</p>
  ),
}));
vi.mock("@/src/components/layouts/page", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/src/components/NoDataOrLoading", () => ({
  NoDataOrLoading: () => <p>Loading</p>,
}));

function signedInAs(role: string, admin = false) {
  h.session = {
    status: "authenticated",
    data: {
      user: {
        id: "u1",
        admin,
        organizations: [
          {
            id: "o1",
            role,
            projects: [{ id: "p1", role }],
          },
        ],
      },
    },
  };
}

function flags(p: { home?: boolean; decisions?: boolean }) {
  h.home =
    p.home === undefined
      ? { isError: false }
      : { data: { enabled: p.home }, isError: false };
  h.decisions =
    p.decisions === undefined
      ? { isError: false }
      : { data: { enabled: p.decisions }, isError: false };
}

beforeEach(() => {
  h.replace.mockClear();
  h.asked.clear();
  flags({ home: false, decisions: false });
});

describe("EYEON Home flag (CHG-2026-136)", () => {
  it.each(["OWNER", "ADMIN"])("flag off: %s keeps the classic Home", (role) => {
    signedInAs(role);
    render(<EyeonProjectHome />);
    expect(screen.getByText("Classic Home")).toBeInTheDocument();
    expect(screen.queryByText(/EYEON overview/)).toBeNull();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "ADMIN"])(
    "flag on: %s gets the EYEON overview as Home",
    (role) => {
      signedInAs(role);
      flags({ home: true });
      render(<EyeonProjectHome />);
      expect(screen.getByText("EYEON overview as Home")).toBeInTheDocument();
      expect(screen.queryByText("Classic Home")).toBeNull();
      expect(h.replace).not.toHaveBeenCalled();
    },
  );

  it("an instance admin follows the flag like an Owner", () => {
    signedInAs("NONE", true);
    flags({ home: true });
    render(<EyeonProjectHome />);
    expect(screen.getByText("EYEON overview as Home")).toBeInTheDocument();
  });

  it("falls back to the classic Home when the flag cannot be read", () => {
    signedInAs("OWNER");
    h.home = { isError: true };
    render(<EyeonProjectHome />);
    expect(screen.getByText("Classic Home")).toBeInTheDocument();
  });

  it("shows neither Home while the flag is still being asked", () => {
    signedInAs("OWNER");
    flags({});
    render(<EyeonProjectHome />);
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.queryByText("Classic Home")).toBeNull();
    expect(screen.queryByText(/EYEON overview/)).toBeNull();
  });

  it("shows neither Home while the session loads", () => {
    h.session = { status: "loading", data: null };
    render(<EyeonProjectHome />);
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(h.asked.size).toBe(0);
  });
});

describe("role landings (CHG-2026-136)", () => {
  // Prompt Analyst (MEMBER), Viewer and Business Analyst cannot open the
  // overview, so they keep the classic Home, and the flag is not even asked.
  it.each(["MEMBER", "VIEWER", "ANALYST"])(
    "%s keeps the classic Home with EYEON Home on",
    (role) => {
      signedInAs(role);
      flags({ home: true, decisions: true });
      render(<EyeonProjectHome />);
      expect(screen.getByText("Classic Home")).toBeInTheDocument();
      expect(h.replace).not.toHaveBeenCalled();
      expect(h.asked.size).toBe(0);
    },
  );

  it.each([
    ["SECURITY", true, "guardrail-decisions"],
    ["SECURITY", false, "guardrails"],
    ["AUDITOR", true, "guardrail-decisions"],
    ["AUDITOR", false, "guardrails"],
  ] as const)(
    "%s with Guardrail decisions %s lands on %s, whatever Home's flag says",
    (role, decisionsOn, page) => {
      for (const home of [false, true]) {
        h.replace.mockClear();
        signedInAs(role);
        flags({ home, decisions: decisionsOn });
        const { unmount } = render(<EyeonProjectHome />);
        expect(h.replace).toHaveBeenCalledWith(
          `/project/p1/acme-enhancements/${page}`,
        );
        // Never a Home, not even for a moment, and Home's flag is not asked.
        expect(screen.queryByText("Classic Home")).toBeNull();
        expect(screen.queryByText(/EYEON overview/)).toBeNull();
        expect(h.asked.has("home")).toBe(false);
        unmount();
      }
    },
  );

  it("the Security Analyst lands on Guardrails, as before, when the decisions flag cannot be read", () => {
    signedInAs("SECURITY");
    h.decisions = { isError: true };
    render(<EyeonProjectHome />);
    expect(h.replace).toHaveBeenCalledWith(
      "/project/p1/acme-enhancements/guardrails",
    );
  });

  it("the Security Analyst waits for the decisions flag before going anywhere", () => {
    signedInAs("SECURITY");
    flags({});
    render(<EyeonProjectHome />);
    expect(h.replace).not.toHaveBeenCalled();
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });
});

describe("projectHomeLanding", () => {
  const base = {
    projectId: "p1",
    sessionLoading: false,
    landsOnGuardrails: false,
    guardrailDecisionsOn: undefined,
    canOpenOverview: false,
    eyeonHomeOn: undefined,
  };

  it("waits without a project or a session", () => {
    expect(projectHomeLanding({ ...base, projectId: undefined })).toEqual({
      kind: "wait",
    });
    expect(projectHomeLanding({ ...base, sessionLoading: true })).toEqual({
      kind: "wait",
    });
  });

  it("sends a guardrail role by the decisions flag only", () => {
    expect(
      projectHomeLanding({
        ...base,
        landsOnGuardrails: true,
        canOpenOverview: true,
        guardrailDecisionsOn: true,
        eyeonHomeOn: true,
      }),
    ).toEqual({
      kind: "redirect",
      href: "/project/p1/acme-enhancements/guardrail-decisions",
    });
    expect(
      projectHomeLanding({
        ...base,
        landsOnGuardrails: true,
        guardrailDecisionsOn: false,
        eyeonHomeOn: true,
      }),
    ).toEqual({
      kind: "redirect",
      href: "/project/p1/acme-enhancements/guardrails",
    });
  });

  it("gives the overview as Home only to a role that can open it, with the flag on", () => {
    expect(
      projectHomeLanding({ ...base, canOpenOverview: true, eyeonHomeOn: true }),
    ).toEqual({ kind: "eyeonHome" });
    expect(
      projectHomeLanding({
        ...base,
        canOpenOverview: true,
        eyeonHomeOn: false,
      }),
    ).toEqual({ kind: "classicHome" });
    expect(
      projectHomeLanding({
        ...base,
        canOpenOverview: false,
        eyeonHomeOn: true,
      }),
    ).toEqual({ kind: "classicHome" });
  });
});
