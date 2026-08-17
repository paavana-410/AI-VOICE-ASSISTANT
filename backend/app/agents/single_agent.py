"""
agents/single_agent.py — LangChain agent wired to Groq / Gemini + Mem0.

chat_with_memory() is a SYNCHRONOUS function — it does only sync work:
  1. Search Mem0 (sync Mem0 client)
  2. Build system prompt (injecting pre-fetched doc_context from the caller)
  3. Call LLM
  4. Write new facts back to Mem0

Document chunk retrieval (async) is done by the caller (api/chat.py)
BEFORE calling this function, then passed in as doc_context. This avoids
the asyncio-in-sync-context problem entirely.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from langchain.messages import HumanMessage, SystemMessage
from mem0 import Memory

from app.config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GROQ_API_KEY,
    GROQ_MODEL,
    LLM_PROVIDER,
    MONGODB_ATLAS_URI,
    MONGODB_DB_NAME,
    MEMORY_COLLECTION,
    CEREBRAS_API_KEY,
    CEREBRAS_MODEL,
    OPENROUTER_API_KEY,
    OPENROUTER_MODEL,
)


# ---------------------------------------------------------------------------
# Mem0 client — singleton, shared with memory_server.py
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_memory_client() -> Optional[Memory]:
    if not MONGODB_ATLAS_URI:
        return None

    # Mem0 LLM config — use groq if available, else gemini
    # If both exhausted, use a minimal config that skips LLM extraction
    if LLM_PROVIDER == "gemini":
        mem0_llm_provider = "gemini"
        mem0_model   = GEMINI_MODEL
        mem0_api_key = GEMINI_API_KEY
    else:
        # For groq/cerebras/openrouter: use groq for Mem0 extraction
        # (Mem0 doesn't support cerebras/openrouter natively)
        mem0_llm_provider = "groq"
        mem0_model   = GROQ_MODEL
        mem0_api_key = GROQ_API_KEY

    llm_config = {
        "provider": mem0_llm_provider,
        "config": {
            "model":   mem0_model,
            "api_key": mem0_api_key,
        },
    }

    embedder_config = {
        "provider": "huggingface",
        "config": {"model": "sentence-transformers/all-MiniLM-L6-v2"},
    }

    config = {
        "vector_store": {
            "provider": "mongodb",
            "config": {
                "mongo_uri":             MONGODB_ATLAS_URI,
                "db_name":               MONGODB_DB_NAME,
                "collection_name":       MEMORY_COLLECTION,
                "embedding_model_dims":  384,
            },
        },
        "embedder": embedder_config,
        "llm":      llm_config,
    }
    return Memory.from_config(config)


# ---------------------------------------------------------------------------
# LangChain LLM client — singleton
# ---------------------------------------------------------------------------

from app.config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GROQ_API_KEY,
    GROQ_MODEL,
    LLM_PROVIDER,
    MONGODB_ATLAS_URI,
    MONGODB_DB_NAME,
    MEMORY_COLLECTION,
    CEREBRAS_API_KEY,
    CEREBRAS_MODEL,
    OPENROUTER_API_KEY,
    OPENROUTER_MODEL,
    NVIDIA_API_KEY,
    NVIDIA_MODEL,
)

def _build_llm_by_name(provider: str):
    if provider == "nvidia" and NVIDIA_API_KEY:
        try:
            from langchain_nvidia_ai_endpoints import ChatNVIDIA
            return ChatNVIDIA(
                api_key=NVIDIA_API_KEY,
                model=NVIDIA_MODEL,
                temperature=0.7,
            )
        except Exception:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                api_key=NVIDIA_API_KEY,
                model=NVIDIA_MODEL,
                base_url="https://integrate.api.nvidia.com/v1",
                temperature=0.7,
            )
    elif provider == "cerebras" and CEREBRAS_API_KEY:
        from langchain_cerebras import ChatCerebras
        return ChatCerebras(
            api_key=CEREBRAS_API_KEY,
            model=CEREBRAS_MODEL,
            temperature=0.7,
        )
    elif provider == "openrouter" and OPENROUTER_API_KEY:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            api_key=OPENROUTER_API_KEY,
            model=OPENROUTER_MODEL,
            base_url="https://openrouter.ai/api/v1",
            temperature=0.7,
            default_headers={
                "HTTP-Referer": "https://github.com/paavana-410/AI-VOICE-ASSISTANT",
                "X-Title": "MemAI Business Assistant",
            },
        )
    elif provider == "gemini" and GEMINI_API_KEY:
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            google_api_key=GEMINI_API_KEY,
            model=GEMINI_MODEL,
            temperature=0.7,
        )
    elif GROQ_API_KEY:
        from langchain_groq import ChatGroq
        return ChatGroq(
            api_key=GROQ_API_KEY,
            model_name=GROQ_MODEL,
            temperature=0.7,
        )
    return None

def get_llm():
    """Build fresh LLM chain each call — no cache, so provider rotation works after 429s."""
    primary = _build_llm_by_name(LLM_PROVIDER)
    fallbacks = []
    for p in ["openrouter", "cerebras", "groq", "gemini", "nvidia"]:
        if p != LLM_PROVIDER:
            fb = _build_llm_by_name(p)
            if fb is not None:
                fallbacks.append(fb)

    if primary and fallbacks:
        return primary.with_fallbacks(fallbacks)
    return primary or (fallbacks[0] if fallbacks else None)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_TEMPLATE = """\
