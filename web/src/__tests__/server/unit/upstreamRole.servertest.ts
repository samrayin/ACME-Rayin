import { describe, it, expect, vi, beforeEach } from "vitest";

// CHG-2026-058. The Salesforce service is mocked: the test checks what the
// MIT wrapper hands to upstream, not the upstream service itself.
const setUserRole = vi.fn(async () => undefined);
let serviceEnabled = true;
vi.mock("@/src/ee/features/sfdc-sync/server", () => ({
  getSfdcService: () => (serviceEnabled ? { setUserRole } : null),
}));

import {
  ACME_ONLY_ROLES,
  syncSfdcUserRole,
  toUpstreamRole,
} from "@/src/features/rbac/lib/upstreamRole";

const base = { orgId: "org-1", userId: "user-1", email: "a@acme.example" };

describe("upstream role conversion", () => {
  beforeEach(() => {
    setUserRole.mockClear();
    serviceEnabled = true;
  });

  it.each(["OWNER", "ADMIN", "MEMBER", "VIEWER", "NONE"] as const)(
    "passes upstream role %s through unchanged",
    async (role) => {
      expect(toUpstreamRole(role)).toBe(role);
      await syncSfdcUserRole({ ...base, role });
      expect(setUserRole).toHaveBeenCalledWith({ ...base, role });
    },
  );

  it.each(ACME_ONLY_ROLES)(
    "never hands ACME-only role %s to upstream",
    async (role) => {
      expect(toUpstreamRole(role)).toBeNull();
      await syncSfdcUserRole({ ...base, role });
      expect(setUserRole).not.toHaveBeenCalled();
    },
  );

  it("is a no-op when the upstream service is off, as in CAIRO", async () => {
    serviceEnabled = false;
    await expect(
      syncSfdcUserRole({ ...base, role: "ADMIN" }),
    ).resolves.toBeUndefined();
    expect(setUserRole).not.toHaveBeenCalled();
  });
});
