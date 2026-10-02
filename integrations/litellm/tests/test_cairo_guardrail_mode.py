"""ADR-0005-B part b, phase 2 (CHG-2026-089): the mode comes from the verdicts,
within the deployment ceiling. Proven on a bare Python, no network.

Run from the repository root::

    python -m unittest discover -s integrations/litellm/tests -v

Covers ADR-0005-B §3.3, its table, tests B1, B10 and B11 at the hook, the
"no verdict: judge unavailable" rule (Readiness Ledger N-64, owner decision
2026-10-02), what each replica reports (build decision C1), and the
switch-back time (SF-2026-024).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config")
)

import cairo_guardrail_hook as m  # noqa: E402


def answer(action=None, mode="record", version=1, status="applied", revert_at=None, **extra):
    """A verdict (with ``action``) or, with ``action=None``, a judge-unavailable answer."""
    body = {"settings_status": status, "settings_version": version, "mode": mode, **extra}
    if revert_at is not None:
        body["revert_at"] = revert_at
    if action is None:
        body.update({"verdict": "none", "reason": "judge_unavailable", "cause": "rate_limited"})
    else:
        body["action"] = action
    return body


def iso(moment):
    return moment.isoformat().replace("+00:00", "Z")


def request_data():
    return {"metadata": {"user_api_key_metadata": {}, "user_api_key_alias": "hr-bot"}}


class Hook:
    """A CairoGuardrail with the I/O seam replaced by a queue of answers."""

    def __init__(self, ceiling="enforce", answers=()):
        self.g = m.CairoGuardrail()
        self.g.ceiling = ceiling
        self.g.guard_secret = "test-secret"
        self.answers = list(answers)
        self.calls = []

        async def fake_post(payload):
            self.calls.append(dict(payload))
            return self.answers.pop(0) if self.answers else None

        self.g._post_guard = fake_post

    def run(self, inputs="hello"):
        return asyncio.run(self.g.apply_guardrail(inputs=inputs, request_data=request_data()))

    def refused(self, inputs="hello"):
        try:
            self.run(inputs)
        except m.CairoGuardrailBlocked as exc:
            return str(exc)
        return None


class TestCeiling(unittest.TestCase):
    def test_unset_means_record(self):
        self.assertEqual(m.read_ceiling({}), "record")

    def test_only_exactly_enforce_allows_enforce(self):
        self.assertEqual(m.read_ceiling({m.CEILING_ENV: "enforce"}), "enforce")
        self.assertEqual(m.read_ceiling({m.CEILING_ENV: " Enforce "}), "enforce")
        for value in ("record", "enforced", "on", "true", "block", ""):
            with self.subTest(value=value):
                self.assertEqual(m.read_ceiling({m.CEILING_ENV: value}), "record")

    def test_the_older_setting_is_read_as_the_ceiling_when_the_new_one_is_unset(self):
        self.assertEqual(m.read_ceiling({m.LEGACY_MODE_ENV: "enforce"}), "enforce")
        self.assertEqual(m.read_ceiling({m.LEGACY_MODE_ENV: "record"}), "record")

    def test_the_new_setting_wins(self):
        env = {m.CEILING_ENV: "record", m.LEGACY_MODE_ENV: "enforce"}
        self.assertEqual(m.read_ceiling(env), "record")

    def test_a_constructed_hook_reads_the_environment(self):
        saved = {k: os.environ.get(k) for k in (m.CEILING_ENV, m.LEGACY_MODE_ENV)}
        try:
            os.environ.pop(m.LEGACY_MODE_ENV, None)
            os.environ.pop(m.CEILING_ENV, None)
            self.assertEqual(m.CairoGuardrail().ceiling, "record")
            os.environ[m.CEILING_ENV] = "enforce"
            self.assertEqual(m.CairoGuardrail().ceiling, "enforce")
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def test_record_ceiling_never_enforces_whatever_the_console_says(self):
        """B1 at the hook: enforce requested, record ceiling, record behaviour."""
        hook = Hook(ceiling="record", answers=[answer("block", mode="enforce", version=3)])
        self.assertIsNone(hook.refused(), "a record ceiling must never refuse")
        self.assertEqual(hook.g.current_mode(), "record")


class TestSettingsLabels(unittest.TestCase):
    def test_applied_labels_are_read(self):
        self.assertEqual(m.settings_labels(answer("allow", mode="record", version=4)),
                         m.Labels(4, "record", None, True))

    def test_unusable_labels_are_none(self):
        for body in (
            None,
            "allow",
            {"action": "allow"},
            answer("allow", status="unknown"),
            answer("allow", version=0),
            answer("allow", version=True),
            answer("allow", version="4"),
            answer("allow", version=m.MAX_SETTINGS_VERSION + 1),
            answer("allow", mode="block"),
        ):
            with self.subTest(body=body):
                self.assertIsNone(m.settings_labels(body))

    def test_revert_at_counts_on_enforce_only(self):
        later = datetime.now(timezone.utc) + timedelta(minutes=30)
        version, mode, revert_at, _ = m.settings_labels(
            answer("allow", mode="enforce", version=2, revert_at=iso(later)))
        self.assertEqual(mode, "enforce")
        self.assertIsNotNone(revert_at)
        self.assertIsNone(m.settings_labels(
            answer("allow", mode="record", version=2, revert_at=iso(later)))[2])

    def test_a_malformed_revert_at_makes_the_labels_unusable(self):
        """P2-268-3: never run a trial with no end it was given."""
        for bad in ("tomorrow", "2026-10-02T12:00:00", "x" * 41, 12345):
            with self.subTest(bad=bad):
                self.assertIsNone(
                    m.settings_labels(answer("allow", mode="enforce", revert_at=bad)))

    def test_an_absent_revert_at_is_no_switch_back(self):
        labels = m.settings_labels(answer("allow", mode="enforce"))
        self.assertIsNotNone(labels)
        self.assertIsNone(labels.revert_at)

    def test_stale_settings_are_read_but_not_fresh(self):
        labels = m.settings_labels(answer("allow", mode="record", status="stale"))
        self.assertEqual(labels, m.Labels(1, "record", None, False))


class TestModeTracker(unittest.TestCase):
    def test_starts_with_no_mode(self):
        self.assertIsNone(m.ModeTracker().desired())

    def test_a_newer_version_sets_the_mode(self):
        t = m.ModeTracker()
        self.assertTrue(t.observe(m.Labels(1, "record", None)))
        self.assertTrue(t.observe(m.Labels(2, "enforce", None)))
        self.assertEqual((t.version, t.desired()), (2, "enforce"))

    def test_an_older_version_cannot_change_the_mode(self):
        """B11 at the tracker: a stale pod does not lower the mode."""
        t = m.ModeTracker()
        t.observe(m.Labels(5, "enforce", None))
        self.assertFalse(t.observe(m.Labels(4, "record", None)))
        self.assertEqual((t.version, t.desired()), (5, "enforce"))

    def test_unusable_labels_change_nothing(self):
        t = m.ModeTracker()
        t.observe(m.Labels(3, "enforce", None))
        self.assertFalse(t.observe(None))
        self.assertEqual(t.desired(), "enforce")

    def test_at_the_same_version_a_trial_may_end(self):
        t = m.ModeTracker()
        t.observe(m.Labels(7, "enforce", datetime.now(timezone.utc) + timedelta(minutes=30)))
        self.assertTrue(t.observe(m.Labels(7, "record", None)))
        self.assertEqual(t.desired(), "record")

    def test_at_the_same_version_record_never_becomes_enforce(self):
        t = m.ModeTracker()
        t.observe(m.Labels(7, "record", None))
        self.assertTrue(t.observe(m.Labels(7, "enforce", None)))
        self.assertEqual(t.desired(), "record", "a pod that pulled before the trial ended")

    def test_a_trial_ends_at_its_switch_back_time_without_any_answer(self):
        t = m.ModeTracker()
        ends = datetime.now(timezone.utc) + timedelta(minutes=5)
        t.observe(m.Labels(8, "enforce", ends))
        self.assertEqual(t.desired(ends - timedelta(seconds=1)), "enforce")
        self.assertEqual(t.desired(ends), "record")

    def test_the_same_trial_adopts_its_switch_back_time(self):
        t = m.ModeTracker()
        t.observe(m.Labels(8, "enforce", None))
        ends = datetime.now(timezone.utc) + timedelta(minutes=5)
        t.observe(m.Labels(8, "enforce", ends))
        self.assertEqual(t.revert_at, ends)


class TestDecisionMode(unittest.TestCase):
    def test_the_ceiling_bounds_the_mode(self):
        self.assertEqual(m.decision_mode("record", "enforce"), "record")
        self.assertEqual(m.decision_mode("record", None), "record")
        self.assertEqual(m.decision_mode("enforce", "record"), "record")
        self.assertEqual(m.decision_mode("enforce", "enforce"), "enforce")

    def test_no_mode_seen_under_an_enforce_ceiling_fails_closed(self):
        self.assertEqual(m.decision_mode("enforce", None), "enforce")


class TestAdr0005bTable(unittest.TestCase):
    """ADR-0005-B §3.3's table, row by row, through the real class."""

    def test_guard_allows_always_proceeds(self):
        for ceiling, console in (("record", "record"), ("enforce", "record"),
                                 ("enforce", "enforce")):
            with self.subTest(ceiling=ceiling, console=console):
                self.assertIsNone(Hook(ceiling, [answer("allow", mode=console)]).refused())

    def test_guard_blocks(self):
        self.assertIsNone(Hook("record", [answer("block", mode="enforce")]).refused())
        self.assertIsNone(Hook("enforce", [answer("block", mode="record")]).refused())
        self.assertIsNotNone(Hook("enforce", [answer("block", mode="enforce")]).refused())

    def test_guard_redacts(self):
        verdict = dict(answer("redact", mode="record"), redacted_text="<EMAIL>")
        self.assertEqual(Hook("enforce", [verdict]).run("me@x.com"), "me@x.com")
        verdict = dict(answer("redact", mode="enforce"), redacted_text="<EMAIL>")
        self.assertEqual(Hook("enforce", [verdict]).run("me@x.com"), "<EMAIL>")
        self.assertEqual(Hook("record", [verdict]).run("me@x.com"), "me@x.com")

    def test_guard_unavailable_follows_the_last_mode_seen(self):
        hook = Hook("enforce", [answer("allow", mode="enforce"), None])
        hook.run()
        self.assertIsNotNone(hook.refused(), "last mode enforce: refuse")
        hook = Hook("enforce", [answer("allow", mode="record"), None])
        hook.run()
        self.assertIsNone(hook.refused(), "last mode record: proceed")

    def test_guard_unavailable_with_no_mode_seen_lets_the_ceiling_decide(self):
        self.assertIsNotNone(Hook("enforce", [None]).refused())
        self.assertIsNone(Hook("record", [None]).refused())


