/**
 * ACME addition (CHG-2026-057): invite-only sign-up.
 *
 * Upstream's AUTH_DISABLE_SIGNUP blocks creating ANY account, so a person
 * invited to an organisation or project can't sign in through SSO for the
 * first time. With CAIRO_AUTH_ALLOW_INVITED_SIGNUP=true, an account may be
 * created while sign-up is disabled only when a pending invitation exists
 * for that exact email. The invitation, created by an org admin, is the
 * authority; the sign-in itself grants nothing.
 *
 * It applies only to the auth adapter's createUser, which is the SSO path.
 * Password sign-up has its own route and stays disabled.
 *
 * It trusts the identity provider's email claim. That holds for a
 * single-tenant Entra ID app (AUTH_AZURE_AD_TENANT_ID set), where only the
 * tenant's admins set a user's email. Do not enable it with a multi-tenant
 * or social provider whose email claim a user controls.
 */
import { z } from "zod";

export type InvitationLookup = {
  membershipInvitation: {
    count(args: { where: { email: string } }): Promise<number>;
  };
};

export type SignupFlags = {
  signupDisabled: boolean;
  allowInvitedSignup: boolean;
};

export type SignupDecision =
  | { allowed: true; reason: "signup-open" | "invited" }
  | { allowed: false; reason: "signup-disabled" | "no-invitation" };

export async function decideSignup(
  email: string | null | undefined,
  flags: SignupFlags,
  db: InvitationLookup,
): Promise<SignupDecision> {
  if (!flags.signupDisabled) return { allowed: true, reason: "signup-open" };
  if (!flags.allowInvitedSignup) {
    return { allowed: false, reason: "signup-disabled" };
  }
  const normalised = email?.trim().toLowerCase() ?? "";
  if (!z.email().safeParse(normalised).success) {
    return { allowed: false, reason: "no-invitation" };
  }
  // Invitations are stored lowercased (membersRouter), so this is an exact match.
  const pending = await db.membershipInvitation.count({
    where: { email: normalised },
  });
  return pending > 0
    ? { allowed: true, reason: "invited" }
    : { allowed: false, reason: "no-invitation" };
}
