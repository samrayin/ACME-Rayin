import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
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

// yyyy-mm-dd, what <input type="date"> both reads and writes.
function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function daysOverdue(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function ReviewDateCell({
  projectId,
  promptId,
  currentReviewDate,
  canEdit,
}: {
  projectId: string;
  promptId: string;
  currentReviewDate: string | null;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState(toDateInputValue(currentReviewDate));
  const utils = api.useUtils();

  const setReviewDate = api.acmePromptReview.setReviewDate.useMutation({
    onSuccess: () => {
      utils.acmePromptReview.listAll.invalidate({ projectId });
      utils.acmePromptReview.listDue.invalidate({ projectId });
      showSuccessToast({
        title: "Review date saved",
        description: draft ? `Set to ${draft}.` : "Cleared.",
      });
    },
    onError: (error) => showErrorToast("Failed to save review date", error.message),
  });

  const isDirty = draft !== toDateInputValue(currentReviewDate);

  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        value={draft}
        disabled={!canEdit || setReviewDate.isPending}
        onChange={(e) => setDraft(e.target.value)}
        className="h-8 w-36"
      />
      {isDirty && canEdit && (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={setReviewDate.isPending}
            onClick={() =>
              setReviewDate.mutate({
                projectId,
                promptId,
                reviewDate: draft
                  ? new Date(`${draft}T00:00:00.000Z`).toISOString()
                  : null,
              })
            }
          >
            {setReviewDate.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={setReviewDate.isPending}
            onClick={() => setDraft(toDateInputValue(currentReviewDate))}
          >
            Discard
          </Button>
        </>
      )}
    </div>
  );
}

export function AcmePromptReviewTable({ projectId }: { projectId: string }) {
  const canEdit = useHasProjectAccess({ projectId, scope: "prompts:CUD" });
  const due = api.acmePromptReview.listDue.useQuery({ projectId });
  const all = api.acmePromptReview.listAll.useQuery({ projectId });

  if (all.isPending) {
    return <div className="text-muted-foreground p-4 text-sm">Loading…</div>;
  }

  if (all.isError) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        Could not load prompts: {all.error.message}
      </div>
    );
  }

  const dueCount = due.data?.due.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Total prompts
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-semibold">
            {all.data.prompts.length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Past review date
            </CardTitle>
          </CardHeader>
          <CardContent className="text-dark-red pt-0 text-2xl font-semibold">
            {due.isPending ? "…" : dueCount}
          </CardContent>
        </Card>
      </div>

      {dueCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Due for review</CardTitle>
            <p className="text-muted-foreground text-xs">
              Latest version&apos;s configured review date has passed —
              checked nightly, most overdue first.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Review date</TableHead>
                  <TableHead>Overdue by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {due.data!.due.map((p) => (
                  <TableRow key={p.promptId}>
                    <TableCell>
                      <Link
                        href={`/project/${projectId}/prompts/${encodeURIComponent(p.name)}`}
                        className="text-primary hover:underline"
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>{p.version}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {toDateInputValue(p.reviewDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="error">
                        {daysOverdue(p.reviewDate)} day
                        {daysOverdue(p.reviewDate) === 1 ? "" : "s"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">All prompts</CardTitle>
          <p className="text-muted-foreground text-xs">
            Set or clear a review date on any prompt&apos;s latest version.
            {!canEdit && " Owner/Admin/Member can edit."}
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {all.data.prompts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No prompts in this project yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Review date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.data.prompts.map((p) => (
                  <TableRow key={p.promptId}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.version}</TableCell>
                    <TableCell>
                      <ReviewDateCell
                        projectId={projectId}
                        promptId={p.promptId}
                        currentReviewDate={p.reviewDate}
                        canEdit={canEdit}
                      />
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
