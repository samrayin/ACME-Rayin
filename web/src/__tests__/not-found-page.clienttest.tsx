import { render, screen } from "@testing-library/react";

import NotFoundPage from "@/src/pages/404";

// next/head needs Next's head manager; render its children in place so the
// title reaches the document (React hoists <title> into <head>).
vi.mock("next/head", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("NotFoundPage (CHG-2026-085 b)", () => {
  it("titles the tab CAIRO, not Next.js", () => {
    render(<NotFoundPage />);

    expect(document.title).toBe("404: This page could not be found | CAIRO");
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