class TestJudgeUnavailableRule(unittest.TestCase):
    """Readiness Ledger N-64, owner decision 2026-10-02."""

    def test_record_mode_proceeds_and_logs_judge_unavailable(self):
        outcome, mode = m.CairoGuardrail().judge(answer(None, mode="record"))
        self.assertEqual(mode, "record")
        self.assertEqual(outcome, m.GuardOutcome(True, None, m.JUDGE_UNAVAILABLE))

    def test_enforce_mode_refuses_with_its_own_code_and_message(self):
        hook = Hook("enforce", [answer(None, mode="enforce", version=2)])
        message = hook.refused()
        self.assertIsNotNone(message)
        self.assertIn("(judge_unavailable)", message)
        self.assertIn("could not check this request", message)

    def test_it_is_not_confused_with_a_plain_guard_outage(self):
        g = m.CairoGuardrail()
        g.ceiling = "enforce"
        outcome, _ = g.judge(answer(None, mode="enforce"))
        self.assertEqual(outcome.event, "judge_unavailable")
        outcome, _ = g.judge(None)
        self.assertEqual(outcome.event, "guard_unavailable")

    def test_its_labels_still_carry_the_mode(self):
        """The settings do not depend on the judge, so the mode still moves."""
        g = m.CairoGuardrail()
        g.ceiling = "enforce"
        g.judge(answer(None, mode="enforce", version=4))
        self.assertEqual((g.tracker.version, g.current_mode()), (4, "enforce"))
        outcome, mode = g.judge(answer(None, mode="record", version=5))
        self.assertEqual(mode, "record")
        self.assertTrue(outcome.proceed, "record mode proceeds even without a verdict")

    def test_post_guard_returns_the_503_no_verdict_body(self):
        body = answer(None, mode="record", version=3)

        class Response:
            status_code = 503

            def json(self):
                return body

        class Client:
            def __init__(self, *a, **k):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, *a, **k):
                return Response()

        g = m.CairoGuardrail()
        g.guard_secret = "test-secret"
        saved = (m.httpx, m._HTTPX_AVAILABLE)
        try:
            m.httpx = type("FakeHttpx", (), {"AsyncClient": Client})
            m._HTTPX_AVAILABLE = True
            got = asyncio.run(g._post_guard({"agent_id": "a", "direction": "input", "text": "t"}))
            self.assertEqual(got, body)
            body.clear()
            body.update({"detail": "Service Unavailable"})
            got = asyncio.run(g._post_guard({"agent_id": "a", "direction": "input", "text": "t"}))
            self.assertIsNone(got, "any other 503 is a plain outage")
        finally:
            m.httpx, m._HTTPX_AVAILABLE = saved


