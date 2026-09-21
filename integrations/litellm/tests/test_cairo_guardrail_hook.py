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

    def test_verdict_path_is_not_implemented_yet(self):
        """Step 1's verdict path must not silently appear to work."""
        import asyncio

        import cairo_guardrail_hook as m

        g = m.CairoGuardrail()
        with self.assertRaises(NotImplementedError):
            asyncio.run(g.apply_guardrail(inputs=object(), request_data={}))

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
