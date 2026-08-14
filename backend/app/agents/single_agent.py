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
)


# ---------------------------------------------------------------------------
# Mem0 client — singleton, shared with memory_server.py
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_memory_client() -> Optional[Memory]:
    if not MONGODB_ATLAS_URI:
        return None

    # Mem0 LLM config — cerebras falls back to groq for memory extraction
    # (Mem0 doesn't natively support cerebras provider yet)
    if LLM_PROVIDER == "gemini":
        mem0_llm_provider = "gemini"
        mem0_model   = GEMINI_MODEL
        mem0_api_key = GEMINI_API_KEY
    elif LLM_PROVIDER == "cerebras":
        # Cerebras uses OpenAI-compatible API — use groq as mem0 extractor
        # if groq key available, else fall back to gemini
        mem0_llm_provider = "groq" if GROQ_API_KEY else "gemini"
        mem0_model   = GROQ_MODEL if GROQ_API_KEY else GEMINI_MODEL
        mem0_api_key = GROQ_API_KEY if GROQ_API_KEY else GEMINI_API_KEY
    else:
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

@lru_cache(maxsize=1)
def get_llm():
    if LLM_PROVIDER == "cerebras":
        from langchain_cerebras import ChatCerebras
        return ChatCerebras(
            api_key=CEREBRAS_API_KEY,
            model=CEREBRAS_MODEL,
            temperature=0.7,
        )
    elif LLM_PROVIDER == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            google_api_key=GEMINI_API_KEY,
            model=GEMINI_MODEL,
            temperature=0.7,
        )
    else:
        from langchain_groq import ChatGroq
        return ChatGroq(
            api_key=GROQ_API_KEY,
            model_name=GROQ_MODEL,
            temperature=0.7,
        )


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_TEMPLATE = """\
You are ARIA — an Advanced Reasoning Intelligence Assistant for business and personal productivity.

You are the user's senior chief of staff, business analyst, and personal advisor — all in one.
You are proactive, precise, and deeply personalised.

CORE BEHAVIOUR:
- You always remember facts, preferences, and history the user has shared.
- You reference relevant memories naturally without being told to.
- You are aware of the current date/time and use it to reason about deadlines and urgency.
- If pending tasks appear in context, mention them proactively when relevant.
- You give structured, actionable answers for business questions.
- For personal queries, you are warm, direct, and supportive.
- You never fabricate — if you don't know something, say so.
- You can draft emails, reports, summaries, plans, and analysis on request.

RELEVANT PAST CONVERSATION (from memory):
{memories}

RELEVANT BUSINESS DOCUMENTS (from uploaded files):
{doc_context}

Respond in a clear, professional tone. Be concise for simple questions, thorough for complex ones.
When answering from business documents, cite the section, page, or table explicitly.
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

    # -- Step 1: retrieve conversational memories (Mem0, sync) ---------------
    raw_memories = []
    if mcp_client is not None:
        raw_memories = mcp_client.search(user_message, user_id=user_id)
    else:
        mem = get_memory_client()
        if mem is not None:
            result = mem.search(
                query=user_message,
                filters={"user_id": user_id},
                limit=5,
            )
            raw_memories = (
                result.get("results", result)
                if isinstance(result, dict)
                else result
            )

    memory_text = _format_memories(raw_memories)

    # -- Step 2: build prompt -------------------------------------------------
    system_msg = SystemMessage(content=SYSTEM_TEMPLATE.format(
        memories=memory_text,
        doc_context=doc_context,
    ))
    human_msg = HumanMessage(content=user_message)

    # -- Step 3: call LLM -----------------------------------------------------
    llm = get_llm()
    response = llm.invoke([system_msg, human_msg])
    assistant_reply: str = response.content

    # -- Step 4: save new facts to Mem0 ---------------------------------------
    messages_for_mem = [
        {"role": "user",      "content": user_message},
        {"role": "assistant", "content": assistant_reply},
    ]
    if mcp_client is not None:
        mcp_client.add(
            content=f"User said: {user_message}\nAssistant replied: {assistant_reply}",
            user_id=user_id,
        )
    else:
        mem = get_memory_client()
        if mem is not None:
            mem.add(messages=messages_for_mem, user_id=user_id)

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