class TestUnsyncedAndStalePods(unittest.TestCase):
    def test_b10_an_unsynced_pod_cannot_let_a_request_through_in_enforce(self):
        hook = Hook("enforce", [answer("allow", mode="enforce", version=6),
                                {"action": "allow", "settings_status": "unknown",
                                 "settings_version": None, "mode": None}])
        hook.run()
        message = hook.refused()
        self.assertIsNotNone(message)
        self.assertIn("settings_unusable", message)
        self.assertEqual(hook.g.current_mode(), "enforce", "the mode is not lowered")

    def test_b10_in_record_mode_an_unsynced_verdict_is_still_recorded(self):
        hook = Hook("record", [{"action": "block", "settings_status": "unknown"}])
        self.assertIsNone(hook.refused())

    def test_b11_a_stale_pod_cannot_lower_the_mode(self):
        hook = Hook("enforce", [
            answer("allow", mode="enforce", version=3),
            answer("allow", mode="record", version=4),
            answer("allow", mode="enforce", version=5),
            answer("allow", mode="record", version=4),
        ])
        for _ in range(3):
            hook.run()
        self.assertIsNotNone(hook.refused(), "a version-4 verdict is stale after version 5")
        self.assertEqual(hook.g.current_mode(), "enforce")

    def test_an_older_guardrails_without_labels_is_refused_only_in_enforce(self):
        self.assertIsNotNone(Hook("enforce", [{"action": "allow"}]).refused())
        self.assertIsNone(Hook("record", [{"action": "allow"}]).refused())


