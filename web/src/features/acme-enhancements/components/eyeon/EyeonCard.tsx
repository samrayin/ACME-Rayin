import { type ReactNode } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";

// ACME (CHG-2026-132, ADR-0027): the EYEON card, after the prototype's: a
// title, one sentence saying what the card tells you, the content, and,
// where a deeper page exists, a link to it beside an optional footnote.

export function EyeonCard({
  title,
  subtitle,
  link,
  footnote,
  children,
}: {
  title: string;
  /** One sentence: what this card tells the reader. */
  subtitle: string;
  link?: { href: string; label: string };
  footnote?: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex h-full min-w-0 flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {children}
      </CardContent>
      {link || footnote ? (
        <CardFooter className="text-muted-foreground flex-wrap justify-between gap-2 border-t pt-3 text-xs">
          <span>{footnote}</span>
          {link ? (
            <Link href={link.href} className="text-foreground underline">
              {link.label}
            </Link>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
