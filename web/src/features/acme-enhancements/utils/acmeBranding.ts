/**
 * CHG-2026-085 / ADR-0019: the product name shown in browser tab titles and
 * the other places the console names itself. EYEON since CHG-2026-121 (CEO
 * decision, 2026-10-06); it was CAIRO.
 */
export const ACME_PRODUCT_NAME = "EYEON";

/** acmePageTitle is "<page> | EYEON", or "EYEON" when there is no page. */
export function acmePageTitle(page?: string): string {
  return page ? `${page} | ${ACME_PRODUCT_NAME}` : ACME_PRODUCT_NAME;
}

// Langfuse reserves this prefix for the traces it writes itself (evaluator
// runs, prompt experiments, natural-language filters, ...): public ingestion
// strips it from customer environments, so only Langfuse's own carry it.
const INTERNAL_ENVIRONMENT_PREFIX = "langfuse-";
const INTERNAL_ENVIRONMENT_LABEL_PREFIX = "eyeon-";

/**
 * acmeEnvironmentLabel is how an environment name is shown: Langfuse's
 * internal environments read "eyeon-…" (for example `langfuse-llm-as-a-judge`
 * reads `eyeon-llm-as-a-judge`), every other name is shown as it is.
 *
 * Display only. The stored value is unchanged and stays what filters, queries,
 * saved views and the retention purge match on.
 */
export function acmeEnvironmentLabel(environment: string): string {
  return environment.startsWith(INTERNAL_ENVIRONMENT_PREFIX)
    ? INTERNAL_ENVIRONMENT_LABEL_PREFIX +
        environment.slice(INTERNAL_ENVIRONMENT_PREFIX.length)
    : environment;
}

/**
 * acmeEnvironmentOptions gives environment filter options their display
 * label, keeping each option's value (and any label it already has).
 */
export function acmeEnvironmentOptions<
  T extends { value: string; displayValue?: string },
>(options: readonly T[]): T[] {
  return options.map((option) => {
    const label = acmeEnvironmentLabel(option.value);
    return option.displayValue === undefined && label !== option.value
      ? { ...option, displayValue: label }
      : option;
  });
}
