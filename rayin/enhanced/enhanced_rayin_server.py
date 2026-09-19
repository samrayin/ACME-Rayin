#!/usr/bin/env python3
"""
Enhanced RAYIN + NeMo Guardrails Integration
Complete AI Safety Platform with Dialog Management, Fact-Checking, and Custom Rules
"""

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import List, Dict, Optional, Any, Union
from enum import Enum
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

class GuardrailType(Enum):
    """Types of guardrails available in enhanced RAYIN"""
    JAILBREAK_DETECTION = "jailbreak_detection"
    PII_REDACTION = "pii_redaction"
    DIALOG_MANAGEMENT = "dialog_management"
    FACT_CHECKING = "fact_checking"
    TOPICAL_BOUNDARIES = "topical_boundaries"
    CUSTOM_RULES = "custom_rules"
    RAG_GUARDRAILS = "rag_guardrails"

class GuardrailRequest(BaseModel):
    """Enhanced request model for RAYIN + NeMo capabilities"""
    text: str = Field(..., description="Input text to process")
    conversation_id: Optional[str] = Field(None, description="Conversation session ID")
    guardrails: List[str] = Field(default_factory=list, description="Guardrails to apply")
    context: Dict[str, Any] = Field(default_factory=dict, description="Conversation context")
    rules: Dict[str, Any] = Field(default_factory=dict, description="Custom rules and configuration")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Request metadata")

class GuardrailResponse(BaseModel):
    """Enhanced response model with comprehensive guardrails results"""
    status: str = Field(..., description="Processing status")
    flagged: bool = Field(..., description="Whether content was flagged")
    processed_text: str = Field(..., description="Processed and safe text")
    guardrails_results: Dict[str, Any] = Field(..., description="Results from each guardrail")
    conversation_state: Dict[str, Any] = Field(default_factory=dict, description="Updated conversation state")
    processing_metrics: Dict[str, Any] = Field(..., description="Performance and timing metrics")

@dataclass
class RailResult:
    """Result from individual rail processing"""
    rail_type: str
    flagged: bool
    confidence: float
    processed_text: str
    metadata: Dict[str, Any]
    processing_time_ms: int

class ConversationStateStore:
    """Manages conversation state persistence.

    Uses Redis when available (REDIS_URL env var or redis_url param).
    Falls back to in-memory dict with a warning — in-memory state is NOT
    shared across replicas and is lost on restart.

    If Redis drops mid-session, the next call falls back to in-memory for
    that request and schedules a reconnect attempt after _RETRY_INTERVAL.
    """

    _RETRY_INTERVAL = 60  # seconds between reconnection attempts

    def __init__(self, redis_url: str = None):
        self.redis_url = redis_url or os.environ.get("REDIS_URL", "redis://localhost:6379")
        self._redis = None
        self._cache = {}            # in-memory fallback only
        self._using_redis = False
        self._connect_attempted_at = None   # None = never tried

    async def _ensure_connected(self) -> None:
        """Connect to Redis on first call; retry at most every _RETRY_INTERVAL seconds."""
        if self._using_redis:
            return  # already connected and healthy

        now = time.time()
        if self._connect_attempted_at is not None:
            if now - self._connect_attempted_at < self._RETRY_INTERVAL:
                return  # back-off: don't hammer a down Redis
        self._connect_attempted_at = now  # stamp before attempt so timeout counts against window

        try:
            import redis.asyncio as aioredis
            client = aioredis.from_url(self.redis_url, socket_connect_timeout=2)
            await client.ping()
            self._redis = client
            self._using_redis = True
            logger.info("ConversationStateStore: connected to Redis at %s", self.redis_url)
        except Exception as exc:
            logger.warning(
                "ConversationStateStore: Redis unavailable (%s). "
                "Falling back to in-memory store — state will NOT persist across "
                "restarts or replicas. Will retry in %ds.",
                exc,
                self._RETRY_INTERVAL,
            )

    def _on_redis_failure(self, exc: Exception, operation: str) -> None:
        """Handle a mid-session Redis failure: reset state and log."""
        logger.warning(
            "ConversationStateStore: Redis %s failed (%s). "
            "Falling back to in-memory for this call; will retry Redis in %ds.",
            operation, exc, self._RETRY_INTERVAL,
        )
        self._using_redis = False
        self._redis = None
        self._connect_attempted_at = None   # reset so backoff starts from now on next call

    async def get_state(self, conversation_id: str) -> Dict[str, Any]:
        """Retrieve conversation state."""
        await self._ensure_connected()

        default_state = {
            "turn_count": 0,
            "context_summary": "",
            "user_intent": "unknown",
            "conversation_history": [],
            "created_at": time.time(),
            "last_updated": time.time(),
        }

        if self._using_redis:
            try:
                raw = await self._redis.get(f"rayin:conv:{conversation_id}")
                if raw:
                    return json.loads(raw)
                return default_state
            except Exception as exc:
                self._on_redis_failure(exc, "GET")
                # fall through to in-memory

        return self._cache.get(conversation_id, default_state)

    async def update_state(self, conversation_id: str, state: Dict[str, Any]) -> None:
        """Persist conversation state."""
        await self._ensure_connected()

        state["last_updated"] = time.time()

        if self._using_redis:
            try:
                # TTL of 24h — conversations older than that are stale anyway.
                await self._redis.set(
                    f"rayin:conv:{conversation_id}",
                    json.dumps(state),
                    ex=86400,
                )
                return
            except Exception as exc:
                self._on_redis_failure(exc, "SET")
                # fall through to in-memory

        self._cache[conversation_id] = state

