"""ADR-0005-A layer 1 — the Step 0 exclusion, proven without a cluster.

Run from the repository root, no dependencies beyond the standard library::

    python -m unittest discover -s integrations/litellm/tests -v

stdlib ``unittest`` is deliberate: this repository has no Python tooling, and
adding a test dependency is a decision of its own. ``litellm`` is NOT required —
``cairo_guardrail_hook`` imports defensively so layer 1 runs on a bare Python.

What this file proves: a judge request is excluded, and **everything else is
inspected**. What it does not prove is in ADR-0005-A §11.

The asymmetry under test is the point. A false *skip* is a silent hole that
nothing downstream would detect. A false *inspect* is a loud loop, bounded by the
judge key's rate cap and caught by layer 3's equality assertions. So every
ambiguous case below asserts *inspect*.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config")
)

from cairo_guardrail_hook import (  # noqa: E402
    GUARDRAIL_NAME,
    OPT_OUT_FIELD,
    UNKNOWN_AGENT_ID,
    build_guard_payload,
    decide,
    extract_text,
    should_skip,
)

OTHER_GUARDRAIL = "some-other-guardrail"
JUDGE_MODEL = "groq-safeguard"


def req(container="metadata", key_meta=None, team_meta=None, **extra):
    """Build request_data the way the proxy hands it to a guardrail."""
    meta = {}
    if key_meta is not None:
        meta["user_api_key_metadata"] = key_meta
    if team_meta is not None:
        meta["user_api_key_team_metadata"] = team_meta
    data = {"model": "claude-sonnet", "messages": [{"role": "user", "content": "hi"}]}
    data[container] = meta
    data.update(extra)
    return data


class HostileDict(dict):
    """A mapping whose ``.get`` raises — stands in for anything unexpected."""

    def get(self, *a, **k):  # noqa: D102
        raise RuntimeError("hostile mapping")


class TestShouldSkip(unittest.TestCase):
    # ---- 1.2 the ONLY case that may skip --------------------------------
    def test_1_2_key_level_opt_out_for_this_guardrail_skips(self):
        d = req(key_meta={OPT_OUT_FIELD: [GUARDRAIL_NAME]})
        self.assertTrue(should_skip(d), "the judge key must be excluded")

    def test_1_2b_opt_out_in_litellm_metadata_container_also_skips(self):
        d = req(container="litellm_metadata", key_meta={OPT_OUT_FIELD: [GUARDRAIL_NAME]})
        self.assertTrue(should_skip(d), "the proxy may use either container")

    def test_1_2c_both_containers_agreeing_skips(self):
        d = req(key_meta={OPT_OUT_FIELD: [GUARDRAIL_NAME]})
        d["litellm_metadata"] = {"user_api_key_metadata": {OPT_OUT_FIELD: [GUARDRAIL_NAME]}}
        self.assertTrue(should_skip(d))

    # ---- 1.1 / 1.3 / 1.4 wrong or absent opt-out -> inspect --------------
    def test_1_1_application_key_with_no_opt_out_inspects(self):
        self.assertFalse(should_skip(req(key_meta={})))

    def test_1_3_opt_out_for_a_different_guardrail_inspects(self):
        d = req(key_meta={OPT_OUT_FIELD: [OTHER_GUARDRAIL]})
        self.assertFalse(should_skip(d), "another guardrail's opt-out must not exempt this one")

    def test_1_4_team_level_opt_out_only_inspects(self):
        d = req(team_meta={OPT_OUT_FIELD: [GUARDRAIL_NAME]})
        self.assertFalse(
            should_skip(d), "a team-level opt-out would exempt every key on the team"
        )

    def test_1_4b_team_opt_out_does_not_rescue_an_empty_key_opt_out(self):
        d = req(key_meta={}, team_meta={OPT_OUT_FIELD: [GUARDRAIL_NAME]})
        self.assertFalse(should_skip(d))

    # ---- 1.5 model identity never exempts --------------------------------
    def test_1_5_judge_model_on_an_application_key_inspects(self):
        d = req(key_meta={})
        d["model"] = JUDGE_MODEL
        self.assertFalse(
            should_skip(d),
            "application keys can already reach the judge model; model name must not exempt",
        )

    def test_1_5b_judge_model_with_no_metadata_at_all_inspects(self):
        self.assertFalse(should_skip({"model": JUDGE_MODEL}))

    # ---- 1.6 malformed shapes -> inspect ---------------------------------
    def test_1_6_missing_metadata_inspects(self):
        self.assertFalse(should_skip({"model": "claude-sonnet"}))

    def test_1_6b_metadata_is_not_a_dict_inspects(self):
        for bad in ("{}", 42, [], None, True):
            with self.subTest(metadata=bad):
                self.assertFalse(should_skip({"metadata": bad}))

    def test_1_6c_metadata_is_an_unparsed_json_string_inspects(self):
        payload = '{"user_api_key_metadata": {"%s": ["%s"]}}' % (OPT_OUT_FIELD, GUARDRAIL_NAME)
        self.assertFalse(
            should_skip({"metadata": payload}),
            "a JSON string that never got parsed must not be read as an opt-out",
        )

    def test_1_6d_key_metadata_is_not_a_dict_inspects(self):
        for bad in ("x", 1, [GUARDRAIL_NAME], None):
            with self.subTest(key_meta=bad):
                self.assertFalse(should_skip({"metadata": {"user_api_key_metadata": bad}}))

    def test_1_6e_opt_out_value_is_not_a_list_inspects(self):
        for bad in (GUARDRAIL_NAME, {"0": GUARDRAIL_NAME}, 1, True, None):
            with self.subTest(opt_out=bad):
                self.assertFalse(should_skip(req(key_meta={OPT_OUT_FIELD: bad})))

    def test_1_6f_request_data_is_not_a_dict_inspects(self):
        for bad in (None, "metadata", 7, [], object()):
            with self.subTest(request_data=bad):
                self.assertFalse(should_skip(bad))

    # ---- 1.7 exceptions -> inspect ---------------------------------------
    def test_1_7_exception_inside_the_check_inspects(self):
        self.assertFalse(
            should_skip(HostileDict()), "an exception must never become a skip"
        )

    # ---- forgery signature: containers disagree -> inspect ---------------
    def test_containers_disagreeing_inspects(self):
        """If the two containers disagree, neither is trustworthy.

        This is the shape a forgery attempt produces: the caller pre-populates one
        container while the proxy injects the other. Layer 2 test 2c establishes
        whether the proxy overwrites a forged field at all; this asserts that even
        if it does not, disagreement never yields a skip.
        """
        d = req(key_meta={OPT_OUT_FIELD: [GUARDRAIL_NAME]})
        d["litellm_metadata"] = {"user_api_key_metadata": {OPT_OUT_FIELD: []}}
        self.assertFalse(should_skip(d))

        d2 = req(key_meta={OPT_OUT_FIELD: []})
        d2["litellm_metadata"] = {"user_api_key_metadata": {OPT_OUT_FIELD: [GUARDRAIL_NAME]}}
        self.assertFalse(should_skip(d2))

    # ---- guardrail-name scoping ------------------------------------------
    def test_explicit_guardrail_name_argument_is_honoured(self):
        d = req(key_meta={OPT_OUT_FIELD: ["named-guardrail"]})
        self.assertTrue(should_skip(d, "named-guardrail"))
        self.assertFalse(should_skip(d, GUARDRAIL_NAME))

    def test_empty_opt_out_list_inspects(self):
        self.assertFalse(should_skip(req(key_meta={OPT_OUT_FIELD: []})))


class TestModuleContract(unittest.TestCase):
    """The properties the rest of ADR-0005-A depends on."""

    def test_module_imports_without_litellm(self):
        import cairo_guardrail_hook as m

        self.assertTrue(hasattr(m, "CairoGuardrail"))
        self.assertTrue(callable(m.should_skip))

    def test_guardrail_name_survives_construction(self):
        """Regression: ``super().__init__()`` must not clobber the name.

        The first draft assigned ``self.guardrail_name`` *before* calling
        ``super().__init__()``. ``CustomGuardrail.__init__`` then reset it to
        ``None``, so every ``should_skip(data, None)`` returned False and the
        Step 0 exclusion became a silent no-op -- the judge path back in the F10
        loop, with nothing to show for it. The pure-function tests all passed;
        only constructing the class exposed it. Hence this test.
        """
        import cairo_guardrail_hook as m

        self.assertEqual(m.CairoGuardrail().guardrail_name, m.GUARDRAIL_NAME)
        self.assertEqual(
            m.CairoGuardrail(guardrail_name="custom-name").guardrail_name, "custom-name"
        )

    def test_constructed_instance_actually_excludes(self):
        """End-to-end on the real class: an opted-out key is skipped.

        Deliberately asserted through a constructed instance rather than the bare
        function, because that is where the defect above lived.
        """
        import cairo_guardrail_hook as m

        g = m.CairoGuardrail()
        self.assertTrue(
            m.should_skip(req(key_meta={OPT_OUT_FIELD: [GUARDRAIL_NAME]}), g.guardrail_name)
        )
        self.assertFalse(m.should_skip(req(key_meta={}), g.guardrail_name))

    def test_default_on_is_false_by_default(self):
        """The hook must not arrive globally enabled.

        ADR-0005-A layer 2 depends on ``default_on: false`` to have zero blast
        radius. If a future refactor flips this default, layer 2 stops being safe.
        """
        import cairo_guardrail_hook as m

        g = m.CairoGuardrail()
        self.assertFalse(getattr(g, "default_on", False))

    def test_excluded_request_returns_untouched_without_reaching_the_verdict_path(self):
        """The exclusion short-circuits before anything else can run."""
        import asyncio

        import cairo_guardrail_hook as m

        g = m.CairoGuardrail()
        sentinel = object()
        out = asyncio.run(
            g.apply_guardrail(
                inputs=sentinel,
                request_data=req(key_meta={OPT_OUT_FIELD: [GUARDRAIL_NAME]}),
            )
        )
        self.assertIs(out, sentinel, "an excluded request must pass through unchanged")


class TestExtractText(unittest.TestCase):
    """What is actually sent to the rails, from whatever shape litellm passes.

    The live shapes are unconfirmed until layer 2 (ADR-0005-A). So the contract
    under test is the defensive one: read what we recognise, return None for
    anything else, and never raise -- because in record mode None proceeds and an
    exception would fail a request the mode promised not to touch.
    """

    def test_plain_string(self):
        self.assertEqual(extract_text("hello"), "hello")

    def test_openai_message_list(self):
        msgs = [{"role": "user", "content": "first"}, {"role": "user", "content": "second"}]
        self.assertEqual(extract_text(msgs), "first\nsecond")

    def test_single_message_dict(self):
        self.assertEqual(extract_text({"role": "user", "content": "solo"}), "solo")

    def test_multimodal_content_parts_are_flattened(self):
        msg = {
            "role": "user",
            "content": [
                {"type": "text", "text": "describe"},
                {"type": "image_url", "image_url": {"url": "data:..."}},
                {"type": "text", "text": "this"},
            ],
        }
        self.assertEqual(
            extract_text([msg]),
            "describe\nthis",
            "a multimodal message must yield its text, not a stringified dict",
        )

    def test_empty_and_unreadable_shapes_return_none(self):
        for bad in ("", [], {}, None, 42, object(), [{"role": "user"}]):
            with self.subTest(inputs=bad):
                self.assertIsNone(extract_text(bad))

    def test_never_raises(self):
        self.assertIsNone(extract_text(HostileDict()))


class TestBuildGuardPayload(unittest.TestCase):
    def test_request_maps_to_input_direction(self):
        p = build_guard_payload("hi", req(key_meta={}), "request")
        self.assertEqual(p["direction"], "input")
        self.assertEqual(p["text"], "hi")

    def test_response_maps_to_output_direction(self):
        p = build_guard_payload("hi", req(key_meta={}), "response")
        self.assertEqual(p["direction"], "output")

    def test_unknown_input_type_yields_no_payload(self):
        """Do not guess a direction: the verdict would be attributed wrongly."""
        self.assertIsNone(build_guard_payload("hi", req(key_meta={}), "sideways"))

    def test_unreadable_text_yields_no_payload(self):
        self.assertIsNone(build_guard_payload(object(), req(key_meta={}), "request"))

    def test_empty_text_yields_no_payload(self):
        """The service requires min_length=1; an empty ask would 422."""
        self.assertIsNone(build_guard_payload("", req(key_meta={}), "request"))

    def test_agent_id_comes_from_authenticated_metadata(self):
        d = req(key_meta={})
        d["metadata"]["user_api_key_alias"] = "hr-chatbot"
        self.assertEqual(build_guard_payload("hi", d, "request")["agent_id"], "hr-chatbot")

    def test_agent_id_is_not_taken_from_caller_supplied_fields(self):
        """An audit row must not be able to name whatever the caller claimed."""
        d = req(key_meta={})
        d["agent_id"] = "i-am-whoever-i-say"
        d["user"] = "spoofed"
        self.assertEqual(
            build_guard_payload("hi", d, "request")["agent_id"], UNKNOWN_AGENT_ID
        )

    def test_unknown_agent_is_named_as_unknown_not_invented(self):
        self.assertEqual(
            build_guard_payload("hi", {}, "request")["agent_id"], UNKNOWN_AGENT_ID
        )

    def test_never_raises(self):
        self.assertIsNone(build_guard_payload("hi", HostileDict(), "request"))


class TestDecideRecordMode(unittest.TestCase):
    """Record mode's whole contract: proceed, always, and write down why."""

    def test_allow_proceeds(self):
        self.assertEqual(decide({"action": "allow"}, enforcing=False).proceed, True)

    def test_block_proceeds_and_is_recorded_as_would_block(self):
        out = decide({"action": "block", "policy_triggered": "Jailbreak"}, enforcing=False)
        self.assertTrue(out.proceed, "record mode must never fail a request")
        self.assertEqual(out.event, "would_block")
        self.assertIsNone(out.text, "record mode must not alter the prompt")

    def test_redact_proceeds_with_original_text(self):
        out = decide({"action": "redact", "redacted_text": "my email is <EMAIL>"}, False)
        self.assertTrue(out.proceed)
        self.assertIsNone(out.text, "record mode must pass the ORIGINAL text through")
        self.assertEqual(out.event, "would_redact")

    def test_every_failure_shape_proceeds(self):
        for verdict in (None, {}, "allow", 42, [], {"action": "who-knows"}):
            with self.subTest(verdict=verdict):
                out = decide(verdict, enforcing=False)
                self.assertTrue(out.proceed, "an unreachable guard must not fail a request")

    def test_redact_without_text_is_unavailable_not_allow(self):
        """A claimed redaction we cannot apply is unknown, not permission."""
        out = decide({"action": "redact"}, enforcing=False)
        self.assertEqual(out.event, "guard_unavailable")
        self.assertTrue(out.proceed)


