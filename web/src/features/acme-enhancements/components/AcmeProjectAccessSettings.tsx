import { useMemo, useState } from "react";
import { type Role } from "@langfuse/shared";
import Header from "@/src/components/layouts/header";
import { Badge } from "@/src/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { formatRole } from "@/src/features/rbac/components/RoleSelectItem";
import { showErrorToast, showSuccessToast } from "@/src/features/notifications";
import { api } from "@/src/utils/api";

// "No limit" is not a Role: it removes the policy row.
const NO_LIMIT = "__no_limit__";

/**
 * ACME (ADR-0011 section 5): Organization settings > Project access.
 * Per member and project, an admin sets a limit that can only narrow the
 * member's organization role. Only valid limits are offered; the server
 * checks again.
 */
export function AcmeProjectAccessSettings({ orgId }: { orgId: string }) {
  const overview = api.acmeProjectAccess.overview.useQuery({ orgId });
  const utils = api.useUtils();
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const onDone = (title: string) => {
    showSuccessToast({
      title,
      description: "The member sees the change on their next page load.",
    });
    utils.acmeProjectAccess.overview.invalidate({ orgId }).catch(() => {});
  };
  const setLimit = api.acmeProjectAccess.set.useMutation({
    onSuccess: () => onDone("Project access limit saved"),
    onError: (error) =>
      showErrorToast("Failed to save the limit", error.message),
  });
  const removeLimit = api.acmeProjectAccess.remove.useMutation({
    onSuccess: () => onDone("Project access limit removed"),
    onError: (error) =>
      showErrorToast("Failed to remove the limit", error.message),
  });

  const data = overview.data;
  const member = data?.members.find((m) => m.userId === selectedUserId);
  const policyOf = useMemo(() => {
    const byProject = new Map<string, { ceilingRole: Role; valid: boolean }>();
    for (const p of data?.policies ?? [])
      if (p.userId === selectedUserId) byProject.set(p.projectId, p);
    return byProject;
  }, [data, selectedUserId]);
  const needsReview = (data?.policies ?? []).filter((p) => !p.valid).length;

  return (
    <div className="flex flex-col gap-4">
      <Header title="Project access" />
      <p className="text-muted-foreground max-w-prose text-sm">
        Limit what a member can do in a single project. A limit can only narrow
        the member&apos;s organization role, never widen it. &quot;No
        access&quot; hides the project from them. Projects without a limit use
        the organization role.
      </p>
      {data && !data.enabled && (
        <p className="text-dark-yellow text-sm">
          The project access policy is switched off in this deployment
          (CAIRO_PROJECT_ACCESS_POLICY_ENABLED=false). Limits are kept but not
          applied.
        </p>
      )}
      {needsReview > 0 && (
        <p className="text-dark-red text-sm">
          {needsReview} limit{needsReview === 1 ? "" : "s"} no longer fit the
          member&apos;s organization role. Those projects stay hidden from the
          member until you change or remove the limit.
        </p>
      )}

      <div className="max-w-md">
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a member" />
          </SelectTrigger>
          <SelectContent>
            {(data?.members ?? []).map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name ?? m.email} · {formatRole(m.orgRole)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {member && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Access in this project</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.projects ?? []).map((project) => {
              const policy = policyOf.get(project.id);
              const value = policy?.ceilingRole ?? NO_LIMIT;
              const busy = setLimit.isPending || removeLimit.isPending;
              return (
                <TableRow key={project.id}>
                  <TableCell>{project.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-64">
                        <Select
                          value={value}
                          disabled={busy}
                          onValueChange={(next) => {
                            const target = {
                              orgId,
                              projectId: project.id,
                              userId: member.userId,
                            };
                            if (next === NO_LIMIT) removeLimit.mutate(target);
                            else
                              setLimit.mutate({
                                ...target,
                                ceilingRole: next as Role,
                              });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_LIMIT}>
                              No limit ({formatRole(member.orgRole)})
                            </SelectItem>
                            {member.validCeilings.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role === "NONE"
                                  ? "No access"
                                  : formatRole(role)}
                              </SelectItem>
                            ))}
                            {policy && !policy.valid && (
                              <SelectItem value={policy.ceilingRole} disabled>
                                {formatRole(policy.ceilingRole)} (no longer
                                valid)
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      {policy && !policy.valid && (
                        <Badge variant="warning">Review</Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
