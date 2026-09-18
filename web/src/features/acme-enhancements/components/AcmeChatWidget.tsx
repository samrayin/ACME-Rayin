"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Textarea } from "@/src/components/ui/textarea";
import { Layer } from "@/src/components/design-system/Layer/Layer";
import { api } from "@/src/utils/api";
import { cn } from "@/src/utils/tailwind";
import { useHasProjectAccess } from "@/src/features/rbac";

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * ACME AI — floating chat widget, embedded natively in the console.
 *
 * Uses the "panel" layer band (docked/side surfaces) rather than "agent"
 * (Langfuse's own in-app assistant window) to avoid two persistent floating
 * windows visually competing for the same stacking band.
 */
export function AcmeChatWidget({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // UX-only: hides the launcher for roles that lack "projectAiAssistant:use"
  // (VIEWER) so it doesn't sit there as a button that always errors. The
  // real boundary is the server-side throwIfNoProjectAccess check in
  // acmeChatRouter.ts -- this check is not what makes the feature safe.
  const canUse = useHasProjectAccess({
    projectId,
    scope: "projectAiAssistant:use",
  });

  const sendMessage = api.acmeChat.sendMessage.useMutation();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sendMessage.isPending]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || sendMessage.isPending) return;

    const history = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");

    sendMessage.mutate(
      { projectId, history, message: text },
      {
        onSuccess: (result) => {
          setMessages((m) => [...m, { role: "assistant", content: result.reply }]);
        },
        onError: (err) => {
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              content: `Something went wrong: ${err.message}`,
            },
          ]);
        },
      },
    );
  };

  if (!canUse) return null;

  return (
    <Layer name="panel">
      <div className="pointer-events-none fixed inset-0">
        {open ? (
          <div className="pointer-events-auto fixed bottom-20 right-6 flex h-[520px] w-96 flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 font-semibold">
                <MessageCircle className="h-4 w-4" />
                ACME AI
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
                aria-label="Close ACME AI"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
            >
              {messages.length === 0 ? (
                <p className="text-muted-foreground">
                  Ask about this project&apos;s traces, or about Langfuse
                  licensing and support — I have read-only access to this
                  project&apos;s own data.
                </p>
              ) : (
                messages.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "whitespace-pre-wrap rounded-md px-3 py-2",
                      m.role === "user"
                        ? "ml-8 bg-primary text-primary-foreground"
                        : "mr-8 bg-muted",
                    )}
                  >
                    {m.content}
                  </div>
                ))
              )}
              {sendMessage.isPending ? (
                <div className="mr-8 rounded-md bg-muted px-3 py-2 text-muted-foreground">
                  Thinking…
                </div>
              ) : null}
            </div>

            <div className="flex items-end gap-2 border-t p-3">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask ACME AI…"
                className="min-h-9 resize-none"
                rows={1}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || sendMessage.isPending}
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}

        <Button
          className="pointer-events-auto fixed bottom-6 right-6 h-12 w-12 rounded-full shadow-lg"
          size="icon"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close ACME AI" : "Open ACME AI"}
        >
          {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        </Button>
      </div>
    </Layer>
  );
}
