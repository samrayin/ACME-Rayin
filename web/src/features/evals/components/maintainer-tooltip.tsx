import { LangfuseIcon } from "@/src/components/design-system/LangfuseIcon/LangfuseIcon";
import { Tooltip } from "@/src/components/design-system/Tooltip/Tooltip";
import { RagasLogoIcon } from "@/src/features/evals/components/ragas-logo";
import { UserCircle2Icon } from "lucide-react";
import { ACME_BUILT_IN_LABEL } from "@/src/features/acme-enhancements/utils/acmeBranding";

// ACME (CHG-2026-146, ADR-0029): built-in templates are labelled "Built-in"
// (was "Langfuse maintained"), so the icon keys on that label, and the
// accessible name reads "Maintainer: Built-in" rather than "Maintained by …".
function MaintainerIcon({ maintainer }: { maintainer: string }) {
  if (maintainer.includes("Ragas")) {
    return <RagasLogoIcon />;
  } else if (maintainer.startsWith(ACME_BUILT_IN_LABEL)) {
    return <LangfuseIcon size={16} />;
  }
  return <UserCircle2Icon className="h-4 w-4" />;
}

export function MaintainerTooltip({ maintainer }: { maintainer: string }) {
  return (
    <Tooltip label={maintainer}>
      {({ getTriggerProps }) => (
        <button
          {...getTriggerProps()}
          type="button"
          aria-label={`Maintainer: ${maintainer}`}
          className="inline-flex"
        >
          <MaintainerIcon maintainer={maintainer} />
        </button>
      )}
    </Tooltip>
  );
}