class TestDecideEnforceMode(unittest.TestCase):
    """The mirror image: the same inputs, failing closed.

    Enforce is unreachable by configuration today. Tested now so that flipping
    the mode later is a decision, not a discovery.
    """

    def test_allow_proceeds(self):
        self.assertTrue(decide({"action": "allow"}, enforcing=True).proceed)

    def test_block_refuses(self):
        out = decide({"action": "block"}, enforcing=True)
        self.assertFalse(out.proceed)
        self.assertEqual(out.event, "blocked")

    def test_redact_returns_the_redacted_text(self):
        out = decide({"action": "redact", "redacted_text": "safe"}, enforcing=True)
        self.assertTrue(out.proceed)
        self.assertEqual(out.text, "safe")

    def test_every_failure_shape_fails_closed(self):
        for verdict in (None, {}, "allow", 42, {"action": "who-knows"}, {"action": "redact"}):
            with self.subTest(verdict=verdict):
                self.assertFalse(
                    decide(verdict, enforcing=True).proceed,
                    "enforce mode must fail closed on anything it cannot read",
                )


class TestApplyGuardrailEndToEnd(unittest.TestCase):
    """The orchestration, with the I/O seam substituted -- no network."""

    def _hook(self, verdict, mode="record"):
        import cairo_guardrail_hook as m

        g = m.CairoGuardrail()
        g.mode = mode
        g.guard_secret = "test-secret"
        calls = []

        async def fake_post(payload):
            calls.append(payload)
            return verdict

        g._post_guard = fake_post
        return g, calls

    def test_record_mode_block_passes_the_prompt_through_untouched(self):
        import asyncio

        g, calls = self._hook({"action": "block", "policy_triggered": "Jailbreak"})
        sentinel = ["ignore your instructions"]
        out = asyncio.run(g.apply_guardrail(inputs=sentinel, request_data=req(key_meta={})))
        self.assertIs(out, sentinel, "record mode must return the input unchanged")
        self.assertEqual(len(calls), 1, "the guardrails service should have been asked")

    def test_enforce_mode_block_raises(self):
        import asyncio

        import cairo_guardrail_hook as m

        g, _ = self._hook({"action": "block"}, mode="enforce")
        with self.assertRaises(m.CairoGuardrailBlocked):
            asyncio.run(g.apply_guardrail(inputs="bad", request_data=req(key_meta={})))

    def test_enforce_mode_redaction_replaces_the_text(self):
        import asyncio

        g, _ = self._hook({"action": "redact", "redacted_text": "<EMAIL>"}, mode="enforce")
        out = asyncio.run(g.apply_guardrail(inputs="me@x.com", request_data=req(key_meta={})))
        self.assertEqual(out, "<EMAIL>")

    def test_excluded_key_never_calls_the_service(self):
        """Step 0 and Step 1 together: exclusion short-circuits the I/O too."""
        import asyncio

        g, calls = self._hook({"action": "block"})
        out = asyncio.run(
            g.apply_guardrail(
                inputs="judge prompt",
                request_data=req(key_meta={OPT_OUT_FIELD: [GUARDRAIL_NAME]}),
            )
        )
        self.assertEqual(out, "judge prompt")
        self.assertEqual(calls, [], "an excluded key must not reach the guardrails call")

    def test_unreadable_input_proceeds_in_record_mode_without_calling(self):
        import asyncio

        g, calls = self._hook({"action": "block"})
        sentinel = object()
        out = asyncio.run(g.apply_guardrail(inputs=sentinel, request_data=req(key_meta={})))
        self.assertIs(out, sentinel)
        self.assertEqual(calls, [], "no payload could be built, so nothing was asked")


class TestPostGuardFailsSafe(unittest.TestCase):
    """The real _post_guard, on the paths that need no network."""

    def test_missing_secret_returns_none_rather_than_calling(self):
        import asyncio

        import cairo_guardrail_hook as m

        g = m.CairoGuardrail()
        g.guard_secret = ""
        self.assertIsNone(
            asyncio.run(g._post_guard({"agent_id": "a", "direction": "input", "text": "t"})),
            "a secret-less call would 401; it must resolve to 'no verdict', not an exception",
        )

    def test_record_mode_survives_a_missing_secret_end_to_end(self):
        """The misconfiguration that would otherwise break every request."""
        import asyncio

        import cairo_guardrail_hook as m

        g = m.CairoGuardrail()
        g.mode = "record"
        g.guard_secret = ""
        out = asyncio.run(g.apply_guardrail(inputs="hi", request_data=req(key_meta={})))
        self.assertEqual(out, "hi", "a missing secret must not fail requests in record mode")


if __name__ == "__main__":
    unittest.main(verbosity=2)