class ContextTracker:
    """Tracks conversation context and intent"""

    async def update(self, current_state: Dict[str, Any], new_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Update context with new conversation turn"""
        updated_state = current_state.copy()

        # Update turn count
        updated_state["turn_count"] += 1

        # Add to conversation history
        if "conversation_history" not in updated_state:
            updated_state["conversation_history"] = []

        updated_state["conversation_history"].append({
            "turn": updated_state["turn_count"],
            "text": new_text,
            "timestamp": time.time(),
            "context": context
        })

        # Keep only last 10 turns for performance
        if len(updated_state["conversation_history"]) > 10:
            updated_state["conversation_history"] = updated_state["conversation_history"][-10:]

        # Update context summary
        updated_state["context_summary"] = self._generate_context_summary(updated_state["conversation_history"])

        # Detect user intent
        updated_state["user_intent"] = await self._detect_intent(new_text, updated_state["conversation_history"])

        return updated_state

    def _generate_context_summary(self, history: List[Dict[str, Any]]) -> str:
        """Generate a summary of conversation context"""
        if not history:
            return "New conversation"

        recent_turns = history[-3:]  # Last 3 turns
        topics = []

        for turn in recent_turns:
            # Simple keyword extraction (in production, use NLP)
            text_lower = turn["text"].lower()
            if any(word in text_lower for word in ["help", "assist", "support"]):
                topics.append("seeking_assistance")
            elif any(word in text_lower for word in ["information", "know", "explain"]):
                topics.append("information_seeking")
            elif any(word in text_lower for word in ["problem", "issue", "error"]):
                topics.append("problem_solving")

        return f"Recent topics: {', '.join(set(topics)) if topics else 'general_conversation'}"

    async def _detect_intent(self, text: str, history: List[Dict[str, Any]]) -> str:
        """Detect user intent from current text and history"""
        text_lower = text.lower()

        if any(word in text_lower for word in ["help", "how", "can you", "please"]):
            return "assistance_request"
        elif any(word in text_lower for word in ["what", "who", "when", "where", "why"]):
            return "information_seeking"
        elif any(word in text_lower for word in ["thank", "thanks", "bye", "goodbye"]):
            return "conversation_ending"
        else:
            return "general_interaction"

class ColangExecutionEngine:
    """Simplified Colang execution engine for conversation flow"""

    def __init__(self):
        self.rules = self._load_default_rules()

    def _load_default_rules(self) -> Dict[str, Any]:
        """Load default Colang rules"""
        return {
            "greeting_flow": {
                "triggers": ["hello", "hi", "hey"],
                "response_type": "friendly_greeting",
                "next_state": "engaged"
            },
            "help_request": {
                "triggers": ["help", "assist", "support"],
                "response_type": "assistance_offer",
                "next_state": "helping"
            },
            "safety_check": {
                "triggers": ["unsafe", "harmful", "inappropriate"],
                "response_type": "safety_escalation",
                "guardrails": ["enhanced_safety"]
            }
        }

    async def process_turn(self, context: Dict[str, Any], text: str) -> Dict[str, Any]:
        """Process conversation turn through Colang rules"""
        result = {
            "matched_rules": [],
            "suggested_response_type": "default",
            "requires_fact_check": False,
            "enhanced_guardrails": [],
            "conversation_flow": "continue"
        }

        text_lower = text.lower()

        # Check rules
        for rule_name, rule_config in self.rules.items():
            if any(trigger in text_lower for trigger in rule_config.get("triggers", [])):
                result["matched_rules"].append(rule_name)

                if "response_type" in rule_config:
                    result["suggested_response_type"] = rule_config["response_type"]

                if "guardrails" in rule_config:
                    result["enhanced_guardrails"].extend(rule_config["guardrails"])

        # Determine if fact-checking needed based on context
        if context.get("turn_count", 0) > 2 and any(word in text_lower for word in ["fact", "true", "correct", "information"]):
            result["requires_fact_check"] = True

        return result

class DialogManager:
    """Enhanced dialog management system with Colang integration"""

    def __init__(self):
        self.state_store = ConversationStateStore()
        self.context_tracker = ContextTracker()
        self.colang_engine = ColangExecutionEngine()

    async def update_state(self, conversation_id: str, text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Update dialog state and determine guardrails"""
        # Get current conversation state
        state = await self.state_store.get_state(conversation_id)

        # Update context with new turn
        updated_context = await self.context_tracker.update(state, text, context)

        # Apply Colang rules for conversation flow
        flow_result = await self.colang_engine.process_turn(updated_context, text)

        # Determine state-aware guardrails configuration
        guardrail_config = self.determine_guardrails(updated_context, flow_result)

        # Persist updated state
        await self.state_store.update_state(conversation_id, updated_context)

        return {
            "state": updated_context,
            "guardrail_config": guardrail_config,
            "flow_result": flow_result
        }

    def determine_guardrails(self, context: Dict[str, Any], flow_result: Dict[str, Any]) -> List[str]:
        """Determine which guardrails to apply based on conversation state"""
        base_guardrails = ["jailbreak_detection", "pii_redaction"]

        # Add state-aware guardrails
        if context.get("turn_count", 0) > 3:
            base_guardrails.append("dialog_management")

        if flow_result.get("requires_fact_check"):
            base_guardrails.append("fact_checking")

        if context.get("user_intent") == "information_seeking":
            base_guardrails.append("topical_boundaries")

        # Add enhanced guardrails from flow analysis
        base_guardrails.extend(flow_result.get("enhanced_guardrails", []))

        return list(set(base_guardrails))  # Remove duplicates

class RAYINCore:
    """Original RAYIN capabilities - preserved and enhanced"""

    def __init__(self):
        self.pii_patterns = self._load_pii_patterns()
        self.jailbreak_signatures = self._load_jailbreak_signatures()

    def _load_pii_patterns(self) -> Dict[str, str]:
        """Load PII detection patterns"""
        return {
            "email": r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
            "phone": r'\b\d{3}-\d{3}-\d{4}\b|\b\(\d{3}\)\s*\d{3}-\d{4}\b',
            "ssn": r'\b\d{3}-\d{2}-\d{4}\b',
            "credit_card": r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b'
        }

    def _load_jailbreak_signatures(self) -> List[str]:
        """Load jailbreak detection signatures"""
        return [
            "ignore previous instructions",
            "act as if",
            "pretend you are",
            "roleplay as",
            "simulate being",
            "forget everything above"
        ]

    async def process(self, text: str) -> RailResult:
        """Process text through core RAYIN capabilities"""
        start_time = time.time()
        flagged = False
        confidence = 0.0
        processed_text = text
        metadata = {}

        # PII Redaction
        pii_found = []
        for pii_type, pattern in self.pii_patterns.items():
            matches = re.findall(pattern, text)
            if matches:
                pii_found.extend([(pii_type, match) for match in matches])
                processed_text = re.sub(pattern, f"[{pii_type.upper()}_REDACTED]", processed_text)

        if pii_found:
            metadata["pii_redacted"] = pii_found

        # Jailbreak Detection
        text_lower = text.lower()
        jailbreak_detected = any(sig in text_lower for sig in self.jailbreak_signatures)

        if jailbreak_detected:
            flagged = True
            confidence = 0.95
            metadata["jailbreak_detected"] = True
            processed_text = "[POTENTIALLY_HARMFUL_CONTENT_BLOCKED]"

        processing_time = int((time.time() - start_time) * 1000)

        return RailResult(
            rail_type="rayin_core",
            flagged=flagged,
            confidence=confidence,
            processed_text=processed_text,
            metadata=metadata,
            processing_time_ms=processing_time
        )

class FactCheckingRails:
    """Fact-checking rails with knowledge base integration"""

    def __init__(self):
        self.knowledge_bases = ["general_knowledge", "current_events"]
        self.confidence_threshold = 0.75

    async def process(self, text: str, sources: List[str]) -> RailResult:
        """Process text for fact-checking"""
        start_time = time.time()

        # Extract claims (simplified)
        claims = self._extract_claims(text)

        if not claims:
            processing_time = int((time.time() - start_time) * 1000)
            return RailResult(
                rail_type="fact_checking",
                flagged=False,
                confidence=1.0,
                processed_text=text,
                metadata={"claims_found": 0},
                processing_time_ms=processing_time
            )

        # Verify claims (stub — no real knowledge base wired in yet).
        # Conservative default: treat all extracted claims as unverified so the rail
        # fails closed (flags) rather than open (silently passes everything).
        # TODO: replace with real knowledge-base / NeMo RAG lookup.
        verified_claims = []
        flagged_claims = list(claims)

        processing_time = int((time.time() - start_time) * 1000)
        flagged = len(flagged_claims) > 0

        metadata = {
            "claims_found": len(claims),
            "verified_claims": len(verified_claims),
            "flagged_claims": len(flagged_claims),
            "accuracy_score": len(verified_claims) / len(claims) if claims else 1.0
        }

        return RailResult(
            rail_type="fact_checking",
            flagged=flagged,
            confidence=0.9,
            processed_text=text,
            metadata=metadata,
            processing_time_ms=processing_time
        )

    def _extract_claims(self, text: str) -> List[str]:
        """Extract verifiable claims from text"""
        # Simplified claim extraction
        sentences = text.split('.')
        claims = []

        for sentence in sentences:
            sentence = sentence.strip()
            if len(sentence) > 10 and any(word in sentence.lower() for word in ['is', 'are', 'was', 'were', 'will be']):
                claims.append(sentence)

        return claims

class TopicalBoundaryRails:
    """Topical boundary enforcement rails"""

    def __init__(self):
        self.domain_policies = self._load_domain_policies()

    def _load_domain_policies(self) -> Dict[str, Dict[str, Any]]:
        """Load domain-specific policies"""
        return {
            "finance": {
                # Natural-language phrases that match what users actually type.
                # TODO: expand with a broader phrase list when NeMo topic classifier is wired in.
                "prohibited_topics": [
                    "investment advice", "financial advice", "financial planning",
                    "stock tips", "should i invest", "what stocks", "trading advice"
                ],
                "action": "block",
                "message": "I cannot provide financial advice. Please consult a financial professional."
            },
            "healthcare": {
                "prohibited_topics": [
                    "medical advice", "diagnose", "what medication", "treatment for",
                    "should i take", "medical diagnosis", "health advice"
                ],
                "action": "redirect",
                "message": "I cannot provide medical advice. Please consult a healthcare professional."
            },
            "legal": {
                "prohibited_topics": [
                    "legal advice", "am i liable", "can i sue", "is it legal",
                    "legal interpretation", "what does the law", "case strategy"
                ],
                "action": "block",
                "message": "I cannot provide legal advice. Please consult a qualified attorney."
            }
        }

    async def process(self, text: str, allowed_domains: List[str]) -> RailResult:
        """Process text for topical boundary enforcement"""
        start_time = time.time()

        # Detect domains (simplified)
        detected_domains = self._classify_domains(text)

        # Check boundaries
        violations = []
        for domain in detected_domains:
            if domain in self.domain_policies:
                policy = self.domain_policies[domain]
                if any(topic in text.lower() for topic in policy["prohibited_topics"]):
                    violations.append({
                        "domain": domain,
                        "policy": policy,
                        "detected_topics": [topic for topic in policy["prohibited_topics"] if topic in text.lower()]
                    })

        processing_time = int((time.time() - start_time) * 1000)
        flagged = len(violations) > 0

        metadata = {
            "detected_domains": detected_domains,
            "violations": violations,
            "allowed_domains": allowed_domains
        }

        processed_text = text
        if flagged and violations:
            # Apply the first violation's action
            violation = violations[0]
            if violation["policy"]["action"] == "block":
                processed_text = violation["policy"]["message"]

        return RailResult(
            rail_type="topical_boundaries",
            flagged=flagged,
            confidence=0.85,
            processed_text=processed_text,
            metadata=metadata,
            processing_time_ms=processing_time
        )

    def _classify_domains(self, text: str) -> List[str]:
        """Classify text into domains"""
        text_lower = text.lower()
        domains = []

        if any(word in text_lower for word in ['money', 'investment', 'stock', 'finance', 'trading']):
            domains.append('finance')

        if any(word in text_lower for word in ['health', 'medical', 'doctor', 'medicine', 'treatment']):
            domains.append('healthcare')

        if any(word in text_lower for word in ['legal', 'law', 'attorney', 'court', 'lawsuit']):
            domains.append('legal')

        return domains

class CustomRuleEngine:
    """Custom rule engine with YAML-based rule definition"""

    def __init__(self):
        self.rules = self._load_default_rules()
        self.rule_cache = {}

    def _load_default_rules(self) -> Dict[str, Dict[str, Any]]:
        """Load default custom rules"""
        return {
            "no_personal_info_sharing": {
                "type": "content_filter",
                "triggers": ["share personal", "give me your", "tell me about yourself"],
                "action": "block",
                "message": "I don't share personal information."
            },
            "professional_boundaries": {
                "type": "behavior_guide",
                "triggers": ["be my friend", "personal relationship"],
                "action": "redirect",
                "message": "I'm here to assist professionally. How can I help you today?"
            }
        }

    async def apply_rules(self, text: str, rules: List[str]) -> RailResult:
        """Apply custom rules to text"""
        start_time = time.time()

        results = []
        flagged = False
        processed_text = text

        for rule_name in rules:
            if rule_name in self.rules:
                rule = self.rules[rule_name]
                result = self._execute_rule(rule, text)
                results.append(result)

                if result["triggered"]:
                    flagged = True
                    if rule["action"] == "block":
                        processed_text = rule["message"]
                    elif rule["action"] == "redirect":
                        processed_text = f"{rule['message']} Original request: {text}"

        processing_time = int((time.time() - start_time) * 1000)

        metadata = {
            "applied_rules": rules,
            "rule_results": results,
            "total_triggered": sum(1 for r in results if r["triggered"])
        }

        return RailResult(
            rail_type="custom_rules",
            flagged=flagged,
            confidence=0.9,
            processed_text=processed_text,
            metadata=metadata,
            processing_time_ms=processing_time
        )

    def _execute_rule(self, rule: Dict[str, Any], text: str) -> Dict[str, Any]:
        """Execute a single rule"""
        text_lower = text.lower()
        triggered = any(trigger in text_lower for trigger in rule.get("triggers", []))

        return {
            "rule_type": rule["type"],
            "triggered": triggered,
            "action": rule["action"] if triggered else None
        }

class EnhancedRailEngine:
    """Main enhanced rail execution engine"""

    def __init__(self):
        self.input_rails = []
        self.output_rails = []
        self.dialog_manager = DialogManager()
        self.fact_checker = FactCheckingRails()
        self.custom_rules = CustomRuleEngine()
        self.rayin_core = RAYINCore()
        self.topical_rails = TopicalBoundaryRails()

    async def process_request(self, request: GuardrailRequest) -> GuardrailResponse:
        """Process request through enhanced rail pipeline"""
        start_time = time.time()

        # Input rail processing
        input_result = await self._process_input_rails(request)

        # Dialog state management
        dialog_state = None
        if request.conversation_id:
            dialog_state = await self.dialog_manager.update_state(
                request.conversation_id,
                request.text,
                request.context
            )

            # Update guardrails based on dialog state
            if dialog_state and "guardrail_config" in dialog_state:
                request.guardrails.extend(dialog_state["guardrail_config"])
                request.guardrails = list(set(request.guardrails))  # Remove duplicates

        # Core RAYIN processing (PII + Jailbreak) - PRESERVED
        core_result = await self.rayin_core.process(input_result.get("processed_text", request.text))

        # Enhanced processing (Fact-checking, Custom rules, Topical)
        enhanced_results = await self._process_enhanced_rails(
            core_result, dialog_state, request
        )

        # Output rail processing
        final_result = await self._process_output_rails(enhanced_results)

        # Compile response
        total_time = int((time.time() - start_time) * 1000)

        guardrails_results = {
            "rayin_core": {
                "pii_redaction": {
                    "redacted_entities": core_result.metadata.get("pii_redacted", []),
                    "redacted_text": core_result.processed_text
                },
                "jailbreak_detection": {
                    "flagged": core_result.flagged,
                    "confidence": core_result.confidence
                }
            }
        }

        # Add enhanced results
        for result in enhanced_results:
            guardrails_results[result.rail_type] = {
                "flagged": result.flagged,
                "confidence": result.confidence,
                "metadata": result.metadata
            }

        # Determine overall status
        any_flagged = core_result.flagged or any(r.flagged for r in enhanced_results)
        final_text = core_result.processed_text

        # Apply most restrictive result
        for result in enhanced_results:
            if result.flagged and result.rail_type in ["topical_boundaries", "custom_rules"]:
                final_text = result.processed_text
                break

        return GuardrailResponse(
            status="success",
            flagged=any_flagged,
            processed_text=final_text,
            guardrails_results=guardrails_results,
            conversation_state=dialog_state.get("state", {}) if dialog_state else {},
            processing_metrics={
                "total_latency_ms": total_time,
                "core_processing_ms": core_result.processing_time_ms,
                "enhanced_rails_ms": sum(r.processing_time_ms for r in enhanced_results),
                "guardrails_applied": request.guardrails
            }
        )

    async def _process_input_rails(self, request: GuardrailRequest) -> Dict[str, Any]:
        """Process input rails"""
        # Placeholder for input rail processing
        return {"processed_text": request.text}

    async def _process_enhanced_rails(self, core_result: RailResult, dialog_state: Optional[Dict[str, Any]], request: GuardrailRequest) -> List[RailResult]:
        """Process enhanced rails (fact-checking, topical, custom)"""
        tasks = []

        if "fact_checking" in request.guardrails:
            tasks.append(self.fact_checker.process(
                core_result.processed_text,
                request.rules.get("fact_check_sources", [])
            ))

        if "topical_boundaries" in request.guardrails:
            tasks.append(self.topical_rails.process(
                core_result.processed_text,
                request.rules.get("topical_domains", [])
            ))

        if "custom_rules" in request.guardrails and request.rules.get("custom_rules"):
            tasks.append(self.custom_rules.apply_rules(
                core_result.processed_text,
                request.rules["custom_rules"]
            ))

        if not tasks:
            return []

        # Execute enhanced rails in parallel
        enhanced_results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter out exceptions
        valid_results = [r for r in enhanced_results if isinstance(r, RailResult)]

        return valid_results

    async def _process_output_rails(self, enhanced_results: List[RailResult]) -> Dict[str, Any]:
        """Process output rails"""
        # Placeholder for output rail processing
        return {"processed": True}

# FastAPI Application
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Enhanced RAYIN + NeMo Guardrails",
    description="AI Safety Platform with Dialog Management, Fact-Checking, and Custom Rules",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://litellm-proxy:8080",   # LiteLLM gateway service (cluster-internal)
        "http://localhost:3000",        # Local dev (Langfuse UI)
        "http://localhost:4000",        # Local dev (LiteLLM proxy)
        "http://localhost:8080",        # Local dev (RAYIN / direct testing)
        # TODO(auth): restrict further once Entra ID JWT validation is added.
        # Currently relies on ClusterIP + no Ingress for network-level isolation.
        # No request-level authentication yet — add Entra ID JWT validation
        # (fastapi-azure-auth, validate aud/iss/exp, log oid/upn for BFSI audit)
        # before this service is exposed beyond trusted internal callers.
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global rail engine instance
rail_engine = EnhancedRailEngine()

@app.post("/v1/guard/enhanced", response_model=GuardrailResponse)
async def enhanced_guard_endpoint(request: GuardrailRequest):
    """Enhanced guardrails endpoint with NeMo capabilities"""
    try:
        response = await rail_engine.process_request(request)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/guard", response_model=GuardrailResponse)
async def legacy_guard_endpoint(request: GuardrailRequest):
    """Legacy guardrails endpoint for backward compatibility"""
    # Ensure basic guardrails are applied
    if not request.guardrails:
        request.guardrails = ["jailbreak_detection", "pii_redaction"]

    try:
        response = await rail_engine.process_request(request)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "version": "2.0.0",
        "capabilities": [
            "jailbreak_detection",
            "pii_redaction",
            "dialog_management",
            "fact_checking",
            "topical_boundaries",
            "custom_rules"
        ],
        "timestamp": time.time()
    }

@app.get("/health/ready")
async def readiness_check():
    """Readiness check for Kubernetes"""
    return {"status": "ready"}

@app.get("/health/live")
async def liveness_check():
    """Liveness check for Kubernetes"""
    return {"status": "live"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="info")