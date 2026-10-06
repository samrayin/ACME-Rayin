import { render, screen } from "@testing-library/react";

import NotFoundPage from "@/src/pages/404";
import AppNotFound, {
  metadata as appNotFoundMetadata,
} from "@/src/app/not-found";
import { metadata as appLayoutMetadata } from "@/src/app/layout";

// next/head needs Next's head manager; render its children in place so the
// title reaches the document (React hoists <title> into <head>).
vi.mock("next/head", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("NotFoundPage (CHG-2026-085 b)", () => {
  it("titles the tab EYEON, not Next.js", () => {
    render(<NotFoundPage />);

    expect(document.title).toBe("404: This page could not be found | EYEON");
  });

  it("shows the error page's 404 with a way home", () => {
    render(<NotFoundPage />);

    expect(screen.getByText("Error 404")).toBeInTheDocument();
    expect(
      screen.getByText("This page could not be found."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("stays static and renders without the app layout", () => {
    // Next.js refuses a 404 page with getInitialProps.
    expect("getInitialProps" in NotFoundPage).toBe(false);
    expect(NotFoundPage.skipAppLayout).toBe(true);
  });
});

describe("App Router not-found (CHG-2026-085 c)", () => {
  // Because src/app exists, Next.js serves every unmatched URL from here.
  it("titles the tab EYEON through the page metadata", () => {
    expect(appNotFoundMetadata.title).toBe(
      "404: This page could not be found | EYEON",
    );
    expect(JSON.stringify(appNotFoundMetadata)).not.toContain("Next.js");
  });

  it("drops Next.js's boilerplate from the root layout", () => {
    expect(appLayoutMetadata).toEqual({ title: "EYEON" });
  });

  it("shows the same 404 card as the Pages Router page", () => {
    render(<AppNotFound />);

    expect(screen.getByText("Error 404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
