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

Step 1 (the verdict path) keeps the same shape, for the same reason: the parts
that decide anything are **pure functions** — ``extract_text``,
``build_guard_payload``, ``decide`` — so the whole decision table is provable on a
bare Python with no network. Only ``_post_guard`` does I/O, and it is a thin,
overridable seam; the tests substitute it rather than mocking a HTTP library.

Where Step 1's ambiguities resolve, and why it is the mirror image of Step 0:

* In **record** mode every failure resolves to **proceed** — an unreachable
  guardrails service, a malformed verdict, a payload we could not build, a missing
  secret, ``httpx`` absent from the image. Record mode's contract is "change
  nothing, write down what would have happened"; a record-mode hook that can fail
  a request has broken that contract, not enforced anything.
* In **enforce** mode those same failures resolve to **refuse** (fail closed,
  ADR-0005 §3b). Enforce is unreachable until every ADR-0005 §5 Step 4 gate holds.

**Input shape, confirmed live 2026-09-23 (CHG-2026-044).** LiteLLM 1.100.1 does
not pass messages. Its unified guardrail layer passes ``GenericGuardrailAPIInputs``,
a dict ``{"texts": [...]}``, and expects the same shape back. The first switch-on
proved the earlier assumption wrong: every request recorded ``guard_unreadable``
and nothing was inspected. ``extract_text`` still reads the older shapes and still
returns None for anything unrecognised, which is a record-mode proceed.

**The mode comes from CAIRO, within a ceiling (ADR-0005-B part b, CHG-2026-089).**
Since part b the mode is no longer read once at pod start. Each verdict carries
the CAIRO settings version and mode it was decided under, and each gateway
replica keeps the newest it has seen (``ModeTracker``), bounded by the
deployment ceiling ``CAIRO_GUARDRAIL_MODE_MAX``. The rules are pure functions
here too: ``read_ceiling``, ``settings_labels``, ``ModeTracker`` and
``decision_mode``. See ``CairoGuardrail`` for the table.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, NamedTuple, Optional, Tuple

try:  # pragma: no cover - exercised only inside the gateway image
    from litellm.integrations.custom_guardrail import CustomGuardrail as _Base

    _LITELLM_AVAILABLE = True
except Exception:  # ImportError, or a litellm too old to carry the class
    _Base = object  # type: ignore[assignment,misc]
    _LITELLM_AVAILABLE = False

try:  # pragma: no cover - same reason: absent on a bare Python, present in-image
    import httpx

    _HTTPX_AVAILABLE = True
except Exception:
    httpx = None  # type: ignore[assignment]
    _HTTPX_AVAILABLE = False


log = logging.getLogger("cairo.guardrail")


