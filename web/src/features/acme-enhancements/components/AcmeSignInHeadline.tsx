/**
 * ACME enhancement — brand headline on the sign-in page ("option B"): each
 * word comes into focus in turn, then a maroon-to-navy dash draws underneath.
 *
 * The keyframes live in globals.css (`acme-focus-in`, `acme-dash-draw`). With
 * prefers-reduced-motion the headline and dash render finished, without motion.
 *
 * Orbitron Black is bundled locally (SIL Open Font License 1.1, see
 * public/fonts/Orbitron-OFL.txt), so the sign-in page makes no runtime font
 * request — this matters for air-gapped customer deployments. next/font puts
 * the 900 weight on its own class, which is how the headline stays heavy
 * without a raw font-weight utility.
 */
import localFont from "next/font/local";
import { cn } from "@/src/utils/tailwind";

const orbitron = localFont({
  src: "../../../../public/fonts/Orbitron-Black.woff2",
  weight: "900",
  style: "normal",
  display: "swap",
});

const word = "animate-acme-focus-in inline-block motion-reduce:animate-none";

export function AcmeSignInHeadline() {
  return (
    <div className="text-center">
      <h1
        className={cn(
          orbitron.className,
          "text-primary text-2xl leading-tight tracking-wide sm:text-3xl",
        )}
      >
        <span className={cn(word, "text-acme-maroon [animation-delay:150ms]")}>
          ACME
        </span>{" "}
        <span className={cn(word, "[animation-delay:330ms]")}>Governance</span>
        <br />
        <span className={cn(word, "[animation-delay:510ms]")}>and</span>{" "}
        <span className={cn(word, "[animation-delay:690ms]")}>Assurance</span>{" "}
        <span className={cn(word, "[animation-delay:870ms]")}>Offering</span>
      </h1>
      <div
        aria-hidden="true"
        className="from-acme-maroon to-primary animate-acme-dash-draw mx-auto mt-3 h-1 w-0 rounded-full bg-linear-to-r motion-reduce:w-3/4 motion-reduce:animate-none"
      />
    </div>
  );
}
