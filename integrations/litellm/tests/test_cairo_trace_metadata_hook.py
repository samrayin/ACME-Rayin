"""ADR-0006 §11 / CHG-2026-028 — the trace-metadata allowlist hook, proven without a cluster.

Run from the repository root, no dependencies beyond the standard library::

    python -m unittest discover -s integrations/litellm/tests -v

stdlib ``unittest`` is deliberate, matching ``test_cairo_guardrail_hook.py``.
``litellm`` is NOT required — ``cairo_trace_metadata_hook`` imports it defensively,
and ``strip_untrusted_trace_metadata`` has no import of it at all.

What this file proves: every field ADR-0006 §11 scoped for stripping is actually
stripped, from both metadata containers and the header channel, in combination —
and that a request carrying none of them passes through byte-for-byte unchanged.
What it does not prove: that ``async_pre_call_hook`` receives ``proxy_server_request``
in exactly this shape from a live LiteLLM proxy — that is a source-read inference
(``litellm_pre_call_utils.py``'s own construction order), not verified against a
running pod. See the CHG-2026-028 report for what ran versus what could not.
"""

from __future__ import annotations

import copy
import os
import sys
import unittest

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config")
)

from cairo_trace_metadata_hook import (  # noqa: E402
    TRACE_PREFIX_ALLOWLIST,
    UNCONDITIONAL_STRIP_KEYS,
    CairoTraceMetadataAllowlistHook,
    strip_untrusted_trace_metadata,
)

IDENTIFIER_FIELDS = ("trace_id", "existing_trace_id", "generation_id", "parent_observation_id")


def req(metadata=None, litellm_metadata=None, headers=None):
    """Build a request_data dict shaped the way async_pre_call_hook receives it."""
    data = {"model": "gpt-4", "messages": [{"role": "user", "content": "hi"}]}
    if metadata is not None:
        data["metadata"] = metadata
    if litellm_metadata is not None:
        data["litellm_metadata"] = litellm_metadata
    if headers is not None:
        data["proxy_server_request"] = {
            "url": "http://gateway/chat/completions",
            "method": "POST",
            "headers": headers,
            "body": None,
        }
    return data


class TestTraceNamespaceWildcard(unittest.TestCase):
    """ADR-0006 §11 item 1 — the allowlist, not denylist, wildcard case."""

    def test_unnamed_trace_key_not_on_allowlist_is_stripped(self):
        d = req(metadata={"trace_totally_unforeseen_field": "leaked free text"})
        out = strip_untrusted_trace_metadata(d)
        self.assertNotIn("trace_totally_unforeseen_field", out["metadata"])

    def test_known_trace_id_is_stripped_via_the_prefix_rule_too(self):
        d = req(metadata={"trace_id": "caller-forged-id"})
        out = strip_untrusted_trace_metadata(d)
        self.assertNotIn("trace_id", out["metadata"])

    def test_allowlist_is_empty_by_default(self):
        """Regression: if this ever stops being empty, every wildcard test above
        silently loses coverage for whatever key got added."""
        self.assertEqual(TRACE_PREFIX_ALLOWLIST, frozenset())

    def test_a_non_trace_prefixed_key_survives(self):
        d = req(metadata={"user_id_for_billing": "acct-123"})
        out = strip_untrusted_trace_metadata(d)
        self.assertEqual(out["metadata"]["user_id_for_billing"], "acct-123")


class TestUnconditionalStrips(unittest.TestCase):
    """ADR-0006 §11 items 2, 3 and 5 — named fields, not the wildcard."""

    def test_metadata_prompt_is_stripped(self):
        d = req(metadata={"prompt": {"type": "text", "prompt": "leak me", "name": "x", "version": 1}})
        out = strip_untrusted_trace_metadata(d)
        self.assertNotIn("prompt", out["metadata"])

    def test_debug_langfuse_is_stripped(self):
        d = req(metadata={"debug_langfuse": True})
        out = strip_untrusted_trace_metadata(d)
        self.assertNotIn("debug_langfuse", out["metadata"])

    def test_each_identifier_field_is_stripped(self):
        for field in IDENTIFIER_FIELDS:
            with self.subTest(field=field):
                d = req(metadata={field: "spoofable-value"})
                out = strip_untrusted_trace_metadata(d)
                self.assertNotIn(field, out["metadata"], f"{field} must be stripped")

    def test_original_three_label_fields_still_stripped(self):
        """Carried forward from the first pass, not re-litigated here."""
        d = req(metadata={"session_id": "x", "generation_name": "y", "user_api_key_end_user_id": "z"})
        out = strip_untrusted_trace_metadata(d)
        for field in ("session_id", "generation_name", "user_api_key_end_user_id"):
            self.assertNotIn(field, out["metadata"])

    def test_all_unconditional_keys_covered_by_the_constant(self):
        """Every key this module claims to strip unconditionally, actually is —
        driven from the constant itself so the list and the behaviour cannot
        silently drift apart."""
        meta = {key: "value" for key in UNCONDITIONAL_STRIP_KEYS}
        d = req(metadata=meta)
        out = strip_untrusted_trace_metadata(d)
        self.assertEqual(out["metadata"], {})


