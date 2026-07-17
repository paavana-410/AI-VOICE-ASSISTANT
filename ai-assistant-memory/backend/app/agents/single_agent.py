"""
agents/single_agent.py — LangChain agent wired to Groq + MCP memory tools.

Architecture:
  1. On each chat turn, retrieve relevant memories via MCP → inject into system prompt.
  2. Call ChatGroq with the enriched prompt.
  3. After the LLM responds, write new facts back to memory via MCP.

The memory client (Mem0) is also exported here so memory_server.py can import it
without causing a circular dependency.
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
)


# ---------------------------------------------------------------------------
# Mem0 client — singleton, shared with memory_server.py
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_memory_client() -> Optional[Memory]:
    """
    Configure Mem0 with:
      - MongoDB Atlas as the vector store (native support, no custom adapter)
      - sentence-transformers all-MiniLM-L6-v2 as the local embedder (384-dim)

    ⚠️  The Atlas vector search index MUST be created manually with dimensions=384
        before calling this function.  See README.md → Atlas Setup.
    """
    if not MONGODB_ATLAS_URI:
        return None
    llm_provider = "google" if LLM_PROVIDER == "gemini" else "groq"
    llm_config = {
        "provider": llm_provider,
        "config": {
            "model": GEMINI_MODEL if LLM_PROVIDER == "gemini" else GROQ_MODEL,
            "api_key": GEMINI_API_KEY if LLM_PROVIDER == "gemini" else GROQ_API_KEY,
        },
    }

    config = {
        "vector_store": {
            "provider": "mongodb",
            "config": {
                "connection_string": MONGODB_ATLAS_URI,
                "db_name": MONGODB_DB_NAME,
                "collection_name": MEMORY_COLLECTION,
                # The Atlas vector search index name you created in the UI
                "index_name": "mem0_vector_index",
                # Must match the index dimension — all-MiniLM-L6-v2 outputs 384
                "embedding_model_dims": 384,
            },
        },
        "embedder": {
            "provider": "huggingface",
            "config": {
                "model": "sentence-transformers/all-MiniLM-L6-v2",
            },
        },
        "llm": llm_config,
    }
    return Memory.from_config(config)


# ---------------------------------------------------------------------------
# LangChain LLM client — singleton
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_llm():
    if LLM_PROVIDER == "gemini":
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
# Core chat function
# ---------------------------------------------------------------------------

SYSTEM_TEMPLATE = """\
You are a helpful personal AI assistant with persistent memory.
You remember facts and preferences the user has shared in previous sessions.

Relevant memories retrieved for this conversation:
{memories}

Always use these memories to personalise your responses.
If no memories are listed, just respond naturally and remember new facts shared.
"""


def chat_with_memory(
    user_message: str,
    user_id: str,
    mcp_client=None,
) -> str:
    """
    Single-agent chat turn:
      1. Search memory (via MCP client if provided, else direct Mem0).
      2. Build system prompt with retrieved facts.
      3. Call ChatGroq.
      4. Write new facts to memory.
      5. Return the assistant reply.
    """
    # -- Step 1: retrieve memories --
    raw_memories = []
    if mcp_client is not None:
        raw_memories = mcp_client.search(user_message, user_id=user_id)
    else:
        mem = get_memory_client()
        if mem is not None:
            result = mem.search(query=user_message, user_id=user_id, limit=5)
            raw_memories = result.get("results", result) if isinstance(result, dict) else result

    memory_text = _format_memories(raw_memories)

    # -- Step 2: build prompt --
    system_msg = SystemMessage(content=SYSTEM_TEMPLATE.format(memories=memory_text))
    human_msg = HumanMessage(content=user_message)

    # -- Step 3: call LLM --
    llm = get_llm()
    response = llm.invoke([system_msg, human_msg])
    assistant_reply: str = response.content

    # -- Step 4: save new facts --
    messages_for_mem = [
        {"role": "user", "content": user_message},
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