def _ensure_health_output(logger: logging.Logger) -> None:
    """Make INFO lines on ``logger`` reach stdout whatever the host configured.

    The gateway does not print INFO from third-party loggers, so on the first
    switch-on the health record (CHG-2026-041) was silently dropped (CHG-2026-044).
    Idempotent: called at import and again at construction, because the proxy may
    reconfigure logging in between.
    """
    if not any(getattr(h, "_cairo_health", False) for h in logger.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        handler._cairo_health = True  # type: ignore[attr-defined]
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    logger.disabled = False


_ensure_health_output(log)

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

#: Environment variable carrying the guardrails service's shared secret. The
#: service requires it on EVERY /v1/guard call and fails closed when its own copy
#: is unset ("reject every request", rayin-guardrails app/settings.py), so a
#: gateway without this value gets 401s, not silent passes. It is NOT in the
#: gateway's Secret today -- adding it is an owner-gated step before enabling.
GUARD_SECRET_ENV = "CAIRO_GUARDRAIL_SECRET"

#: Header the guardrails service reads the shared secret from.
GUARD_SECRET_HEADER = "x-config-secret"

#: LiteLLM's ``input_type`` -> the service's ``direction``. Anything unrecognised
#: is treated as unknown rather than guessed at; see build_guard_payload.
_DIRECTION_BY_INPUT_TYPE = {"request": "input", "response": "output"}

#: Authenticated, proxy-injected fields that can identify the calling
#: application, best first. Deliberately excludes anything caller-supplied: this
#: lands in an audit record, so a forgeable value would poison the evidence.
_AGENT_ID_FIELDS = (
    "user_api_key_alias",
    "user_api_key_team_alias",
    "user_api_key_team_id",
    "user_api_key_hash",
)

#: Used when no authenticated identifier is present. A constant, not a guess: the
#: audit row should say "we do not know" rather than name the wrong application.
UNKNOWN_AGENT_ID = "unknown-agent"

#: The two modes (ADR-0005-B). Anything else is not a mode.
MODES = ("record", "enforce")

#: The deployment ceiling (ADR-0005-B §3.3, owner decision D-B3). ``enforce``
#: allows the console's enforce to take effect; unset or anything else means
#: record, whatever the console says.
CEILING_ENV = "CAIRO_GUARDRAIL_MODE_MAX"

#: Read as the ceiling when CEILING_ENV is unset, for compatibility (§3.3).
LEGACY_MODE_ENV = "CAIRO_GUARDRAIL_MODE"

#: Where this replica's pod name comes from. Kubernetes sets HOSTNAME to the
#: pod name; POD_NAME is honoured first if a manifest sets it explicitly.
_POD_NAME_ENVS = ("POD_NAME", "HOSTNAME")

#: CAIRO's bounds for a pod name (its POD_NAME_PATTERN) and a settings version.
_POD_NAME_PATTERN = re.compile(r"^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$")
MAX_SETTINGS_VERSION = 2147483647

#: rayin-guardrails' explicit "no verdict" answer when the judge model could
#: not be asked (Readiness Ledger N-64): HTTP 503 with this verdict and reason.
NO_VERDICT = "none"
JUDGE_UNAVAILABLE = "judge_unavailable"


def read_ceiling(environ: Optional[Mapping[str, str]] = None) -> str:
    """The deployment ceiling: ``enforce`` only when set to exactly that.

    ``CAIRO_GUARDRAIL_MODE_MAX`` wins; when it is unset or blank, the older
    ``CAIRO_GUARDRAIL_MODE`` is read as the ceiling. Every other value, a typo
    included, means record: a ceiling that cannot be read must not allow
    enforce.
    """
    env = os.environ if environ is None else environ
    raw = env.get(CEILING_ENV)
    if raw is None or not str(raw).strip():
        raw = env.get(LEGACY_MODE_ENV, "")
    return "enforce" if str(raw).strip().lower() == "enforce" else "record"


def gateway_pod_name(environ: Optional[Mapping[str, str]] = None) -> Optional[str]:
    """This replica's pod name as CAIRO accepts it, or None."""
    env = os.environ if environ is None else environ
    for name in _POD_NAME_ENVS:
        raw = env.get(name)
        if isinstance(raw, str):
            candidate = raw.strip().lower()
            if _POD_NAME_PATTERN.fullmatch(candidate):
                return candidate
    return None


def _parse_utc(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


Labels = Tuple[int, str, Optional[datetime]]


def settings_labels(answer: Any) -> Optional[Labels]:
    """``(version, mode, revert_at)`` from a verdict or a no-verdict answer,
    or None when they cannot set the mode.

    Only an answer whose settings are ``applied``, with a version in range and
    a known mode, can (§3.3). Settings unknown, a missing or malformed field,
    or an older rayin-guardrails that sends no labels: None. ``revert_at``
    counts on an enforce answer only.
    """
    try:
        if not isinstance(answer, dict) or answer.get("settings_status") != "applied":
            return None
        version = answer.get("settings_version")
        mode = answer.get("mode")
        if not isinstance(version, int) or isinstance(version, bool):
            return None
        if not 1 <= version <= MAX_SETTINGS_VERSION or mode not in MODES:
            return None
        revert_at = _parse_utc(answer.get("revert_at")) if mode == "enforce" else None
        return version, mode, revert_at
    except Exception:
        return None


class ModeTracker:
    """One gateway replica's view of the console's mode (ADR-0005-B §3.3).

    In-process and per replica: a restart forgets it, and the ceiling then
    decides until a usable answer arrives.

    * **Versions only move forward.** A newer version sets the mode. An older
      one is a stale guardrails pod and is ignored, so it cannot lower the mode.
    * **At the same version, only enforce -> record.** CAIRO and the guardrails
      pods report an enforce trial past its switch-back time as record *at the
      same version number*, until the automatic version is written. That is
      the one legitimate same-version change. The reverse, record -> enforce
      at one version, can only come from a pod that pulled before the trial
      ended, so it is ignored (SF-2026-024's open case, now defined).
    * **A trial ends on time here too.** An enforce mode with a switch-back time
      reads as record from that time, even if no answer arrives at all.
    """

    def __init__(self) -> None:
        self.version: Optional[int] = None
        self.mode: Optional[str] = None
        self.revert_at: Optional[datetime] = None

    def observe(self, labels: Optional[Labels]) -> bool:
        """Take an answer's labels. True when they are current (not stale or
        unusable), so the answer can be acted on in enforce mode."""
        if labels is None:
            return False
        version, mode, revert_at = labels
        if self.version is None or version > self.version:
            self.version, self.mode, self.revert_at = version, mode, revert_at
            return True
        if version < self.version:
            return False
        if mode == "record" and self.mode == "enforce":
            self.mode, self.revert_at = "record", None
        elif mode == "enforce" and self.mode == "enforce" and self.revert_at is None:
            # The same trial, now with its switch-back time (an older pod sent
            # none). The time belongs to the version, so adopting it is safe.
            self.revert_at = revert_at
        return True

    def desired(self, now: Optional[datetime] = None) -> Optional[str]:
        """The console's mode as this replica knows it, or None if no usable
        answer has arrived since the replica started."""
        if self.mode == "enforce" and self.revert_at is not None:
            if (now or datetime.now(timezone.utc)) >= self.revert_at:
                return "record"
        return self.mode


def decision_mode(ceiling: str, desired: Optional[str]) -> str:
    """The mode a request is decided in (ADR-0005-B §3.3).

    The ceiling bounds it. With no mode seen since the replica started, the
    ceiling decides: an unknown state under an enforce allowance fails closed.
    """
    if ceiling != "enforce":
        return "record"
    if desired is None:
        return "enforce"
    return desired


def is_judge_unavailable(answer: Any) -> bool:
    """rayin-guardrails' explicit "no verdict: judge unavailable" answer."""
    return (
        isinstance(answer, dict)
        and answer.get("verdict") == NO_VERDICT
        and answer.get("reason") == JUDGE_UNAVAILABLE
    )


class GuardOutcome(NamedTuple):
    """What the caller should do, and what to write down about it.

    ``text`` is None whenever the original input passes through untouched; it
    carries a replacement only for an enforced redaction.
    """

    proceed: bool
    text: Optional[str]
    event: str


def extract_text(inputs: Any) -> Optional[str]:
    """Best-effort text of what is being checked, or None when unknown.

    Handles the shapes LiteLLM is documented to pass: a plain string, a list of
    message dicts (OpenAI style), or a single message dict. Content parts (a list
    of ``{"type": "text", "text": ...}``) are flattened, because a multimodal
    message would otherwise stringify into something the rails cannot read.

    None means "could not read this", which is a record-mode proceed. It is
    deliberately not an exception: an input shape we have not seen must not be
    able to fail a request in the mode whose contract is to change nothing.
    """
    try:
        if isinstance(inputs, str):
            return inputs or None
        if isinstance(inputs, dict) and "texts" in inputs:
            texts = inputs.get("texts")
            if not isinstance(texts, (list, tuple)):
                return None
            joined = "\n".join(t for t in texts if isinstance(t, str) and t)
            return joined or None
        if isinstance(inputs, dict):
            return _text_of_message(inputs)
        if isinstance(inputs, (list, tuple)):
            parts = [_text_of_message(m) for m in inputs]
            joined = "\n".join(p for p in parts if p)
            return joined or None
        return None
    except Exception:
        return None


def _text_of_message(message: Any) -> Optional[str]:
    """Text of one message, flattening OpenAI-style content parts."""
    if isinstance(message, str):
        return message or None
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    if isinstance(content, str):
        return content or None
    if isinstance(content, (list, tuple)):
        chunks = []
        for part in content:
            if isinstance(part, str):
                chunks.append(part)
            elif isinstance(part, dict):
                value = part.get("text")
                if isinstance(value, str):
                    chunks.append(value)
        joined = "\n".join(c for c in chunks if c)
        return joined or None
    return None


def _authenticated_agent_id(request_data: Dict[str, Any]) -> str:
    """Identify the calling application from proxy-injected metadata only."""
    for container in _METADATA_CONTAINERS:
        meta = request_data.get(container)
        if not isinstance(meta, dict):
            continue
        for field in _AGENT_ID_FIELDS:
            value = meta.get(field)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return UNKNOWN_AGENT_ID


def build_guard_payload(
    inputs: Any,
    request_data: Any,
    input_type: str,
) -> Optional[Dict[str, Any]]:
    """The /v1/guard request body, or None when one cannot honestly be built.

    None is returned when the text is unreadable or the direction is unrecognised
    -- never a payload with an invented field. The service requires non-empty
    ``text`` and a valid ``direction``; sending a placeholder would produce an
    audit row asserting something we did not check.
    """
    try:
        direction = _DIRECTION_BY_INPUT_TYPE.get(input_type)
        if direction is None:
            return None
        text = extract_text(inputs)
        if not text:
            return None
        data = request_data if isinstance(request_data, dict) else {}
        payload: Dict[str, Any] = {
            "agent_id": _authenticated_agent_id(data),
            "direction": direction,
            "text": text,
        }
        # Correlation, when the proxy gives us one. Absent is fine; wrong is not.
        for source, field in (("litellm_call_id", "trace_id"),):
            value = data.get(source)
            if isinstance(value, str) and value.strip():
                payload[field] = value.strip()
        return payload
    except Exception:
        return None


def decide(verdict: Any, enforcing: bool) -> GuardOutcome:
    """ADR-0005 §3b's table, as a pure function.

    ====================  ==========================  =========================
    guardrails says       record                      enforce
    ====================  ==========================  =========================
    allow                 proceed                     proceed
    block                 proceed, would_block        refuse
    redact                proceed, original text      return redacted text
    unavailable/garbled   proceed, guard_unavailable  refuse (fail closed)
    ====================  ==========================  =========================

    ``verdict`` of None means the call did not produce a usable answer, for any
    reason: timeout, connection refused, non-2xx, unparseable body, httpx absent,
    secret missing. They collapse deliberately -- the hook's response to "I do not
    know what the guardrails think" must not depend on why it does not know.
    """
    if not isinstance(verdict, dict):
        return GuardOutcome(not enforcing, None, "guard_unavailable")

    action = verdict.get("action")
    if action == "allow":
        return GuardOutcome(True, None, "allow")
    if action == "block":
        return GuardOutcome(not enforcing, None, "blocked" if enforcing else "would_block")
    if action == "redact":
        redacted = verdict.get("redacted_text")
        if not isinstance(redacted, str) or not redacted:
            # Claims a redaction but carries no text: unusable, not "allow".
            return GuardOutcome(not enforcing, None, "guard_unavailable")
        if enforcing:
            return GuardOutcome(True, redacted, "redacted")
        return GuardOutcome(True, None, "would_redact")
    # An action this hook does not know. Newer service, older hook: do not guess.
    return GuardOutcome(not enforcing, None, "guard_unavailable")


#: Marker every health line carries, so an operator can select exactly these
#: lines out of the gateway's stdout without matching on prose that may change.
HEALTH_LOG_EVENT = "cairo_guardrail_health"


def build_health_log(
    outcome: str,
    mode: str,
    duration_ms: Optional[float],
    called: bool,
    guardrail_name: str = GUARDRAIL_NAME,
    payload: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
    ceiling: Optional[str] = None,
    settings_version: Optional[int] = None,
    refused: Optional[bool] = None,
) -> Dict[str, Any]:
    """The health record for one hook invocation, as a flat JSON-able dict.

    **Interim by design (CHG-2026-041).** This is the bridge that makes record
    mode measurable before ADR-0009's durable capability exists. The two figures
    CHG-2026-039 identified as otherwise unrecoverable -- the
    ``guard_unavailable`` count and the round-trip duration -- are both here.

    Field names are deliberately the ones ADR-0009's table is expected to use,
    so the eventual migration reads these lines rather than redefining them. A
    log line is not a durable record and this does not pretend otherwise: pod
    stdout is lost on restart unless something collects it. It is strictly more
    than exists today, which is nothing.

    ``duration_ms`` is None when no call was made (an excluded key, or a payload
    that could not be built) -- distinct from 0, which would claim an
    instantaneous call that never happened. ``called`` disambiguates the two
    without the reader having to infer it from a null.
    """
    stamp = (now or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")
    record: Dict[str, Any] = {
        "event": HEALTH_LOG_EVENT,
        "ts": stamp,
        "guardrail": guardrail_name,
        "mode": mode,
        "outcome": outcome,
        "called": called,
        "duration_ms": round(duration_ms, 1) if duration_ms is not None else None,
    }
    # ADR-0005-B part b: the mode above is the one this request was decided
    # in. The ceiling and the newest settings version this replica has seen
    # explain it; refused says whether the request was stopped.
    if ceiling is not None:
        record["ceiling"] = ceiling
    if settings_version is not None:
        record["settings_version"] = settings_version
    if refused is not None:
        record["refused"] = refused
    # Correlation to the originating request, when the proxy supplied one. Same
    # field AcmeLitellmRequestLog already keys on, so the two can be joined
    # without inventing a new identifier.
    if isinstance(payload, dict):
        for field in ("direction", "agent_id"):
            value = payload.get(field)
            if isinstance(value, str) and value:
                record[field] = value
        call_id = payload.get("trace_id")
        if isinstance(call_id, str) and call_id:
            record["litellm_call_id"] = call_id
    return record


class CairoGuardrailBlocked(Exception):
    """Raised to refuse a request in enforce mode.

    Defined here rather than reusing a litellm exception so the module keeps
    importing on a bare Python, and so the refusal is attributable to this hook
    in a gateway log rather than to the proxy's own machinery.
    """


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

    **The mode** (ADR-0005-B §3.3, CHG-2026-089 part b). The console stores it;
    every verdict carries it with its settings version; ``ModeTracker`` keeps
    the newest per replica; ``CAIRO_GUARDRAIL_MODE_MAX`` (default ``record``;
    the older ``CAIRO_GUARDRAIL_MODE`` is read in its place when unset) is the
    ceiling. ``decision_mode`` combines them for each request.

    ==========================  ==========================  =========================
    guardrails answers          decided in record           decided in enforce
    ==========================  ==========================  =========================
    allow                       proceed                     proceed
    block                       proceed, log would_block    refuse
    redact                      proceed, original text      return redacted text
    no verdict: judge           proceed, log                refuse, judge_unavailable
    unavailable (HTTP 503)      judge_unavailable
    verdict, settings unknown   as its action says          refuse, settings_unusable
    or stale
    timeout / 5xx / down        proceed, guard_unavailable  refuse (fail closed)
    ==========================  ==========================  =========================

    **Judge unavailable** (Readiness Ledger N-64; owner decision 2026-10-02).
    rayin-guardrails answers HTTP 503 ``{"verdict": "none", "reason":
    "judge_unavailable"}`` when its judge model could not be asked, for
    example for its rate limit. Record mode proceeds and logs the outcome
    ``judge_unavailable``. Enforce mode refuses, with that outcome code and a
    message saying the request could not be checked: proceeding would let
    anyone bypass the jailbreak check by saturating the judge. The fix for
    refusals of this kind is judge capacity, never relaxing this rule.
    rayin-guardrails records every such case as an event with action
    ``unavailable``, in both modes.

    **Settings unknown or stale.** A verdict from a guardrails pod that has
    not pulled CAIRO's settings, or that is on an older version than this
    replica has seen, cannot set the mode. In enforce it is treated like a
    missing verdict and refused (``settings_unusable``), so neither an
    unsynced pod nor a stale one can let a request through on a policy CAIRO
    did not set (§3.3, tests B10 and B11).

    **What this replica reports.** Each call sends ``gateway_pod``,
    ``gateway_mode`` (the mode this replica was in when it called) and
    ``gateway_settings_version``. rayin-guardrails passes them to the audit
    event, so the console can show each replica's last seen mode (build
    decision C1).

    Enforce takes effect only with the ceiling at ``enforce`` and the console
    at enforce. Neither may be set until the owner's preconditions hold:
    ADR-0005 §5 Step 4, Readiness Ledger N-64, N-59's re-confirmation and
    SF-2026-015. Nothing in this file relaxes them.
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
        # ADR-0005-B §3.3: the ceiling is read at start; the mode comes from
        # the verdicts, through the tracker.
        self.ceiling = read_ceiling()
        self.tracker = ModeTracker()
        self.pod_name = gateway_pod_name()
        # The settings version last warned about, so "enforce requested but
        # not allowed" is logged once per version, not once per request.
        self._ceiling_warned_version: Optional[int] = None
        self.guard_url = os.environ.get(
            "CAIRO_GUARDRAIL_URL", "http://rayin-guardrails.rayin-platform:8080/v1/guard"
        )
        # One explicit timeout on the gateway -> guardrails call. ADR-0005 F2: a
        # gateway-side timeout is necessary but not sufficient; guardrails needs
        # its own, shorter one so the inner call cannot outlive the outer. That
        # inner timeout does NOT exist yet (F2 is open), so today a fired
        # timeout here leaves the guardrails pod still working on the abandoned
        # call. Bounding the gateway is still worth doing; it is not the whole
        # of F2.
        #
        # 2 seconds, decided 2026-09-23 (CHG-2026-038, ADR-0005 §3b addendum).
        # ADR-0005 required "an explicit short timeout" and never fixed a value;
        # 10 was this file's own default, and 10s of added latency per request
        # during a guardrails outage is not "short" for a mode whose contract is
        # to change nothing. Not fire-and-forget: that would drop the
        # `would_block` signal precisely on slow responses, and measuring what
        # would have happened is the entire purpose of record mode.
        #
        # 2 rather than 1, on the measured distribution: post-fix p50 is 470ms
        # (CHG-2026-016) and no p95 exists. `block` verdicts can only come from
        # the judge/LLM path -- Presidio short-circuits and returns `redact`
        # before the rail runs (ADR-0005 F7) -- so the slow tail is exactly
        # where the signal lives. 1s is ~2x p50 and would systematically drop
        # it; 2s is ~4x, still a hard cap.
        self.timeout_s = float(os.environ.get("CAIRO_GUARDRAIL_TIMEOUT_S", "2"))
        # Read once at construction. Absent means every call 401s, so it is
        # treated as unavailable rather than attempted -- see _post_guard.
        self.guard_secret = os.environ.get(GUARD_SECRET_ENV, "").strip()
        _ensure_health_output(log)

    def current_mode(self) -> str:
        """The mode the next request would be decided in.

        A method, not an attribute named ``mode``: LiteLLM's guardrail
        configuration uses ``mode`` for the hook's event type, so this class
        must not claim that name.
        """
        return decision_mode(self.ceiling, self.tracker.desired())

    def _gateway_state(self, mode: str) -> Dict[str, Any]:
        """What this replica reports with each call (build decision C1)."""
        state: Dict[str, Any] = {"gateway_mode": mode}
        if self.pod_name:
            state["gateway_pod"] = self.pod_name
        if self.tracker.version is not None:
            state["gateway_settings_version"] = self.tracker.version
        return state

    def _warn_if_capped(self, labels: Optional[Labels]) -> None:
        """Log once per version when the console asks for enforce and the
        ceiling does not allow it (§3.3)."""
        if labels is None or self.ceiling == "enforce":
            return
        version, mode, _ = labels
        if mode == "enforce" and self._ceiling_warned_version != version:
            self._ceiling_warned_version = version
            log.warning(
                "cairo_guardrail: the console asks for enforce (settings version %s), "
                "but %s is not enforce; recording only",
                version,
                CEILING_ENV,
            )

    def judge(self, answer: Any) -> Tuple[GuardOutcome, str]:
        """Decide one answer: take its labels, then apply the table.

        Pure apart from updating this replica's tracker. Returns the outcome
        and the mode it was decided in.
        """
        labels = settings_labels(answer)
        current = self.tracker.observe(labels)
        self._warn_if_capped(labels)
        mode = decision_mode(self.ceiling, self.tracker.desired())
        enforcing = mode == "enforce"
        if is_judge_unavailable(answer):
            return GuardOutcome(not enforcing, None, JUDGE_UNAVAILABLE), mode
        if enforcing and isinstance(answer, dict) and "action" in answer and not current:
            return GuardOutcome(False, None, "settings_unusable"), mode
        return decide(answer, enforcing), mode

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
        #
        # Recorded rather than returned silently (CHG-2026-041). ADR-0005-A
        # layer 3 has to verify live that the exclusion actually fires for the
        # judge key and for nothing else; a silent return leaves that
        # unobservable, and "no loop happened" is indistinguishable from "the
        # hook never ran". `called: false` keeps these out of the latency and
        # availability figures, which are about calls that were made.
        if should_skip(data, self.guardrail_name):
            return self._resolve(
                GuardOutcome(True, None, "excluded"),
                inputs,
                mode=self.current_mode(),
                duration_ms=None,
                called=False,
                payload={"agent_id": _authenticated_agent_id(data)},
            )

        mode_before = self.current_mode()
        payload = build_guard_payload(inputs, data, input_type)
        if payload is None:
            # Nothing honest to ask. Record: proceed. Enforce: fail closed.
            return self._resolve(
                GuardOutcome(mode_before != "enforce", None, "guard_unreadable"),
                inputs,
                mode=mode_before,
                duration_ms=None,
                called=False,
                payload=None,
            )
        payload.update(self._gateway_state(mode_before))

        # Timed here rather than inside _post_guard so the measurement survives
        # the tests substituting that seam, and so it covers the whole call
        # including client setup -- which is latency the caller really pays.
        #
        # perf_counter, not monotonic: monotonic's granularity on Windows is
        # ~15ms, so a fast call rounds to zero and the p50 would be understated
        # at exactly the low end we care about. perf_counter is the
        # high-resolution clock on every platform, and is what Python documents
        # for measuring short durations.
        started = time.perf_counter()
        answer = await self._post_guard(payload)
        duration_ms = (time.perf_counter() - started) * 1000.0

        outcome, mode = self.judge(answer)
        return self._resolve(
            outcome,
            inputs,
            mode=mode,
            duration_ms=duration_ms,
            called=True,
            payload=payload,
        )

    def _resolve(
        self,
        outcome: GuardOutcome,
        inputs: Any,
        mode: Optional[str] = None,
        duration_ms: Optional[float] = None,
        called: bool = False,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """Apply a decided outcome: record it, then proceed, replace, or refuse."""
        record = build_health_log(
            outcome=outcome.event,
            mode=mode or self.current_mode(),
            duration_ms=duration_ms,
            called=called,
            guardrail_name=self.guardrail_name,
            payload=payload,
            ceiling=self.ceiling,
            settings_version=self.tracker.version,
            refused=not outcome.proceed,
        )
        # One line, valid JSON, no interpolation -- so a log collector can parse
        # it without a regex and the fields survive a message-wording change.
        log.info(json.dumps(record, separators=(",", ":"), sort_keys=True))
        if not outcome.proceed:
            if outcome.event == JUDGE_UNAVAILABLE:
                # Operator-visible and distinct (owner decision 2026-10-02).
                raise CairoGuardrailBlocked(
                    f"Blocked by {self.guardrail_name} ({JUDGE_UNAVAILABLE}): the "
                    "guardrail's judge model could not check this request, so it was "
                    "refused. Retry later; if it persists, the judge's capacity is "
                    "exhausted."
                )
            raise CairoGuardrailBlocked(
                f"Blocked by {self.guardrail_name} ({outcome.event})."
            )
        if outcome.text is not None:
            return self._replace_text(inputs, outcome.text)
        return inputs

    def _replace_text(self, inputs: Any, text: str) -> Any:
        """Put a redaction back in the shape the caller handed us.

        LiteLLM reads ``.get("texts")`` from the return value, so a bare string
        would crash the request instead of redacting it. Several texts are
        checked as one joined string, so a single redacted string cannot be
        mapped back onto them: refuse rather than guess which part was redacted.
        Only reachable in enforce mode, where refusing is the fail-closed answer.
        """
        if isinstance(inputs, dict) and "texts" in inputs:
            texts = inputs.get("texts")
            if isinstance(texts, (list, tuple)) and len(texts) == 1:
                return {**inputs, "texts": [text]}
            raise CairoGuardrailBlocked(
                f"Blocked by {self.guardrail_name} (redact_unmappable)."
            )
        return text

    async def _post_guard(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """POST to /v1/guard. Returns the verdict, or None if there isn't one.

        The only I/O in this module, and the seam the unit tests replace. Every
        failure returns None rather than raising: ``decide`` owns what "no usable
        answer" means per mode, so this must not pre-empt that by throwing into
        a record-mode request.
        """
        if not _HTTPX_AVAILABLE:
            log.warning("cairo_guardrail: httpx unavailable; cannot reach guardrails")
            return None
        if not self.guard_secret:
            # The service rejects a secret-less call anyway; saying so here makes
            # a misconfigured deploy readable in the log instead of a wall of 401s.
            log.error(
                "cairo_guardrail: %s is unset; guardrails cannot be called",
                GUARD_SECRET_ENV,
            )
            return None
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                response = await client.post(
                    self.guard_url,
                    json=payload,
                    headers={GUARD_SECRET_HEADER: self.guard_secret},
                )
            if response.status_code == 503:
                # N-64: rayin-guardrails' explicit "no verdict: judge
                # unavailable" answer carries its settings labels, and is told
                # apart from any other 503 by its body.
                try:
                    body = response.json()
                except Exception:
                    body = None
                if is_judge_unavailable(body):
                    return body
            if response.status_code != 200:
                log.warning(
                    "cairo_guardrail: guardrails returned HTTP %s", response.status_code
                )
                return None
            body = response.json()
            return body if isinstance(body, dict) else None
        except Exception as exc:  # timeout, connection refused, bad JSON
            log.warning("cairo_guardrail: guardrails call failed: %s", exc)
            return None
