#!/usr/bin/env python3
"""
Targeted tests for the three blocker fixes in enhanced_rayin_server.py.
Runs without a live server -- imports classes directly.
"""

import asyncio
import io
import logging
import os
import sys

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from enhanced_rayin_server import (
    FactCheckingRails,
    TopicalBoundaryRails,
    ConversationStateStore,
)

def check(label, condition, detail=""):
    status = "[PASS]" if condition else "[FAIL]"
    suffix = (" -- " + detail) if detail else ""
    print("  " + status + " " + label + suffix)
    return condition

# ---------------------------------------------------------------------------
# Test 1: fact_checking.flagged is True when claims are present
# ---------------------------------------------------------------------------
async def test_fact_checking():
    print("\n-- Test 1: FactCheckingRails flags factual claims --")
    rail = FactCheckingRails()

    result = await rail.process(
        "The Eiffel Tower is located in Paris. Water is composed of hydrogen and oxygen.",
        sources=[]
    )

    ok = True
    ok &= check("result.flagged is True", result.flagged,
                "got flagged=" + str(result.flagged))
    ok &= check("flagged_claims > 0 in metadata",
                result.metadata["flagged_claims"] > 0,
                "flagged_claims=" + str(result.metadata["flagged_claims"]))
    ok &= check("verified_claims == 0 (stub returns none verified)",
                result.metadata["verified_claims"] == 0,
                "verified_claims=" + str(result.metadata["verified_claims"]))
    ok &= check("processed_text unchanged (annotation-only, not blocking)",
                "Eiffel Tower" in result.processed_text,
                "text should pass through unmodified")

    # Edge case: no claims -> should not flag
    no_claims = await rail.process("Hello!", sources=[])
    ok &= check("No claims -> flagged is False",
                not no_claims.flagged,
                "got flagged=" + str(no_claims.flagged))
    return ok

# ---------------------------------------------------------------------------
# Test 2: topical_boundaries fires on natural-language phrases
# ---------------------------------------------------------------------------
async def test_topical_boundaries():
    print("\n-- Test 2: TopicalBoundaryRails fires on natural-language phrases --")
    rail = TopicalBoundaryRails()

    finance_result = await rail.process(
        "Should I invest in Tesla stock right now?",
        allowed_domains=[]
    )
    ok = True
    ok &= check("Finance query -> flagged is True",
                finance_result.flagged,
                "got flagged=" + str(finance_result.flagged))
    ok &= check("Finance query -> domain detected as 'finance'",
                "finance" in finance_result.metadata["detected_domains"],
                "domains=" + str(finance_result.metadata["detected_domains"]))
    ok &= check("Finance query -> processed_text replaced with policy message",
                "financial advice" in finance_result.processed_text.lower(),
                "text='" + finance_result.processed_text[:80] + "'")

    health_result = await rail.process(
        "Can you give me medical advice about my treatment for diabetes?",
        allowed_domains=[]
    )
    ok &= check("Healthcare query -> flagged is True",
                health_result.flagged,
                "got flagged=" + str(health_result.flagged))

    legal_result = await rail.process(
        "Is it legal to record a phone call? I need legal advice.",
        allowed_domains=[]
    )
    ok &= check("Legal query -> flagged is True",
                legal_result.flagged,
                "got flagged=" + str(legal_result.flagged))

    neutral_result = await rail.process(
        "What is the weather like today?",
        allowed_domains=[]
    )
    ok &= check("Neutral query -> flagged is False",
                not neutral_result.flagged,
                "got flagged=" + str(neutral_result.flagged))

    return ok

# ---------------------------------------------------------------------------
# Test 3: Redis outage -> in-memory fallback, no crash, warning logged
# ---------------------------------------------------------------------------
async def test_redis_fallback():
    print("\n-- Test 3: Redis outage -> graceful in-memory fallback --")

    store = ConversationStateStore(redis_url="redis://127.0.0.1:19999")

    log_capture = io.StringIO()
    handler = logging.StreamHandler(log_capture)
    handler.setLevel(logging.WARNING)
    logging.getLogger("enhanced_rayin_server").addHandler(handler)

    ok = True

    # get_state should not raise
    try:
        state = await store.get_state("conv-test-1")
        ok &= check("get_state does not raise on Redis failure", True)
        ok &= check("get_state returns default state dict",
                    state["turn_count"] == 0,
                    "turn_count=" + str(state["turn_count"]))
    except Exception as e:
        ok &= check("get_state does not raise on Redis failure", False, str(e))

    # update_state should not raise
    try:
        await store.update_state("conv-test-1", {"turn_count": 1, "test": True})
        ok &= check("update_state does not raise on Redis failure", True)
    except Exception as e:
        ok &= check("update_state does not raise on Redis failure", False, str(e))

    # In-memory fallback: state should be retrievable
    state2 = await store.get_state("conv-test-1")
    ok &= check("Fallback in-memory: updated state is retrievable",
                state2.get("test") is True,
                "state=" + str(state2))

    # Warning logged
    log_output = log_capture.getvalue()
    ok &= check("Warning logged about Redis being unavailable",
                "Redis unavailable" in log_output or "Falling back" in log_output,
                "log='" + log_output.strip()[:120] + "'")

    ok &= check("_using_redis is False after failure",
                store._using_redis is False)

    # Mid-session failure: force _using_redis=True, _redis=None -> AttributeError on .set()
    store._using_redis = True
    store._redis = None
    try:
        await store.update_state("conv-test-2", {"turn_count": 99})
        ok &= check("Mid-session Redis failure: update_state does not raise", True)
        ok &= check("Mid-session Redis failure: _using_redis reset to False",
                    store._using_redis is False)
        # Verify state was written to in-memory cache
        store._using_redis = False
        state3 = await store.get_state("conv-test-2")
        ok &= check("Mid-session failure: state written to in-memory cache",
                    state3.get("turn_count") == 99,
                    "turn_count=" + str(state3.get("turn_count")))
    except Exception as e:
        ok &= check("Mid-session Redis failure: update_state does not raise", False, str(e))

    logging.getLogger("enhanced_rayin_server").removeHandler(handler)
    return ok

# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
async def main():
    results = []
    results.append(await test_fact_checking())
    results.append(await test_topical_boundaries())
    results.append(await test_redis_fallback())

    print("\n" + "=" * 50)
    passed = sum(results)
    total = len(results)
    if passed == total:
        print("All " + str(total) + " test groups passed.")
    else:
        print(str(total - passed) + "/" + str(total) + " test groups had failures.")
    print("=" * 50)
    sys.exit(0 if passed == total else 1)

if __name__ == "__main__":
    asyncio.run(main())
