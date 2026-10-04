"""CHG-2026-102: the hook on model ANSWERS (``input_type="response"``).

Run from the repository root, standard library only::

    python -m unittest discover -s integrations/litellm/tests -v

What this file proves, on a bare Python:

* an answer is sent to the guardrails service as ``direction: output``;
* record mode returns every answer unchanged, whatever the verdict;
* enforce mode withholds a blocked answer and an answer that could not be
  checked, through LiteLLM's passthrough exception when it is there and
  ``CairoAnswerWithheld`` when it is not;
* an enforced redaction is applied to a non-streamed answer and withheld
  from a streamed one;
* the Step 0 exclusion still fires on the answer side;
* the streaming flags follow the mode.

What it does not prove: that LiteLLM 1.100.1 calls the hook post-call, and
what the client receives. Those were read from the source (ADR-0005 "Output
direction") and are proven live by the in-image check and the dev test.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import unittest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config")
)

import cairo_guardrail_hook as m  # noqa: E402
from cairo_guardrail_hook import (  # noqa: E402
    ANSWER_WITHHELD_BLOCKED,
    ANSWER_WITHHELD_PERSONAL_DATA,
    ANSWER_WITHHELD_UNCHECKED,
    GUARDRAIL_NAME,
    OPT_OUT_FIELD,
    REDACT_ON_STREAM,
    GuardOutcome,
    build_guard_payload,
    is_streamed,
    output_outcome,
    redaction_mappable,
    streaming_flags,
    withheld_message,
)


def labelled(verdict, mode="enforce", version=1):
    """A verdict as rayin-guardrails v0.4.0 and later sends it, with the CAIRO
    settings it was decided under (ADR-0005-B). Non-verdicts pass unchanged.
    The same helper as test_cairo_guardrail_hook.py."""
    if not isinstance(verdict, dict) or "action" not in verdict:
        return verdict
    return {
        **verdict,
        "settings_status": "applied",
        "settings_version": version,
        "mode": mode,
    }


def req(stream=None, opted_out=False, model="cairo-chat"):
    key_meta = {OPT_OUT_FIELD: [GUARDRAIL_NAME]} if opted_out else {}
    data = {"model": model, "metadata": {"user_api_key_metadata": key_meta}}
    if stream is not None:
        data["stream"] = stream
    return data


def answer(text="The branch opens at 9."):
    """LiteLLM's unified-guardrail shape for one answer text."""
    return {"texts": [text]}


class PassthroughRaised(Exception):
    """Stands in for LiteLLM's ModifyResponseException in these tests."""

    def __init__(self, violation_message, request_data):
        super().__init__(violation_message)
        self.violation_message = violation_message
        self.request_data = request_data


class Hook:
    """Build a hook with the I/O seam replaced, in a given mode."""

    @staticmethod
    def make(verdict, mode="record", passthrough=True):
        g = m.CairoGuardrail()
        g.ceiling = mode
        g.guard_secret = "test-secret"
        calls = []
        sent = labelled(verdict, mode=mode)

        async def fake_post(payload):
            calls.append(payload)
            return sent

        g._post_guard = fake_post
        if passthrough == "real":
            pass  # whatever the installed LiteLLM's base class provides
        elif passthrough:

            def raise_passthrough_exception(violation_message, request_data, **_):
                raise PassthroughRaised(violation_message, request_data)

            g.raise_passthrough_exception = raise_passthrough_exception
        else:
            # Shadows the base class method, as on a bare Python.
            g.raise_passthrough_exception = None
        if mode == "enforce" and isinstance(sent, dict):
            # The tracker learns the console's mode from a verdict.
            g.tracker.observe(m.settings_labels(sent))
        return g, calls


def run(g, inputs, data):
    return asyncio.run(g.apply_guardrail(inputs=inputs, request_data=data, input_type="response"))


class TestPayload(unittest.TestCase):
    def test_answer_is_sent_as_output_direction(self):
        p = build_guard_payload(answer("hello"), req(), "response")
        self.assertEqual(p["direction"], "output")
        self.assertEqual(p["text"], "hello")

    def test_tool_call_only_answer_has_no_payload(self):
        """Fact 2g: a tool-call-only answer arrives with no texts."""
        self.assertIsNone(build_guard_payload({"texts": [], "tool_calls": [{}]}, req(), "response"))


