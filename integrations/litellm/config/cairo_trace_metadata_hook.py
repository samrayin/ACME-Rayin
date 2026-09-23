"""CAIRO trace-metadata allowlist hook for the LiteLLM gateway (CHG-2026-028, ADR-0006 §11).

Strips caller-controlled Langfuse trace/generation metadata that
``turn_off_message_logging`` does not guard — confirmed by source inspection of
``litellm/integrations/langfuse/langfuse.py`` (ADR-0006 §11's exhaustive audit), not
assumed. Two findings drove the design: ``metadata.prompt`` writes arbitrary caller
text directly into a generation's ``prompt`` field (a content leak, not a label
leak), and any ``trace_``-prefixed metadata key promotes verbatim into the trace
(an unbounded wildcard a fixed denylist cannot close).

**Not enabled by this file.** Shipping it changes nothing until a ``callbacks:``
block in ``litellm-config.yaml`` references it, and CHG-2026-028 does not add that
block — ADR-0006 stays Proposed until this hook is built AND verified, and even
then enablement of the Langfuse callback itself (CHG-2026-026) is a separate,
owner-gated change.

Design points that are load-bearing, not stylistic:

* ``strip_untrusted_trace_metadata`` is a **pure function** taking and returning a
  plain dict, no imports of its own, so it runs without a cluster, without litellm,
  and without network — same reasoning as ``cairo_guardrail_hook.py``'s
  ``should_skip``.
* The mitigation is an **allowlist, not a denylist**, for the ``trace_`` namespace
  specifically: ``TRACE_PREFIX_ALLOWLIST`` starts empty. A denylist cannot close an
  unbounded wildcard — a caller can always mint a ``trace_`` key the list doesn't
  name yet. Permit specific keys only on demonstrated need; do not pre-populate
  this set speculatively.
* Both metadata containers (``metadata``, ``litellm_metadata``) are stripped,
  mirroring ``cairo_guardrail_hook.py``'s own two-container check: a caller could
  otherwise shadow the strip by populating whichever container is not checked.
* Both input channels are stripped: the request body's metadata dicts, and any
  HTTP header prefixed ``langfuse_`` (``litellm``'s own
  ``LangFuseLogger.add_metadata_from_header`` reads these and overwrites the same
  key in the body's metadata — stripping only the body leaves this channel wide
  open). Header names are matched case-insensitively; body keys are matched
  case-sensitively, matching ``langfuse.py``'s own ``key.startswith("trace_")``
  check.
* Explicitly **not** addressed here, per ADR-0006 §11: bare ``version``,
  ``requester_metadata``, ``tags``/``request_tags``, ``hidden_params.cache_key``.
  Lower severity, not in the owner's scoped decision — do not fold them in.
"""

from __future__ import annotations

from typing import Any, Dict

try:  # pragma: no cover - exercised only inside the gateway image
    from litellm.integrations.custom_logger import CustomLogger as _Base

    _LITELLM_AVAILABLE = True
except Exception:  # ImportError, or a litellm too old to carry the class
    _Base = object  # type: ignore[assignment,misc]
    _LITELLM_AVAILABLE = False


HOOK_NAME = "cairo-trace-metadata-allowlist"

#: Prefix identifying LiteLLM's Langfuse trace-control namespace
#: (``langfuse.py:669-670``: any key matching this is promoted verbatim into
#: ``trace_params``, unbounded). ADR-0006 §11 item 1.
TRACE_PREFIX = "trace_"

#: Keys in the ``trace_`` namespace permitted through, by name. Starts empty —
#: "permit none, add only on evidence of need" (owner decision, ADR-0006 §11).
TRACE_PREFIX_ALLOWLIST: frozenset[str] = frozenset()

#: Named keys stripped unconditionally, regardless of the ``trace_`` prefix rule.
#: ``prompt`` and ``debug_langfuse`` are ADR-0006 §11 items 2 and 3. The four
#: identifier-adjacent fields are item 5 (``existing_trace_id``, ``generation_id``,
#: ``parent_observation_id`` do not match the ``trace_`` prefix and need explicit
#: listing; ``trace_id`` is included here too for defense-in-depth even though the
#: prefix rule already catches it). ``session_id``, ``generation_name``, and
#: ``user_api_key_end_user_id`` are the three original fields from the first pass,
#: carried forward — superseded in scope, not in conclusion.
UNCONDITIONAL_STRIP_KEYS: frozenset[str] = frozenset(
    {
        "prompt",
        "debug_langfuse",
        "trace_id",
        "existing_trace_id",
        "generation_id",
        "parent_observation_id",
        "session_id",
        "generation_name",
        "user_api_key_end_user_id",
    }
)

#: Keys kept in ``requester_metadata``, LiteLLM's copy of what the CALLER sent
#: (body metadata plus its request headers under ``headers``). The Langfuse OTLP
#: logger writes that whole sub-object into every trace, so any key a caller adds
#: there is caller free text in the trace (ADR-0006 §13 residuals). Starts empty:
#: permit a key only on demonstrated need (CHG-2026-054). Gateway-written fields
#: (key alias, team, spend) live elsewhere in metadata and are untouched.
REQUESTER_METADATA_ALLOWLIST: frozenset[str] = frozenset()

