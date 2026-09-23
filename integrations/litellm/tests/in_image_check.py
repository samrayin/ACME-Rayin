"""In-image check for the guardrail hook: LiteLLM's real input type, real guardrails.

Run INSIDE the gateway pod before any switch-on (CHG-2026-044). The unit tests run
on a bare Python and so cannot see what LiteLLM actually passes; this can. Pipe the
hook and this file together, so nothing is written into the pod:

    cat integrations/litellm/config/cairo_guardrail_hook.py \
        integrations/litellm/tests/in_image_check.py \
      | kubectl -n rayin-platform exec -i deploy/litellm -- python -

It makes one real /v1/guard call, and guardrails makes one judge call through the
gateway. Exit 0 only if the hook built a request from LiteLLM's own input type,
reached guardrails, got a readable verdict, returned the input unchanged, and
printed its health record.
"""

import asyncio as _asyncio
import io as _io
import json as _json
import logging as _logging
import sys as _sys

from litellm.types.utils import GenericGuardrailAPIInputs as _Inputs


def _main() -> int:
    hook = CairoGuardrail(  # noqa: F821 - defined by the hook source piped ahead of this file
        guardrail_name=GUARDRAIL_NAME,  # noqa: F821
        event_hook="pre_call",
        default_on=True,
    )
    if hook.mode != "record":
        print(f"FAIL: mode is {hook.mode!r}; this check only runs in record mode")
        return 1

    captured = _io.StringIO()
    tap = _logging.StreamHandler(captured)
    log.addHandler(tap)  # noqa: F821
    inputs = _Inputs(texts=["In-image check: what is the capital of Bahrain?"])
    data = {"metadata": {"user_api_key_metadata": {}, "user_api_key_alias": "in-image-check"}}
    try:
        out = _asyncio.run(hook.apply_guardrail(inputs=inputs, request_data=data, input_type="request"))
    finally:
        log.removeHandler(tap)  # noqa: F821

    lines = [_json.loads(x) for x in captured.getvalue().splitlines() if HEALTH_LOG_EVENT in x]  # noqa: F821
    if len(lines) != 1:
        print(f"FAIL: expected one health record, got {len(lines)}")
        return 1
    rec = lines[0]
    print("health record:", _json.dumps(rec, sort_keys=True))

    problems = []
    if not rec.get("called"):
        problems.append(f"guardrails was not called (outcome {rec.get('outcome')})")
    if rec.get("outcome") in ("guard_unreadable", "guard_unavailable"):
        problems.append(f"no usable verdict (outcome {rec.get('outcome')})")
    if out is not inputs:
        problems.append("record mode did not return the input unchanged")
    if not log.isEnabledFor(_logging.INFO) or not any(  # noqa: F821
        getattr(h, "_cairo_health", False) for h in log.handlers  # noqa: F821
    ):
        problems.append("health records would not reach stdout")

    for p in problems:
        print("FAIL:", p)
    if not problems:
        print("PASS: LiteLLM's input type read, guardrails reached, verdict recorded")
    return 1 if problems else 0


_sys.exit(_main())
