"""CAIRO guardrail hook for the LiteLLM gateway (CHG-2026-014, ADR-0005).

Sends each prompt passing through the gateway to ``rayin-guardrails`` and acts on
the verdict. Loaded from the same ConfigMap as ``litellm-config.yaml``.

**Not enabled by this file.** Shipping it changes nothing until a ``guardrails:``
block references it. Enabling it in ANY mode is gated on ADR-0005 Step 0 — see
``should_skip`` below and ADR-0005-A.

Design points that are load-bearing, not stylistic:

* ``should_skip`` is a **pure function** with no imports of its own, so ADR-0005-A
  layer 1 runs without a cluster, without litellm, and without network.
* ``litellm`` is imported defensively. The module must import on a bare Python so
  the unit tests can run anywhere; the class still resolves, deriving from
  ``object`` when litellm is absent.
* Every ambiguity in ``should_skip`` resolves to **inspect**. A false skip is a
  silent hole nothing would detect. A false inspect is a loud loop, bounded by the
  judge key's rate cap and caught by the layer 3 equality assertions.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

try:  # pragma: no cover - exercised only inside the gateway image
    from litellm.integrations.custom_guardrail import CustomGuardrail as _Base

    _LITELLM_AVAILABLE = True
except Exception:  # ImportError, or a litellm too old to carry the class
    _Base = object  # type: ignore[assignment,misc]
    _LITELLM_AVAILABLE = False


GUARDRAIL_NAME = "cairo-guardrail"

#: Key-level metadata field LiteLLM itself uses for per-key guardrail opt-outs.
#: ADR-0005 F11: this is admin-configured and injected by the proxy AFTER
#: authentication. It is not caller-supplied, which is the whole reason it is the
#: discriminator (ADR-0005-A §2).
OPT_OUT_FIELD = "opted_out_global_guardrails"

#: Containers the proxy may inject authenticated key metadata into, depending on
#: endpoint. Both are checked, because a caller could otherwise shadow admin
#: config by pre-populating whichever one is not read.
_METADATA_CONTAINERS = ("metadata", "litellm_metadata")

_KEY_METADATA_FIELD = "user_api_key_metadata"
_TEAM_METADATA_FIELD = "user_api_key_team_metadata"


def _key_level_opt_outs(request_data: Dict[str, Any]) -> Optional[List[Any]]:
    """Return the KEY-level opt-out list, or None when it cannot be trusted.

    Deliberately NOT LiteLLM's ``_get_admin_metadata``:

    * that merges team-level metadata under key-level; a team-level opt-out would
      exempt every key on the team, so team metadata is ignored here entirely
      (ADR-0005-A §2, rule 1);
    * that lets the later container win outright. Here, if BOTH containers carry
      key metadata and they **disagree**, the result is untrustworthy and we
      return None, i.e. inspect. Disagreement between the two containers is the
      signature a forgery attempt would produce.
    """
    found: List[Optional[List[Any]]] = []
    for container in _METADATA_CONTAINERS:
        meta = request_data.get(container)
        if not isinstance(meta, dict):
            # A JSON *string* that never got parsed lands here and is ignored,
            # which is the inspect-safe outcome.
            continue
        key_meta = meta.get(_KEY_METADATA_FIELD)
        if not isinstance(key_meta, dict):
            continue
        value = key_meta.get(OPT_OUT_FIELD)
        found.append(value if isinstance(value, list) else None)

    if not found:
        return None
    first = found[0]
    for other in found[1:]:
        if other != first:
            return None  # containers disagree -> do not trust either -> inspect
    return first


def should_skip(request_data: Any, guardrail_name: str = GUARDRAIL_NAME) -> bool:
    """True only when THIS key is explicitly opted out of THIS guardrail.

    This is the ADR-0005 Step 0 exclusion. It runs regardless of ``default_on``,
    because LiteLLM's own opt-out is consulted only when ``default_on is True``
    (ADR-0005 F10) and therefore cannot be exercised in the safe configuration.

    Returns False — meaning *inspect* — for every ambiguity: missing metadata, a
    non-dict, an unparsed JSON string, a non-list opt-out value, a team-level-only
    opt-out, a request for a judge model on a key that is not opted out, or any
    exception raised inside this function.

    **Model identity never exempts.** A request for a judge model on an
    application key is inspected like any other. ADR-0005-A §2 records why:
    application keys carrying an unrestricted model grant can already reach the
    judge model, so a model-name check would be a live bypass.
    """
    try:
        if not isinstance(request_data, dict):
            return False
        opt_outs = _key_level_opt_outs(request_data)
        if opt_outs is None:
            return False
        return guardrail_name in opt_outs
    except Exception:
        # Never let a malformed request turn into a skip.
        return False


class CairoGuardrail(_Base):  # type: ignore[misc,valid-type]
    """Gateway-side guardrail calling ``rayin-guardrails`` ``/v1/guard``.

    ``CAIRO_GUARDRAIL_MODE`` is read at pod start: ``record`` (default) or
    ``enforce``. ADR-0005 §3b:

    ======================  ==========================  =========================
    guardrails says         record                      enforce
    ======================  ==========================  =========================
    allow                   proceed                     proceed
    block                   proceed, log would_block    refuse
    redact                  proceed, original text      return redacted text
    timeout / 5xx / down    proceed, guard_unavailable  refuse (fail closed)
    ======================  ==========================  =========================

    ``enforce`` must not be selected until every ADR-0005 §5 Step 4 gate holds.
    Nothing in this file relaxes those gates.
    """

    def __init__(self, **kwargs: Any) -> None:
        name = kwargs.pop("guardrail_name", None) or GUARDRAIL_NAME
        if _LITELLM_AVAILABLE:
            # Pass the name DOWN so litellm's own machinery agrees with ours.
            super().__init__(guardrail_name=name, **kwargs)
        # Assigned AFTER super() deliberately. CustomGuardrail.__init__ sets
        # self.guardrail_name from its own parameter, so assigning ours first
        # leaves it None -- and should_skip(data, None) returns False for every
        # request, silently turning the Step 0 exclusion into a no-op and putting
        # the judge path straight back into the F10 loop. Caught by layer 1
        # (test_guardrail_name_survives_construction); do not reorder.
        self.guardrail_name = name
        self.mode = os.environ.get("CAIRO_GUARDRAIL_MODE", "record").strip().lower()
        self.guard_url = os.environ.get(
            "CAIRO_GUARDRAIL_URL", "http://rayin-guardrails.rayin-platform:8080/v1/guard"
        )
        # One explicit timeout on the gateway -> guardrails call. ADR-0005 F2: a
        # gateway-side timeout is necessary but not sufficient; guardrails needs
        # its own, shorter one so the inner call cannot outlive the outer.
        self.timeout_s = float(os.environ.get("CAIRO_GUARDRAIL_TIMEOUT_S", "10"))

    def _is_enforcing(self) -> bool:
        return self.mode == "enforce"

    async def apply_guardrail(
        self,
        inputs: Any,
        request_data: Optional[Dict[str, Any]] = None,
        input_type: str = "request",
        logging_obj: Any = None,
    ) -> Any:
        """Single entry point for both directions.

        ``input_type`` maps onto ``/v1/guard``'s ``direction``:
        ``request`` -> ``input``, ``response`` -> ``output``.
        """
        data = request_data or {}

        # ADR-0005 Step 0. First thing, before any work: if this key is excluded,
        # return untouched. This is what stops the rail's own judge call from
        # re-entering the guardrail and looping.
        if should_skip(data, self.guardrail_name):
            return inputs

        # Deliberately unimplemented in this change. Shipping the exclusion and
        # its tests is Step 0; calling /v1/guard is Step 1's next commit, and it
        # does not land until layer 1 is green and the judge key carries its
        # opt-out, allowlist and rate cap.
        raise NotImplementedError(
            "CairoGuardrail verdict path is not implemented yet: ADR-0005 Step 1. "
            "This module currently ships the Step 0 exclusion and its unit tests "
            "only, and is not referenced by any guardrails: block."
        )
