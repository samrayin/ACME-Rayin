"""In-image check for the guardrail hook: LiteLLM's real input type, real guardrails.

Run INSIDE the gateway pod before any switch-on (CHG-2026-044). The unit tests run
on a bare Python and so cannot see what LiteLLM actually passes; this can. Pipe the
hook and this file together, so nothing is written into the pod:

    cat integrations/litellm/config/cairo_guardrail_hook.py \
        integrations/litellm/tests/in_image_check.py \
      | kubectl -n rayin-platform exec -i deploy/litellm -- python -

It makes two real /v1/guard calls, one for a prompt and one for an answer
(CHG-2026-102), and guardrails makes one judge call through the gateway for
each. Exit 0 only if, for both directions, the hook built a request from
LiteLLM's own input type, reached guardrails, got a readable verdict, returned
the input unchanged, and printed its health record; and if the installed
LiteLLM has the passthrough this hook uses to withhold an answer in enforce
mode, and the record-mode streaming flags are what the hook intends.
"""

import asyncio as _asyncio
import io as _io
import json as _json
import logging as _logging
import sys as _sys

from litellm.types.utils import GenericGuardrailAPIInputs as _Inputs


def _one_call(hook, text, input_type):
    """One real call in record mode. Returns (health record or None, problems)."""
    captured = _io.StringIO()
    tap = _logging.StreamHandler(captured)
    log.addHandler(tap)  # noqa: F821
    inputs = _Inputs(texts=[text])
    data = {"metadata": {"user_api_key_metadata": {}, "user_api_key_alias": "in-image-check"}}
    try:
        out = _asyncio.run(hook.apply_guardrail(inputs=inputs, request_data=data, input_type=input_type))
    finally:
        log.removeHandler(tap)  # noqa: F821

    lines = [_json.loads(x) for x in captured.getvalue().splitlines() if HEALTH_LOG_EVENT in x]  # noqa: F821
    if len(lines) != 1:
        return None, [f"{input_type}: expected one health record, got {len(lines)}"]
    rec = lines[0]
    print(f"health record ({input_type}):", _json.dumps(rec, sort_keys=True))

    problems = []
    if not rec.get("called"):
        problems.append(f"{input_type}: guardrails was not called (outcome {rec.get('outcome')})")
    if rec.get("outcome") in ("guard_unreadable", "guard_unavailable"):
        problems.append(f"{input_type}: no usable verdict (outcome {rec.get('outcome')})")
    want = {"request": "input", "response": "output"}[input_type]
    if rec.get("direction") != want:
        problems.append(f"{input_type}: recorded direction {rec.get('direction')!r}, expected {want!r}")
    if out is not inputs:
        problems.append(f"{input_type}: record mode did not return the input unchanged")
    return rec, problems


def _main() -> int:
    hook = CairoGuardrail(  # noqa: F821 - defined by the hook source piped ahead of this file
        guardrail_name=GUARDRAIL_NAME,  # noqa: F821
        event_hook=["pre_call", "post_call"],
        default_on=True,
    )
    if hook.current_mode() != "record":
        print(f"FAIL: mode is {hook.current_mode()!r}; this check only runs in record mode")
        return 1

    problems = []
    _, p = _one_call(hook, "In-image check: what is the capital of Bahrain?", "request")
    problems += p
    _, p = _one_call(hook, "In-image check: the capital of Bahrain is Manama.", "response")
    problems += p

    if not log.isEnabledFor(_logging.INFO) or not any(  # noqa: F821
        getattr(h, "_cairo_health", False) for h in log.handlers  # noqa: F821
    ):
        problems.append("health records would not reach stdout")
    if not callable(getattr(hook, "raise_passthrough_exception", None)):
        problems.append(
            "this LiteLLM has no raise_passthrough_exception: an answer withheld in "
            "enforce mode would reach the user as an error, not a message"
        )
    if (hook.streaming_buffer_until_moderated, hook.streaming_end_of_stream_only) != (False, True):
        problems.append("record-mode streaming flags are not (no buffering, end of stream only)")

    for p in problems:
        print("FAIL:", p)
    if not problems:
        print(
            "PASS: LiteLLM's input type read for prompts and answers, guardrails reached, "
            "verdicts recorded, passthrough present"
        )
    return 1 if problems else 0


_sys.exit(_main())