class TestBothContainers(unittest.TestCase):
    def test_litellm_metadata_container_is_also_stripped(self):
        d = req(litellm_metadata={"prompt": "leak", "trace_foo": "leak"})
        out = strip_untrusted_trace_metadata(d)
        self.assertEqual(out["litellm_metadata"], {})

    def test_both_containers_stripped_independently(self):
        d = req(metadata={"prompt": "a"}, litellm_metadata={"debug_langfuse": True})
        out = strip_untrusted_trace_metadata(d)
        self.assertNotIn("prompt", out["metadata"])
        self.assertNotIn("debug_langfuse", out["litellm_metadata"])


class TestHeaderChannel(unittest.TestCase):
    """ADR-0006 §11 item 4 — the channel `add_metadata_from_header` reads,
    independently of the request body, and which OVERWRITES the body value for
    the same key. A body-only strip is defeated by this channel."""

    def test_langfuse_prefixed_header_for_a_stripped_key_does_not_survive(self):
        d = req(headers={"langfuse_trace_id": "header-forged-id"})
        out = strip_untrusted_trace_metadata(d)
        self.assertNotIn("langfuse_trace_id", out["proxy_server_request"]["headers"])

    def test_header_matching_is_case_insensitive(self):
        d = req(headers={"Langfuse-Session-Id".replace("-", "_"): "x", "LANGFUSE_PROMPT": "leak"})
        out = strip_untrusted_trace_metadata(d)
        headers = out["proxy_server_request"]["headers"]
        self.assertNotIn("Langfuse_Session_Id", headers)
        self.assertNotIn("LANGFUSE_PROMPT", headers)

    def test_same_key_sent_in_body_and_header_is_stripped_from_both(self):
        """The exact shadowing scenario ADR-0006 §11 names: litellm's own
        add_metadata_from_header lets a header OVERWRITE the body value for the
        same key, so stripping only the body leaves the header value to win."""
        d = req(
            metadata={"trace_id": "body-value"},
            headers={"langfuse_trace_id": "header-value-that-would-overwrite-body"},
        )
        out = strip_untrusted_trace_metadata(d)
        self.assertNotIn("trace_id", out["metadata"])
        self.assertNotIn("langfuse_trace_id", out["proxy_server_request"]["headers"])

    def test_non_langfuse_header_is_untouched(self):
        d = req(headers={"x-request-id": "keep-me", "langfuse_trace_id": "strip-me"})
        out = strip_untrusted_trace_metadata(d)
        headers = out["proxy_server_request"]["headers"]
        self.assertEqual(headers.get("x-request-id"), "keep-me")
        self.assertNotIn("langfuse_trace_id", headers)

    def test_langfuse_header_for_a_field_not_on_any_strip_list_survives(self):
        """The header path uses the same decision function as the body path —
        this would fail if header-stripping used a separate, broader rule."""
        d = req(headers={"langfuse_public_key": "not-a-stripped-field"})
        out = strip_untrusted_trace_metadata(d)
        self.assertIn("langfuse_public_key", out["proxy_server_request"]["headers"])


class TestPassThrough(unittest.TestCase):
    def test_request_with_none_of_the_fields_passes_through_unchanged(self):
        d = req(
            metadata={"user_id_for_billing": "acct-123", "team": "platform"},
            litellm_metadata={"some_other_field": 1},
            headers={"x-request-id": "abc", "content-type": "application/json"},
        )
        before = copy.deepcopy(d)
        out = strip_untrusted_trace_metadata(d)
        self.assertEqual(out, before)

    def test_missing_metadata_and_headers_does_not_raise(self):
        d = {"model": "gpt-4"}
        out = strip_untrusted_trace_metadata(d)
        self.assertEqual(out, {"model": "gpt-4"})

    def test_non_dict_request_data_returned_untouched(self):
        for bad in (None, "metadata", 7, [], object()):
            with self.subTest(request_data=bad):
                self.assertIs(strip_untrusted_trace_metadata(bad), bad)

    def test_non_dict_metadata_container_does_not_raise(self):
        for bad in ("{}", 42, [], None, True):
            with self.subTest(metadata=bad):
                d = {"metadata": bad}
                strip_untrusted_trace_metadata(d)  # must not raise


