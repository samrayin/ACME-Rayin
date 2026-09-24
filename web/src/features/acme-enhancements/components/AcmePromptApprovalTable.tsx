import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Textarea } from "@/src/components/ui/textarea";
import { Label } from "@/src/components/ui/label";
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
import { api } from "@/src/utils/api";
import { useHasProjectAccess } from "@/src/features/rbac";
import { showErrorToast, showSuccessToast } from "@/src/features/notifications";

function StatusBadge({
  status,
}: {
  status: "PENDING" | "APPROVED" | "REJECTED";
}) {
  if (status === "APPROVED") return <Badge variant="success">Approved</Badge>;
  if (status === "REJECTED") return <Badge variant="error">Rejected</Badge>;
  return <Badge variant="warning">Pending</Badge>;
}

function RequestApprovalForm({ projectId }: { projectId: string }) {
  const prompts = api.acmePromptReview.listAll.useQuery({ projectId });
  const utils = api.useUtils();

  const [promptId, setPromptId] = useState<string>("");
  const [targetLabel, setTargetLabel] = useState("production");
  const [comment, setComment] = useState("");

  const request = api.acmePromptApproval.request.useMutation({
    onSuccess: () => {
      utils.acmePromptApproval.listPending.invalidate({ projectId });
      setComment("");
      showSuccessToast({
        title: "Approval requested",
        description: `Waiting on an Owner/Admin to approve label "${targetLabel}".`,
      });
    },
    onError: (error) =>
      showErrorToast("Failed to request approval", error.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Request approval</CardTitle>
        <p className="text-muted-foreground text-xs">
          Ask an Owner/Admin to push this prompt version to a label — the label
          only moves once they approve.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div>
          <Label htmlFor="approval-prompt">Prompt</Label>
          <Select value={promptId} onValueChange={setPromptId}>
            <SelectTrigger id="approval-prompt" className="mt-1.5">
              <SelectValue placeholder="Select a prompt…" />
            </SelectTrigger>
            <SelectContent>
              {(prompts.data?.prompts ?? []).map((p) => (
                <SelectItem key={p.promptId} value={p.promptId}>
                  {p.name} (v{p.version})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="approval-label">Target label</Label>
          <Input
            id="approval-label"
            className="mt-1.5"
            value={targetLabel}
            onChange={(e) => setTargetLabel(e.target.value)}
            placeholder="production"
          />
        </div>
        <div>
          <Label htmlFor="approval-comment">Comment (optional)</Label>
          <Textarea
            id="approval-comment"
            className="mt-1.5"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Why this version, what changed…"
          />
        </div>
        <Button
          size="sm"
          className="w-fit"
          disabled={!promptId || !targetLabel.trim() || request.isPending}
          onClick={() =>
            request.mutate({
              projectId,
              promptId,
              targetLabel: targetLabel.trim(),
              comment: comment.trim() || undefined,
            })
          }
        >
          {request.isPending ? "Requesting…" : "Request approval"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function AcmePromptApprovalTable({ projectId }: { projectId: string }) {
  // ADR-0011 §11.1: approve/reject buttons only for promptApprovals:approve.
  const canReview = useHasProjectAccess({
    projectId,
    scope: "promptApprovals:approve",
  });
  const canRequest = useHasProjectAccess({ projectId, scope: "prompts:CUD" });
  const pending = api.acmePromptApproval.listPending.useQuery({ projectId });
  const history = api.acmePromptApproval.listHistory.useQuery({ projectId });
  const utils = api.useUtils();

  const approve = api.acmePromptApproval.approve.useMutation({
    onSuccess: () => {
      utils.acmePromptApproval.listPending.invalidate({ projectId });
      utils.acmePromptApproval.listHistory.invalidate({ projectId });
      showSuccessToast({ title: "Approved", description: "Label pushed." });
    },
    onError: (error) => showErrorToast("Failed to approve", error.message),
  });
  const reject = api.acmePromptApproval.reject.useMutation({
    onSuccess: () => {
      utils.acmePromptApproval.listPending.invalidate({ projectId });
      utils.acmePromptApproval.listHistory.invalidate({ projectId });
      showSuccessToast({
        title: "Rejected",
        description: "The requester can submit a new request if needed.",
      });
    },
    onError: (error) => showErrorToast("Failed to reject", error.message),
  });

  if (pending.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }

  const pendingCount = pending.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-bold tracking-wide uppercase">
              Pending
            </CardTitle>
          </CardHeader>
          <CardContent className="text-dark-yellow pt-0 text-2xl font-bold">
            {pendingCount}
          </CardContent>
        </Card>
      </div>

      {canRequest && <RequestApprovalForm projectId={projectId} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pending requests</CardTitle>
          {!canReview && (
            <p className="text-muted-foreground text-xs">
              Owner/Admin can approve or reject.
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {pendingCount === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing waiting on approval right now.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Target label</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Comment</TableHead>
                  {canReview && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.data!.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link
                        href={`/project/${projectId}/prompts/${encodeURIComponent(a.promptName)}`}
                        className="text-primary hover:underline"
                      >
                        {a.promptName} (v{a.promptVersion})
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{a.targetLabel}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {new Date(a.requestedAt).toLocaleString()}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground max-w-[240px] truncate text-xs"
                      title={a.requestComment ?? undefined}
                    >
                      {a.requestComment ?? "—"}
                    </TableCell>
                    {canReview && (
                      <TableCell>
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            disabled={approve.isPending || reject.isPending}
                            onClick={() =>
                              approve.mutate({ projectId, approvalId: a.id })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={approve.isPending || reject.isPending}
                            onClick={() =>
                              reject.mutate({ projectId, approvalId: a.id })
                            }
                          >
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">History</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {!history.data || history.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No resolved requests yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Target label</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      {a.promptName} (v{a.promptVersion})
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{a.targetLabel}</Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.reviewedAt
                        ? new Date(a.reviewedAt).toLocaleString()
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
