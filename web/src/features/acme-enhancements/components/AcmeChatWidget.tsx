"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Textarea } from "@/src/components/ui/textarea";
import { Layer } from "@/src/components/design-system/Layer/Layer";
import { api } from "@/src/utils/api";
import { cn } from "@/src/utils/tailwind";
import { useHasProjectAccess } from "@/src/features/rbac";
import { useAcmeChatPanel } from "@/src/features/acme-enhancements/components/acmeChatPanelStore";

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * ACME AI — chat panel, embedded natively in the console. Opened from its
 * launcher in the top bar (AcmeChatLauncher, ADR-0015); rendered here, in the
 * persistent layout, so the conversation survives navigation.
 *
 * Uses the "panel" layer band (docked/side surfaces) rather than "agent"
 * (Langfuse's own in-app assistant window) to avoid two persistent floating
 * windows visually competing for the same stacking band.
 */
export function AcmeChatWidget({ projectId }: { projectId: string }) {
  const { open, setOpen } = useAcmeChatPanel();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // UX-only: no panel for roles that lack "projectAiAssistant:use" (VIEWER),
  // matching the launcher, which is hidden for them. The real boundary is the
  // server-side throwIfNoProjectAccess check in acmeChatRouter.ts -- this
  // check is not what makes the feature safe.
  const canUse = useHasProjectAccess({
    projectId,
    scope: "projectAiAssistant:use",
  });

  const sendMessage = api.acmeChat.sendMessage.useMutation();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sendMessage.isPending]);

  // On open, focus the input and let Escape close the panel.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

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
          setMessages((m) => [
            ...m,
            { role: "assistant", content: result.reply },
          ]);
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

  // Always mounted, so the conversation survives closing the panel and
  // navigating; only the panel itself comes and goes.
  return (
    <Layer name="panel">
      <div className="pointer-events-none fixed inset-0">
        {/* Just below the top bar's first row, right-aligned under the
            launcher, and never taller than the space left on screen. */}
        {canUse && open ? (
          <div
            id="acme-ai-panel"
            role="dialog"
            aria-label="ACME AI"
            className="bg-background pointer-events-auto fixed top-[calc(var(--banner-offset)_+_3.25rem)] right-4 flex h-[min(520px,calc(100dvh_-_var(--banner-offset)_-_4.5rem))] w-96 max-w-[calc(100vw_-_2rem)] flex-col overflow-hidden rounded-lg border shadow-xl"
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 font-bold">
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
                      "rounded-md px-3 py-2 whitespace-pre-wrap",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground ml-8"
                        : "bg-muted mr-8",
                    )}
                  >
                    {m.content}
                  </div>
                ))
              )}
              {sendMessage.isPending ? (
                <div className="bg-muted text-muted-foreground mr-8 rounded-md px-3 py-2">
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
                ref={inputRef}
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
      </div>
    </Layer>
  );
}
