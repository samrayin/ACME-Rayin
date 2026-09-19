import { render, screen } from "@testing-library/react";
import { AcmeSignInHeadline } from "@/src/features/acme-enhancements/components/AcmeSignInHeadline";

describe("AcmeSignInHeadline", () => {
  it("renders the brand headline as the page's h1", () => {
    render(<AcmeSignInHeadline />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "ACME Governance and Assurance Offering",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the animated dash out of the accessibility tree", () => {
    const { container } = render(<AcmeSignInHeadline />);

    const dash = container.querySelector(".animate-acme-dash-draw");
    expect(dash).not.toBeNull();
    expect(dash).toHaveAttribute("aria-hidden", "true");
  });
});