class TestPureRules(unittest.TestCase):
    def test_streaming_flags_record_checks_once_at_the_end_and_does_not_buffer(self):
        self.assertEqual(streaming_flags("record"), (False, True))

    def test_streaming_flags_enforce_buffers_until_checked(self):
        self.assertEqual(streaming_flags("enforce"), (True, True))

    def test_streaming_flags_anything_else_is_record(self):
        for mode in ("", "ENFORCE", None, "off"):
            self.assertEqual(streaming_flags(mode), (False, True), mode)

    def test_is_streamed(self):
        self.assertTrue(is_streamed({"stream": True}))
        self.assertTrue(is_streamed({"stream": "true"}), "any truthy value streams in LiteLLM")
        self.assertFalse(is_streamed({"stream": False}))
        self.assertFalse(is_streamed({}))
        self.assertFalse(is_streamed(None))

    def test_output_outcome_withholds_a_redaction_of_a_streamed_answer(self):
        o = output_outcome(GuardOutcome(True, "<PERSON>", "redacted"), streamed=True)
        self.assertEqual(o, GuardOutcome(False, None, REDACT_ON_STREAM))

    def test_output_outcome_keeps_a_redaction_of_a_whole_answer(self):
        o = GuardOutcome(True, "<PERSON>", "redacted")
        self.assertEqual(output_outcome(o, streamed=False), o)

    def test_output_outcome_leaves_everything_else(self):
        for o in (
            GuardOutcome(True, None, "allow"),
            GuardOutcome(True, None, "would_redact"),
            GuardOutcome(False, None, "blocked"),
            GuardOutcome(False, None, "judge_unavailable"),
        ):
            for streamed in (True, False):
                self.assertEqual(output_outcome(o, streamed), o)

    def test_withheld_message_says_judged_or_not_checked(self):
        self.assertEqual(withheld_message("blocked"), ANSWER_WITHHELD_BLOCKED)
        self.assertEqual(withheld_message(REDACT_ON_STREAM), ANSWER_WITHHELD_PERSONAL_DATA)
        self.assertEqual(withheld_message("redact_unmappable"), ANSWER_WITHHELD_PERSONAL_DATA)
        for event in (
            "judge_unavailable",
            "guard_unavailable",
            "guard_unreadable",
            "settings_unusable",
            "anything_new",
        ):
            self.assertEqual(withheld_message(event), ANSWER_WITHHELD_UNCHECKED, event)

    def test_withheld_messages_carry_no_traceback_or_policy_detail(self):
        for msg in (ANSWER_WITHHELD_BLOCKED, ANSWER_WITHHELD_UNCHECKED, ANSWER_WITHHELD_PERSONAL_DATA):
            self.assertNotIn("Traceback", msg)
            self.assertNotIn("\n", msg)
            self.assertLess(len(msg), 120)

    def test_redaction_mappable(self):
        self.assertTrue(redaction_mappable({"texts": ["a"]}))
        self.assertFalse(redaction_mappable({"texts": ["a", "b"]}))
        self.assertFalse(redaction_mappable({"texts": []}))
        self.assertTrue(redaction_mappable("plain string"))


class TestRecordMode(unittest.TestCase):
    """Record: every answer returned unchanged, every verdict."""

    def test_every_verdict_returns_the_answer_unchanged(self):
        for verdict in (
            {"action": "allow"},
            {"action": "block"},
            {"action": "redact", "redacted_text": "<PERSON>"},
            None,
            {"verdict": "none", "reason": "judge_unavailable"},
        ):
            for stream in (None, True):
                g, calls = Hook.make(verdict, mode="record")
                a = answer()
                out = run(g, a, req(stream=stream))
                self.assertIs(out, a, f"{verdict} stream={stream}")
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0]["direction"], "output")

    def test_tool_call_only_answer_proceeds_without_a_call(self):
        g, calls = Hook.make({"action": "block"}, mode="record")
        a = {"texts": [], "tool_calls": [{"id": "t1"}]}
        self.assertIs(run(g, a, req()), a)
        self.assertEqual(calls, [])