class TestRequesterMetadataCopy(unittest.TestCase):
    """CHG-2026-026: LiteLLM nests ``requester_metadata`` into the generation."""

    def test_prompt_inside_requester_metadata_is_stripped(self):
        data = {"metadata": {"requester_metadata": {"prompt": "SECRET TEXT", "app": "erp"}}}
        strip_untrusted_trace_metadata(data)
        self.assertEqual(data["metadata"]["requester_metadata"], {})

    def test_trace_keys_inside_requester_metadata_are_stripped(self):
        data = {"litellm_metadata": {"requester_metadata": {"trace_name": "x", "debug_langfuse": True}}}
        strip_untrusted_trace_metadata(data)
        self.assertEqual(data["litellm_metadata"]["requester_metadata"], {})

    def test_non_dict_requester_metadata_does_not_raise(self):
        data = {"metadata": {"requester_metadata": "not a dict"}}
        strip_untrusted_trace_metadata(data)
        self.assertEqual(data["metadata"]["requester_metadata"], "not a dict")


class TestModuleContract(unittest.TestCase):
    def test_module_imports_without_litellm(self):
        import cairo_trace_metadata_hook as m

        self.assertTrue(hasattr(m, "CairoTraceMetadataAllowlistHook"))
        self.assertTrue(callable(m.strip_untrusted_trace_metadata))

    def test_constructed_instance_actually_strips(self):
        """End-to-end on the real class, not just the bare function — the same
        distinction that caught cairo_guardrail_hook.py's constructor defect."""
        import asyncio

        h = CairoTraceMetadataAllowlistHook()
        d = req(metadata={"prompt": "leak", "trace_x": "leak"}, headers={"langfuse_trace_id": "leak"})
        out = asyncio.run(
            h.async_pre_call_hook(user_api_key_dict=None, cache=None, data=d, call_type="completion")
        )
        self.assertNotIn("prompt", out["metadata"])
        self.assertNotIn("trace_x", out["metadata"])
        self.assertNotIn("langfuse_trace_id", out["proxy_server_request"]["headers"])


class TestRequesterMetadataAllowlist(unittest.TestCase):
    """CHG-2026-054: caller free text in requester_metadata never reaches a trace."""

    def test_arbitrary_caller_key_is_removed(self):
        data = {"metadata": {"requester_metadata": {"residual_note": "free text"}}}
        strip_untrusted_trace_metadata(data)
        self.assertEqual(data["metadata"]["requester_metadata"], {})

    def test_caller_headers_copy_is_removed(self):
        data = {"metadata": {"requester_metadata": {"headers": {"langfuse_trace_name": "x", "user-agent": "y"}}}}
        strip_untrusted_trace_metadata(data)
        self.assertNotIn("headers", data["metadata"]["requester_metadata"])

    def test_litellm_metadata_container_is_covered(self):
        data = {"litellm_metadata": {"requester_metadata": {"note": "x"}}}
        strip_untrusted_trace_metadata(data)
        self.assertEqual(data["litellm_metadata"]["requester_metadata"], {})

    def test_gateway_written_fields_are_untouched(self):
        data = {"metadata": {"user_api_key_alias": "app-key", "user_api_key_team_id": "t1", "requester_metadata": {"note": "x"}}}
        strip_untrusted_trace_metadata(data)
        self.assertEqual(data["metadata"]["user_api_key_alias"], "app-key")
        self.assertEqual(data["metadata"]["user_api_key_team_id"], "t1")

    def test_allowlisted_key_survives(self):
        import cairo_trace_metadata_hook as m

        original = m.REQUESTER_METADATA_ALLOWLIST
        m.REQUESTER_METADATA_ALLOWLIST = frozenset({"app"})
        try:
            data = {"metadata": {"requester_metadata": {"app": "erp", "note": "x"}}}
            strip_untrusted_trace_metadata(data)
            self.assertEqual(data["metadata"]["requester_metadata"], {"app": "erp"})
        finally:
            m.REQUESTER_METADATA_ALLOWLIST = original

    def test_allowlist_is_empty_by_default(self):
        import cairo_trace_metadata_hook as m

        self.assertEqual(m.REQUESTER_METADATA_ALLOWLIST, frozenset())


class TestRegistrationInstance(unittest.TestCase):
    def test_config_references_an_instance_not_the_class(self):
        import cairo_trace_metadata_hook as m

        self.assertIsInstance(m.proxy_handler_instance, m.CairoTraceMetadataAllowlistHook)


if __name__ == "__main__":
    unittest.main(verbosity=2)