#: Containers the proxy may put request metadata into, depending on endpoint.
#: Both are checked — same reasoning as ``cairo_guardrail_hook.py``'s
#: ``_METADATA_CONTAINERS``.
_METADATA_CONTAINERS = ("metadata", "litellm_metadata")

#: HTTP header prefix LiteLLM's Langfuse integration reads and merges into
#: metadata, overwriting the same-named body key (``add_metadata_from_header``).
_HEADER_PREFIX = "langfuse_"


def _is_stripped_key(key: Any) -> bool:
    """True if ``key`` (a logical metadata key name) must be removed.

    Applies to both the body metadata containers directly, and to header-derived
    logical keys (a header ``langfuse_trace_id`` maps to the logical key
    ``trace_id``) — one decision function, two call sites, so the two channels can
    never silently diverge.
    """
    if not isinstance(key, str):
        return False
    if key in UNCONDITIONAL_STRIP_KEYS:
        return True
    if key.startswith(TRACE_PREFIX) and key not in TRACE_PREFIX_ALLOWLIST:
        return True
    return False


def _strip_metadata_dict(meta: Any) -> None:
    """Remove every stripped key from ``meta`` in place. No-op if not a dict."""
    if not isinstance(meta, dict):
        return
    for key in [k for k in list(meta.keys()) if _is_stripped_key(k)]:
        meta.pop(key, None)


def _allowlist_requester_metadata(requester_metadata: Any) -> None:
    """Keep only ``REQUESTER_METADATA_ALLOWLIST`` keys, in place (CHG-2026-054).

    A full allowlist, not a strip list: the caller controls every key here,
    including request headers under ``headers``, so anything not named is removed.
    No-op if not a dict.
    """
    if not isinstance(requester_metadata, dict):
        return
    for key in [k for k in list(requester_metadata.keys()) if k not in REQUESTER_METADATA_ALLOWLIST]:
        requester_metadata.pop(key, None)


def _strip_langfuse_headers(headers: Any) -> None:
    """Remove every ``langfuse_``-prefixed header whose logical key is stripped.

    Case-insensitive on the header name (HTTP header names are conventionally
    case-insensitive; the container itself may or may not normalise case, so this
    does not rely on it having done so).
    """
    if not isinstance(headers, dict):
        return
    for header_key in [k for k in list(headers.keys()) if isinstance(k, str)]:
        lowered = header_key.lower()
        if not lowered.startswith(_HEADER_PREFIX):
            continue
        logical_key = lowered[len(_HEADER_PREFIX) :]
        if _is_stripped_key(logical_key):
            headers.pop(header_key, None)


def strip_untrusted_trace_metadata(request_data: Any) -> Any:
    """Strip untrusted trace/generation metadata from a request, in place.

    Mutates and returns ``request_data`` unchanged in shape — matches
    ``CustomLogger.async_pre_call_hook``'s contract ("return a modified dictionary
    for passing into litellm"). Safe to call on anything: a non-dict is returned
    untouched, exactly like the guardrail hook's ``should_skip`` never raises on a
    malformed request.

    Covers, per ADR-0006 §11's scoped decision:

    1. Both metadata containers (``metadata``, ``litellm_metadata``).
    2. The ``langfuse_``-prefixed HTTP header channel, via
       ``request_data["proxy_server_request"]["headers"]`` — present by the time
       ``async_pre_call_hook`` runs, per ``litellm_pre_call_utils.py``'s own
       construction order (populated during ``add_litellm_data_to_request``, which
       runs before any registered pre-call hook).
    """
    if not isinstance(request_data, dict):
        return request_data

    for container in _METADATA_CONTAINERS:
        meta = request_data.get(container)
        _strip_metadata_dict(meta)
        # LiteLLM copies the caller's metadata into ``requester_metadata`` and the
        # Langfuse logger nests that whole sub-object into the generation. If the
        # copy was taken before this hook ran, a stripped key (``prompt``) would
        # survive inside it, so strip there too (CHG-2026-026).
        if isinstance(meta, dict):
            _allowlist_requester_metadata(meta.get("requester_metadata"))

    proxy_server_request = request_data.get("proxy_server_request")
    if isinstance(proxy_server_request, dict):
        _strip_langfuse_headers(proxy_server_request.get("headers"))

    return request_data


class CairoTraceMetadataAllowlistHook(_Base):  # type: ignore[misc,valid-type]
    """Gateway-side pre-call hook applying ``strip_untrusted_trace_metadata``.

    No configuration, no environment variables, no mode switch — unconditional by
    design (ADR-0006 §11: a caller-triggered exception or per-key opt-out would
    recreate exactly the gap this hook exists to close). Referencing this class
    from ``litellm-config.yaml`` is a separate, owner-gated change (CHG-2026-028's
    scope is the hook and its tests only).
    """

    async def async_pre_call_hook(
        self,
        user_api_key_dict: Any,
        cache: Any,
        data: Dict[str, Any],
        call_type: Any,
    ) -> Dict[str, Any]:
        return strip_untrusted_trace_metadata(data)


#: What ``litellm_settings.callbacks`` references (``cairo_trace_metadata_hook.proxy_handler_instance``).
#: LiteLLM resolves a callback path to an object and uses it as-is, so it must be an
#: instance, not the class (CHG-2026-026).
proxy_handler_instance = CairoTraceMetadataAllowlistHook()