class TestEnforceMode(unittest.TestCase):
    def test_allow_returns_the_answer_unchanged(self):
        g, _ = Hook.make({"action": "allow"}, mode="enforce")
        a = answer()
        self.assertIs(run(g, a, req()), a)

    def test_block_is_withheld_through_the_passthrough(self):
        g, _ = Hook.make({"action": "block"}, mode="enforce")
        data = req()
        with self.assertRaises(PassthroughRaised) as cm:
            run(g, answer("off-topic answer"), data)
        self.assertEqual(cm.exception.violation_message, ANSWER_WITHHELD_BLOCKED)
        self.assertIs(cm.exception.request_data, data, "LiteLLM reads the model from request_data")

    def test_without_the_passthrough_it_still_refuses(self):
        g, _ = Hook.make({"action": "block"}, mode="enforce", passthrough=False)
        with self.assertRaises(m.CairoAnswerWithheld) as cm:
            run(g, answer(), req())
        self.assertEqual(str(cm.exception), ANSWER_WITHHELD_BLOCKED)
        self.assertIsInstance(cm.exception, m.CairoGuardrailBlocked)

    @unittest.skipUnless(m._LITELLM_AVAILABLE, "LiteLLM not installed (the CI runs on a bare Python)")
    def test_with_litellm_installed_the_real_passthrough_exception_is_raised(self):
        from litellm.exceptions import ModifyResponseException

        g, _ = Hook.make({"action": "block"}, mode="enforce", passthrough="real")
        data = req(model="cairo-chat")
        with self.assertRaises(ModifyResponseException) as cm:
            run(g, answer(), data)
        self.assertEqual(cm.exception.message, ANSWER_WITHHELD_BLOCKED)
        self.assertEqual(cm.exception.model, "cairo-chat")
        self.assertEqual(cm.exception.guardrail_name, GUARDRAIL_NAME)

    def test_no_verdict_is_withheld_as_not_checked(self):
        for verdict in (None, {"verdict": "none", "reason": "judge_unavailable"}, {"action": "??"}):
            g, _ = Hook.make(verdict, mode="enforce")
            # A verdict with no labels cannot set the mode, so put the replica
            # in enforce the way an earlier labelled verdict would have.
            g.tracker.observe(m.settings_labels(labelled({"action": "allow"}, mode="enforce")))
            with self.assertRaises(PassthroughRaised) as cm:
                run(g, answer(), req())
            self.assertEqual(cm.exception.violation_message, ANSWER_WITHHELD_UNCHECKED, verdict)

    def test_unreadable_answer_is_withheld_as_not_checked(self):
        """Owner decision 2: a tool-call-only answer is refused in enforce."""
        g, calls = Hook.make({"action": "allow"}, mode="enforce")
        with self.assertRaises(PassthroughRaised) as cm:
            run(g, {"texts": [], "tool_calls": [{"id": "t1"}]}, req())
        self.assertEqual(cm.exception.violation_message, ANSWER_WITHHELD_UNCHECKED)
        self.assertEqual(calls, [], "nothing to check, so the service is not called")

    def test_redaction_is_applied_to_a_whole_answer(self):
        g, _ = Hook.make({"action": "redact", "redacted_text": "Call <PERSON>."}, mode="enforce")
        out = run(g, answer("Call Fatima."), req())
        self.assertEqual(out, {"texts": ["Call <PERSON>."]})

    def test_redaction_of_a_streamed_answer_is_withheld(self):
        g, _ = Hook.make({"action": "redact", "redacted_text": "Call <PERSON>."}, mode="enforce")
        with self.assertRaises(PassthroughRaised) as cm:
            run(g, answer("Call Fatima."), req(stream=True))
        self.assertEqual(cm.exception.violation_message, ANSWER_WITHHELD_PERSONAL_DATA)

    def test_redaction_across_several_answer_texts_is_withheld(self):
        g, _ = Hook.make({"action": "redact", "redacted_text": "x <PERSON>"}, mode="enforce")
        with self.assertRaises(PassthroughRaised) as cm:
            run(g, {"texts": ["choice one", "choice two"]}, req())
        self.assertEqual(cm.exception.violation_message, ANSWER_WITHHELD_PERSONAL_DATA)

    def test_a_streamed_answer_that_passes_is_returned_unchanged(self):
        g, _ = Hook.make({"action": "allow"}, mode="enforce")
        a = answer()
        self.assertIs(run(g, a, req(stream=True)), a)


