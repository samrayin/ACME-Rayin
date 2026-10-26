import { useEffect, useState } from "react";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { api, type RouterOutputs } from "@/src/utils/api";
import {
  REVEAL_PURPOSES,
  REVEAL_PURPOSE_LABELS,
  type RevealPurpose,
  visibleControls,
} from "@/src/features/acme-enhancements/utils/guardrailContentReveal";

// ACME (blocked-prompt review, piece 2): read one blocked event's stored
// content, from the guardrail event detail. The person picks a purpose and
// writes a note, the server writes the audit log, then returns the content
// once. It lives only in this component's state and the mutation is reset
// when the detail closes; it is never kept in the query or mutation cache,
// a list or an export. The text is rendered as a plain text node, with
// control and bidirectional characters made visible.

type Revealed = RouterOutputs["acmeGuardrails"]["revealBlockedContent"];

const MIN_NOTE = 20;

export function RevealBlockedContent({
  projectId,
  eventRowId,
}: {
  projectId: string;
  eventRowId: string;
}) {
  const [asking, setAsking] = useState(false);
  const [purpose, setPurpose] = useState<RevealPurpose | null>(null);
  const [note, setNote] = useState("");
  const reveal = api.acmeGuardrails.revealBlockedContent.useMutation({
    gcTime: 0,
  });
  const { reset } = reveal;
  // Forget the content when the detail closes or shows another event.
  useEffect(() => () => reset(), [reset]);

  if (reveal.data) return <RevealedText revealed={reveal.data} />;

  if (!asking) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => setAsking(true)}
      >
        Show blocked content
      </Button>
    );
  }

  const ready = purpose !== null && note.trim().length >= MIN_NOTE;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || purpose === null) return;
        reveal.mutate({
          projectId,
          id: eventRowId,
          reason: { purpose, note: note.trim() },
        });
      }}
    >
      <p className="text-xs">
        Reading it is recorded in the audit log with your name, the purpose and
        your note.
      </p>
      <Label className="text-xs">Purpose</Label>
      <Select
        value={purpose ?? undefined}
        onValueChange={(v) =>
          setPurpose(REVEAL_PURPOSES.find((p) => p === v) ?? null)
        }
      >
        <SelectTrigger aria-label="Purpose">
          <SelectValue placeholder="Choose a purpose" />
        </SelectTrigger>
        <SelectContent>
          {REVEAL_PURPOSES.map((p) => (
            <SelectItem key={p} value={p}>
              {REVEAL_PURPOSE_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Label htmlFor="reveal-note" className="text-xs">
        Note (at least {MIN_NOTE} characters)
      </Label>
      <Textarea
        id="reveal-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="For example: user reported that a leave question was refused"
      />
      {reveal.isError ? (
        <p className="text-destructive text-xs">{reveal.error.message}</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ready || reveal.isPending}>
          {reveal.isPending ? "Opening…" : "Show content"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setAsking(false);
            setNote("");
            setPurpose(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RevealedText({ revealed }: { revealed: Revealed }) {
  const { content, refusedWindow: w } = revealed;
  // Split before making controls visible, so the highlight stays on the
  // refused part.
  const [before, inside, after] = w
    ? [
        content.slice(0, w.start),
        content.slice(w.start, w.end),
        content.slice(w.end),
      ]
    : [content, "", ""];
  return (
    <div className="flex flex-col gap-1">
      <pre className="bg-muted max-h-80 overflow-auto rounded-md p-2 font-mono text-xs whitespace-pre-wrap">
        {visibleControls(before)}
        {w ? (
          <mark className="rounded-sm bg-amber-200 text-black dark:bg-amber-500/40 dark:text-inherit">
            {visibleControls(inside)}
          </mark>
        ) : null}
        {visibleControls(after)}
      </pre>
      <p className="text-muted-foreground text-xs">
        {w
          ? `Highlighted: the part the judge refused (part ${w.index + 1} of ${w.count})${w.positionsExact ? "" : ", approximate because a card number was masked"}. `
          : ""}
        {revealed.truncated
          ? `Only the first ${revealed.contentChars.toLocaleString()} of ${(revealed.originalChars ?? 0).toLocaleString()} characters were kept. `
          : ""}
        Recorded via{" "}
        {revealed.source === "push"
          ? "the guardrails service's audit push"
          : revealed.source === "pull"
            ? "the fallback pull"
            : "an unknown path"}
        . Personal data was masked before it was stored. This reading is in the
        audit log.
      </p>
    </div>
  );
}
