"""CAIRO request-log callback for the LiteLLM gateway (ADR-0003, CHG-2026-009).

Pushes one metadata record per gateway request to CAIRO's receiver,
POST /api/public/litellm-request-logs.

Why a module and not the plain `generic_api` callback name: on LiteLLM 1.100.1
the plain name builds the logger with max_retries=0, and the logger clears its
queue after every send, so a batch whose POST fails is dropped at once. This
builds the SAME open-source logger with retries, a timeout and the header taken
from the environment. Verified 2026-09-19 in a throwaway pod on the pinned
image: the module loads from beside the config file and retried through two
503s. It is still best-effort: after the last retry the batch is dropped, and
CAIRO's scheduled reconciliation recovers it from the gateway's spend logs.

This file must sit in the same directory as litellm-config.yaml (same
ConfigMap). It holds no secret: both values come from the pod's environment.
"""

import os

from litellm.integrations.generic_api.generic_api_callback import GenericAPILogger

cairo_request_log = GenericAPILogger(
    # e.g. http://langfuse-web.langfuse.svc.cluster.local:3000/api/public/litellm-request-logs
    endpoint=os.environ["CAIRO_REQUEST_LOG_ENDPOINT"],
    # The receiver accepts only this bearer secret (CAIRO_LITELLM_INGEST_SECRET
    # on the CAIRO side). Passed as a constructor argument, not through
    # GENERIC_LOGGER_HEADERS.
    headers={"Authorization": "Bearer " + os.environ["CAIRO_INGEST_SECRET"]},
    event_types=["llm_api_success", "llm_api_failure"],
    # 1 s, 2 s, 4 s: covers a CAIRO web pod restart, not an outage.
    max_retries=3,
    retry_delay=1.0,
    timeout=10.0,
)
