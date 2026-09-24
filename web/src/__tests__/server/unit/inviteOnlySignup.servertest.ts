import { describe, it, expect, vi } from "vitest";
import {
  decideSignup,
  type InvitationLookup,
} from "@/src/features/auth/lib/inviteOnlySignup";

// CHG-2026-057. No database: the invitation lookup is a fake.

function db(invitedEmails: string[]): InvitationLookup & {
  count: ReturnType<typeof vi.fn>;
} {
  const count = vi.fn(
    async ({ where }: { where: { email: string } }) =>
      invitedEmails.filter((e) => e === where.email).length,
  );
  return { membershipInvitation: { count }, count };
}

const DISABLED_INVITE_ONLY = { signupDisabled: true, allowInvitedSignup: true };

describe("decideSignup", () => {
  it("leaves open sign-up untouched and never queries invitations", async () => {
    const fake = db([]);
    await expect(
      decideSignup(
        "new@acme.example",
        { signupDisabled: false, allowInvitedSignup: false },
        fake,
      ),
    ).resolves.toEqual({ allowed: true, reason: "signup-open" });
    expect(fake.count).not.toHaveBeenCalled();
  });

  it("keeps upstream behaviour when the switch is off: invited or not, refused", async () => {
    const fake = db(["member@acme.example"]);
    await expect(
      decideSignup(
        "member@acme.example",
        { signupDisabled: true, allowInvitedSignup: false },
        fake,
      ),
    ).resolves.toEqual({ allowed: false, reason: "signup-disabled" });
    expect(fake.count).not.toHaveBeenCalled();
  });

  it("allows an email with a pending invitation", async () => {
    await expect(
      decideSignup(
        "member@acme.example",
        DISABLED_INVITE_ONLY,
        db(["member@acme.example"]),
      ),
    ).resolves.toEqual({ allowed: true, reason: "invited" });
  });

  it("matches case- and whitespace-insensitively against the stored lowercase invite", async () => {
    const fake = db(["member@acme.example"]);
    await expect(
      decideSignup("  Member@ACME.example ", DISABLED_INVITE_ONLY, fake),
    ).resolves.toMatchObject({ allowed: true });
    expect(fake.count).toHaveBeenCalledWith({
      where: { email: "member@acme.example" },
    });
  });

  it.each([
    ["an uninvited email", "stranger@acme.example"],
    ["a look-alike of an invited email", "member@acme.example.evil.com"],
    ["a partial match", "ember@acme.example"],
    ["no email", null],
    ["an empty email", "   "],
    ["a malformed email", "member@"],
  ])("refuses %s", async (_label, email) => {
    await expect(
      decideSignup(email, DISABLED_INVITE_ONLY, db(["member@acme.example"])),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("does not query the database for a malformed email", async () => {
    const fake = db(["member@acme.example"]);
    await decideSignup("not-an-email", DISABLED_INVITE_ONLY, fake);
    expect(fake.count).not.toHaveBeenCalled();
  });
});