class TestTrialEndsOnTime(unittest.TestCase):
    def test_the_gateway_ends_a_trial_when_no_verdict_arrives(self):
        """ADR-0005-B §8's known limit, closed: guardrails down past revert_at."""
        g = m.CairoGuardrail()
        g.ceiling = "enforce"
        ended = iso(datetime.now(timezone.utc) - timedelta(seconds=1))
        g.tracker.observe(m.Labels(9, "enforce", m._parse_utc(ended)))
        outcome, mode = g.judge(None)
        self.assertEqual(mode, "record")
        self.assertTrue(outcome.proceed)

    def test_a_running_trial_still_enforces(self):
        g = m.CairoGuardrail()
        g.ceiling = "enforce"
        later = iso(datetime.now(timezone.utc) + timedelta(minutes=10))
        outcome, mode = g.judge(answer("block", mode="enforce", version=9, revert_at=later))
        self.assertEqual(mode, "enforce")
        self.assertFalse(outcome.proceed)


class TestWhatEachReplicaReports(unittest.TestCase):
    def test_every_call_carries_the_replica_state(self):
        saved = os.environ.get("POD_NAME")
        try:
            os.environ["POD_NAME"] = "litellm-7c9d8f6b5-abcde"
            hook = Hook("enforce", [answer("allow", mode="enforce", version=12), None])
            hook.run()
            first = hook.calls[0]
            self.assertEqual(first["gateway_pod"], "litellm-7c9d8f6b5-abcde")
            self.assertEqual(first["gateway_mode"], "enforce", "no mode seen: the ceiling")
            self.assertNotIn("gateway_settings_version", first, "no version seen yet")
            hook.refused()
            second = hook.calls[1]
            self.assertEqual(second["gateway_mode"], "enforce")
            self.assertEqual(second["gateway_settings_version"], 12)
        finally:
            if saved is None:
                os.environ.pop("POD_NAME", None)
            else:
                os.environ["POD_NAME"] = saved

    def test_a_pod_name_that_is_not_a_dns_label_is_not_sent(self):
        self.assertIsNone(m.gateway_pod_name({"POD_NAME": "Not A Label!", "HOSTNAME": ""}))
        self.assertEqual(m.gateway_pod_name({"HOSTNAME": "litellm-0"}), "litellm-0")


