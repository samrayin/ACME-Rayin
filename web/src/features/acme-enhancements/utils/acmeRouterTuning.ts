/**
 * ACME addition (ADR-0010 §5, CHG-2026-164): tuning for the smart
 * (complexity) router. Still heuristic only: tier boundaries move the score
 * cut-offs, and keyword rules force a tier when a word or phrase appears in
 * the prompt, matched literally on the gateway. Nothing here makes the
 * gateway call out.
 *
 * Shared by the console form and the server, so it imports nothing. The
 * server applies these checks again; the form only explains them.
 */

export const ROUTER_TIERS = [
  "SIMPLE",
  "MEDIUM",
  "COMPLEX",
  "REASONING",
] as const;
export type RouterTier = (typeof ROUTER_TIERS)[number];

/** Score cut-offs between tiers, each 0 to 1 and strictly increasing. */
export type TierBoundaries = {
  simpleMedium: number;
  mediumComplex: number;
  complexReasoning: number;
};

/** If any keyword appears in the prompt, the request goes to `tier`. */
export type KeywordTierRule = { keywords: string[]; tier: RouterTier };

export const MAX_KEYWORDS_PER_RULE = 50;
export const MIN_KEYWORD_LENGTH = 2;
export const MAX_KEYWORD_LENGTH = 80;

/**
 * The tuning new routers start from: config B of the 2026-10-16 check, which
 * put 9 of 10 test prompts (English and Arabic) on the expected tier on the
 * gateway's test routing, against 4 of 10 with the gateway's defaults. When
 * several rules match, the gateway uses the highest tier.
 */
export const RECOMMENDED_TIER_BOUNDARIES: TierBoundaries = {
  simpleMedium: 0.05,
  mediumComplex: 0.15,
  complexReasoning: 0.3,
};

export const RECOMMENDED_KEYWORD_RULES: KeywordTierRule[] = [
  {
    tier: "REASONING",
    keywords: [
      "خطوة بخطوة",
      "أثبت",
      "برهن",
      "حلل",
      "علل",
      "استنتج",
      "step by step",
      "prove",
    ],
  },
  {
    tier: "COMPLEX",
    keywords: [
      "قارن",
      "توصية",
      "أوصِ",
      "مخاطر",
      "مجلس الإدارة",
      "لخص",
      "استراتيجية",
      "امتثال",
      "board",
      "risk",
      "risks",
      "recommend",
      "compare",
      "compliance",
      "regulation",
      "trade-off",
      "strategy",
      "architecture",
      "summarise",
      "summarize",
    ],
  },
];

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function checkTierBoundaries(
  b: TierBoundaries,
): Checked<TierBoundaries> {
  const values = [b.simpleMedium, b.mediumComplex, b.complexReasoning];
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) {
    return { ok: false, error: "Each tier boundary must be between 0 and 1." };
  }
  if (
    !(b.simpleMedium < b.mediumComplex && b.mediumComplex < b.complexReasoning)
  ) {
    return {
      ok: false,
      error:
        "Tier boundaries must increase: simple/medium, then medium/complex, then complex/reasoning.",
    };
  }
  return {
    ok: true,
    value: {
      simpleMedium: b.simpleMedium,
      mediumComplex: b.mediumComplex,
      complexReasoning: b.complexReasoning,
    },
  };
}

// Control characters and line breaks never belong in a keyword.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Trims keywords, drops blanks and case-insensitive repeats, and refuses
 * anything the gateway would match too widely. A blank keyword would match
 * every prompt, so it is never sent. At most one rule per tier.
 */
export function checkKeywordRules(
  rules: KeywordTierRule[],
): Checked<KeywordTierRule[]> {
  const seen = new Set<RouterTier>();
  const out: KeywordTierRule[] = [];
  for (const rule of rules) {
    if (!(ROUTER_TIERS as readonly string[]).includes(rule.tier)) {
      return { ok: false, error: `"${rule.tier}" is not a router tier.` };
    }
    if (seen.has(rule.tier)) {
      return { ok: false, error: `There is more than one ${rule.tier} rule.` };
    }
    seen.add(rule.tier);
    const keywords: string[] = [];
    const folded = new Set<string>();
    for (const raw of rule.keywords) {
      const k = raw.trim();
      if (k === "") continue;
      if (CONTROL.test(k)) {
        return { ok: false, error: "Keywords can't contain line breaks." };
      }
      if (k.length < MIN_KEYWORD_LENGTH || k.length > MAX_KEYWORD_LENGTH) {
        return {
          ok: false,
          error: `Each keyword must be ${MIN_KEYWORD_LENGTH} to ${MAX_KEYWORD_LENGTH} characters ("${k.slice(0, 20)}").`,
        };
      }
      if (folded.has(k.toLowerCase())) continue;
      folded.add(k.toLowerCase());
      keywords.push(k);
    }
    if (keywords.length === 0) continue;
    if (keywords.length > MAX_KEYWORDS_PER_RULE) {
      return {
        ok: false,
        error: `A tier can have at most ${MAX_KEYWORDS_PER_RULE} keywords.`,
      };
    }
    out.push({ tier: rule.tier, keywords });
  }
  return { ok: true, value: out };
}