You are TESS — an AI Business Analyst Assistant built for decision intelligence.
You think and communicate like a senior analyst at a top-tier consulting firm.

ANALYST REASONING FRAMEWORK:
For every business question, follow this structure:
1. ASSUMPTIONS — if the question is ambiguous, state 1-2 explicit assumptions before answering
2. FINDING — what the data actually shows, stated precisely with numbers
3. IMPACT — what this means for the business (so what?)
4. RECOMMENDATION — one clear action the business should take (now what?)
5. CONFIDENCE — High / Medium / Low with brief justification

WHEN TO USE THIS STRUCTURE:
- Any question about business performance, metrics, trends, comparisons, forecasting
- Any document with financials, sales, operations, or strategy data
- Any question with: why, should, compare, trend, performance, growth, risk

WHEN NOT TO USE:
- Casual greetings or simple factual questions → plain prose, max 2 sentences
- Task management → just confirm action

CRITICAL THINKING RULES:
- Never silently guess on ambiguous terms — state your assumption
- Proactively flag anomalies even if not asked
- Distinguish correlation from causation when relevant
- If data is insufficient, say so and state what additional data would help
- Use precise numbers from documents — never fabricate

RESPONSE STYLE:
- Business analysis: use FIR structure with clean markdown
- Casual chat: plain spoken prose, no markdown, no bullets
- Never open with "Certainly!", "Of course!", "Great question!"
- Lead with the insight, not the preamble

RELEVANT PAST CONVERSATION:
{memories}

RELEVANT BUSINESS DOCUMENTS:
{doc_context}
"""


# ---------------------------------------------------------------------------
# Core chat function (synchronous — no async here)
# ---------------------------------------------------------------------------

def chat_with_memory(
    user_message: str,
    user_id: str,
    doc_context: str = "No relevant business documents found.",
    mcp_client=None,
) -> str:
    """
    Synchronous single-agent chat turn.

    Parameters
    ----------
    user_message : str
        The enriched message (already includes date/time, history, tasks
        injected by api/chat.py).
    user_id : str
        Derived from JWT — never from client.
    doc_context : str
        Pre-fetched document chunk results, formatted as a string.
        Caller (api/chat.py) is responsible for doing the async search
        and passing the result here.
    mcp_client : optional
        If provided, uses MCP for memory operations; otherwise uses Mem0 directly.
    """

    # -- Step 1: retrieve conversational memories (best-effort) ---------------
    raw_memories = []
    try:
        clean_query = user_message.strip().split("\n\n")[-1].strip()[:100]
        if mcp_client is not None:
            raw_memories = mcp_client.search(clean_query, user_id=user_id)
        else:
            mem = get_memory_client()
            if mem is not None and clean_query:
                result = mem.search(
                    query=clean_query,
                    filters={"user_id": user_id},
                    limit=5,
                )
                raw_memories = (
                    result.get("results", result)
                    if isinstance(result, dict)
                    else result
                )
    except Exception:
        raw_memories = []  # degrade gracefully if Mem0 is unavailable

    memory_text = _format_memories(raw_memories)

    # -- Step 2: build prompt -------------------------------------------------
    system_msg = SystemMessage(content=SYSTEM_TEMPLATE.format(
        memories=memory_text,
        doc_context=doc_context,
    ))
    human_msg = HumanMessage(content=user_message)

    PROVIDER_ORDER = ["cerebras", "gemini", "groq", "openrouter", "nvidia"]
    seen = set()
    assistant_reply: str = ""
    for _p in PROVIDER_ORDER:
        if _p in seen:
            continue
        seen.add(_p)
        _llm = _build_llm_by_name(_p)
        if _llm is None:
            continue
        try:
            _resp = _llm.invoke([system_msg, human_msg])
            assistant_reply = _resp.content
            break
        except Exception as _e:
            err_str = str(_e).lower()
            if "429" in err_str or "rate" in err_str or "quota" in err_str:
                continue  # silently try next provider
            raise  # re-raise non-rate-limit errors
    if not assistant_reply:
        assistant_reply = f"### Document Analysis\n\n{doc_context}"

    # -- Step 4: save new facts to Mem0 (best-effort — never crash chat) ----
    messages_for_mem = [
        {"role": "user",      "content": user_message},
        {"role": "assistant", "content": assistant_reply},
    ]
    try:
        if mcp_client is not None:
            mcp_client.add(
                content=f"User said: {user_message}\nAssistant replied: {assistant_reply}",
                user_id=user_id,
            )
        else:
            mem = get_memory_client()
            if mem is not None:
                mem.add(messages=messages_for_mem, user_id=user_id)
    except Exception:
        pass  # Never crash chat due to Mem0 LLM rate limits

    return assistant_reply


def _format_memories(memories: list) -> str:
    if not memories:
        return "No previous memories found."
    lines = []
    for m in memories:
        if isinstance(m, dict):
            lines.append(f"- {m.get('memory', m.get('text', str(m)))}")
        else:
            lines.append(f"- {m}")
    return "\n".join(lines)