class TestStepZeroOnAnswers(unittest.TestCase):
    def test_excluded_key_answer_is_never_checked_even_in_enforce(self):
        g, calls = Hook.make({"action": "block"}, mode="enforce")
        a = answer("the judge's own answer")
        self.assertIs(run(g, a, req(opted_out=True)), a)
        self.assertEqual(calls, [], "the judge's answers must not re-enter the guardrail")


class TestStreamingProperties(unittest.TestCase):
    def test_properties_follow_the_mode(self):
        g, _ = Hook.make({"action": "allow"}, mode="record")
        self.assertFalse(g.streaming_buffer_until_moderated)
        self.assertTrue(g.streaming_end_of_stream_only)
        g, _ = Hook.make({"action": "allow"}, mode="enforce")
        self.assertTrue(g.streaming_buffer_until_moderated)
        self.assertTrue(g.streaming_end_of_stream_only)

    def test_ceiling_record_never_buffers_even_if_the_console_says_enforce(self):
        g, _ = Hook.make({"action": "allow"}, mode="record")
        g.tracker.observe(m.settings_labels(labelled({"action": "allow"}, mode="enforce")))
        self.assertEqual(g.current_mode(), "record")
        self.assertFalse(g.streaming_buffer_until_moderated)

    def test_assigning_a_flag_cannot_switch_buffering_off(self):
        """LiteLLM may copy params onto the instance; the mode still decides."""
        g, _ = Hook.make({"action": "allow"}, mode="enforce")
        g.streaming_buffer_until_moderated = False
        g.streaming_end_of_stream_only = False
        self.assertTrue(g.streaming_buffer_until_moderated)
        self.assertTrue(g.streaming_end_of_stream_only)


class TestHealthRecordOnAnswers(unittest.TestCase):
    def _capture(self, verdict, mode, data, inputs=None):
        g, _ = Hook.make(verdict, mode=mode)
        lines = []

        class Sink(logging.Handler):
            def emit(self, record):
                lines.append(record.getMessage())

        sink = Sink()
        m.log.addHandler(sink)
        try:
            try:
                run(g, inputs if inputs is not None else answer(), data)
            except PassthroughRaised:
                pass
        finally:
            m.log.removeHandler(sink)
        records = [json.loads(x) for x in lines if m.HEALTH_LOG_EVENT in x]
        self.assertEqual(len(records), 1)
        return records[0]

    def test_record_mode_answer_is_recorded_with_direction_output(self):
        rec = self._capture({"action": "block"}, "record", req())
        self.assertEqual(rec["direction"], "output")
        self.assertEqual(rec["outcome"], "would_block")
        self.assertFalse(rec["refused"])

    def test_withheld_streamed_redaction_is_recorded_as_refused(self):
        rec = self._capture(
            {"action": "redact", "redacted_text": "<PERSON>"}, "enforce", req(stream=True)
        )
        self.assertEqual(rec["outcome"], REDACT_ON_STREAM)
        self.assertTrue(rec["refused"])

    def test_unreadable_answer_record_still_names_the_direction(self):
        rec = self._capture({"action": "allow"}, "record", req(), inputs={"texts": []})
        self.assertEqual(rec["outcome"], "guard_unreadable")
        self.assertEqual(rec["direction"], "output")


class TestTimeouts(unittest.TestCase):
    def test_answers_have_their_own_longer_default(self):
        g = m.CairoGuardrail()
        self.assertEqual(g.timeout_s, 2.0)
        self.assertEqual(g.output_timeout_s, 4.0)

    def test_answer_timeout_is_overridable(self):
        os.environ["CAIRO_GUARDRAIL_OUTPUT_TIMEOUT_S"] = "3.5"
        try:
            self.assertEqual(m.CairoGuardrail().output_timeout_s, 3.5)
        finally:
            del os.environ["CAIRO_GUARDRAIL_OUTPUT_TIMEOUT_S"]


if __name__ == "__main__":
    unittest.main()