class TestHealthLogExplainsTheMode(unittest.TestCase):
    def test_the_line_carries_ceiling_version_and_refusal(self):
        hook = Hook("enforce", [answer(None, mode="enforce", version=2)])
        captured = []

        class Sink(logging.Handler):
            def emit(self, record):
                captured.append(record.getMessage())

        handler = Sink()
        m.log.addHandler(handler)
        try:
            hook.refused()
        finally:
            m.log.removeHandler(handler)
        lines = [json.loads(c) for c in captured if m.HEALTH_LOG_EVENT in c]
        self.assertEqual(len(lines), 1)
        line = lines[0]
        self.assertEqual(line["outcome"], "judge_unavailable")
        self.assertEqual(line["mode"], "enforce")
        self.assertEqual(line["ceiling"], "enforce")
        self.assertEqual(line["settings_version"], 2)
        self.assertTrue(line["refused"])

    def test_enforce_requested_under_a_record_ceiling_is_logged_once(self):
        hook = Hook("record", [answer("allow", mode="enforce", version=3)] * 3)
        captured = []

        class Sink(logging.Handler):
            def emit(self, record):
                if record.levelno >= logging.WARNING:
                    captured.append(record.getMessage())

        handler = Sink()
        m.log.addHandler(handler)
        try:
            for _ in range(3):
                hook.run()
        finally:
            m.log.removeHandler(handler)
        warnings = [c for c in captured if "asks for enforce" in c]
        self.assertEqual(len(warnings), 1)



class TestStaleSettingsCannotMoveTheMode(unittest.TestCase):
    """Security review P2-268-1: a guardrails pod cut off from CAIRO cannot
    put a replica into record."""

    def test_a_just_started_replica_does_not_adopt_stale_settings(self):
        t = m.ModeTracker()
        self.assertFalse(t.observe(m.Labels(9, "record", None, False)))
        self.assertIsNone(t.desired())

    def test_stale_settings_cannot_move_to_a_newer_version(self):
        t = m.ModeTracker()
        t.observe(m.Labels(9, "enforce", None))
        self.assertFalse(t.observe(m.Labels(10, "record", None, False)))
        self.assertEqual((t.version, t.desired()), (9, "enforce"))

    def test_stale_settings_cannot_lower_the_mode_at_the_same_version(self):
        t = m.ModeTracker()
        t.observe(m.Labels(9, "enforce", None))
        self.assertFalse(t.observe(m.Labels(9, "record", None, False)))
        self.assertEqual(t.desired(), "enforce")

    def test_a_stale_enforce_at_a_newer_version_raises_the_mode(self):
        """Re-check P2R-268-2: raising is the safe direction."""
        t = m.ModeTracker()
        t.observe(m.Labels(9, "record", None))
        self.assertTrue(t.observe(m.Labels(10, "enforce", None, False)))
        self.assertEqual((t.version, t.desired()), (10, "enforce"))

    def test_a_just_started_replica_adopts_a_stale_enforce(self):
        t = m.ModeTracker()
        self.assertTrue(t.observe(m.Labels(10, "enforce", None, False)))
        self.assertEqual(t.desired(), "enforce")

    def test_a_stale_enforce_at_the_same_version_never_overrides_a_record(self):
        """A pod that pulled before the trial ended."""
        t = m.ModeTracker()
        t.observe(m.Labels(9, "record", None))
        self.assertFalse(t.observe(m.Labels(9, "enforce", None, False)))
        self.assertEqual(t.desired(), "record")

    def test_stale_settings_can_confirm_the_mode_held(self):
        t = m.ModeTracker()
        t.observe(m.Labels(9, "enforce", None))
        self.assertTrue(t.observe(m.Labels(9, "enforce", None, False)))

    def test_the_reviewers_scenario_end_to_end(self):
        """Ceiling enforce, a replica just restarted, the first answer from a
        pod cut off from CAIRO at an older record version: refused, and the
        replica stays fail-closed until a fresh answer arrives."""
        hook = Hook("enforce", [
            answer("block", mode="record", version=9, status="stale"),
            answer("block", mode="enforce", version=10),
        ])
        self.assertIn("settings_unusable", hook.refused())
        self.assertIsNone(hook.g.tracker.desired())
        self.assertEqual(hook.g.current_mode(), "enforce")
        self.assertIn("blocked", hook.refused())
        self.assertEqual(hook.g.tracker.version, 10)


if __name__ == "__main__":
    unittest.main(verbosity=2)
