"""
agents/tool_agent.py — ARIA with tool-calling (agentic loop).

Supports: groq, openrouter, gemini (all support bind_tools).
Falls back to plain chat_with_memory for cerebras (no tool calling yet).

Flow per turn:
  1. Retrieve Mem0 memories
  2. Bind tools to LLM
  3. Agentic loop: LLM decides which tools to call → execute → feed results back
  4. Extract final text reply
  5. Save to Mem0
"""
from __future__ import annotations

from langchain.messages import HumanMessage, SystemMessage, AIMessage, ToolMessage

from app.agents.single_agent import get_llm, get_memory_client, _format_memories
from app.agents.tools import make_tools
from app.config import LLM_PROVIDER

TOOL_CAPABLE = {"groq", "openrouter", "gemini", "cerebras"}

SYSTEM = """\
You are ARIA — an Advanced Reasoning Intelligence Assistant for business and personal productivity.
You are the user's chief of staff, analyst, and personal advisor.

You have tools available. Use them when appropriate:
- create_task: when user says add/schedule/create a task
- update_task_status: when user says they started/completed a task
- get_tasks: when asked about pending tasks or task list
- search_documents: when asked about content in uploaded files/documents
- summarise_document: when asked to summarise/analyse an uploaded document

Do NOT use tools for normal conversation.
After tool results, give a clear helpful response to the user.

MEMORY (past conversations):
{memories}

DOCUMENT CONTEXT (uploaded files):
{doc_context}

Be concise for simple questions, thorough for complex ones.
Cite pages/sections when answering from documents.
"""


def chat_with_tools(
    user_message: str,
    user_id: str,
    doc_context: str = "No relevant business documents found.",
    mcp_client=None,
) -> str:
    from app.agents.single_agent import chat_with_memory

    # Providers without reliable tool calling — use plain chat
    if LLM_PROVIDER not in TOOL_CAPABLE:
        return chat_with_memory(
            user_message=user_message,
            user_id=user_id,
            doc_context=doc_context,
            mcp_client=mcp_client,
        )

    # ── Retrieve memories (best-effort) ──────────────────────────────────────
    raw_memories = []
    mem = get_memory_client()
    try:
        if mcp_client is not None:
            raw_memories = mcp_client.search(user_message, user_id=user_id)
        elif mem is not None:
            result = mem.search(query=user_message, filters={"user_id": user_id}, limit=5)
            raw_memories = result.get("results", result) if isinstance(result, dict) else result
    except Exception:
        raw_memories = []
    memory_text = _format_memories(raw_memories)

    # ── Set up tools + LLM ────────────────────────────────────────────────────
    tools    = make_tools(user_id)
    tool_map = {t.name: t for t in tools}
    llm      = get_llm()

    try:
        llm_with_tools = llm.bind_tools(tools)
    except Exception:
        return chat_with_memory(
            user_message=user_message,
            user_id=user_id,
            doc_context=doc_context,
            mcp_client=mcp_client,
        )

    messages = [
        SystemMessage(content=SYSTEM.format(memories=memory_text, doc_context=doc_context)),
        HumanMessage(content=user_message),
    ]

    # ── Agentic loop (max 5 iterations) ──────────────────────────────────────
    for _ in range(5):
        try:
            response = llm_with_tools.invoke(messages)
        except Exception:
            # Tool calling failed — fall back to plain chat
            return chat_with_memory(
                user_message=user_message,
                user_id=user_id,
                doc_context=doc_context,
                mcp_client=mcp_client,
            )
        messages.append(response)

        tool_calls = getattr(response, "tool_calls", None)
        if not tool_calls:
            break  # Final answer — no more tool calls

        for tc in tool_calls:
            name    = tc["name"]
            args    = tc["args"]
            call_id = tc.get("id", name)
            try:
                result = tool_map[name].invoke(args) if name in tool_map else f"Unknown tool: {name}"
            except Exception as e:
                result = f"Tool error: {e}"
            messages.append(ToolMessage(content=str(result), tool_call_id=call_id))

    # ── Extract final reply ───────────────────────────────────────────────────
    reply = ""
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and msg.content:
            reply = msg.content
            break

    if not reply:
        reply = "I completed your request."

    # ── Save to memory (best-effort) ─────────────────────────────────────────
    try:
        msgs = [{"role": "user", "content": user_message}, {"role": "assistant", "content": reply}]
        if mcp_client is not None:
            mcp_client.add(content=f"User: {user_message}\nARIA: {reply}", user_id=user_id)
        elif mem is not None:
            mem.add(messages=msgs, user_id=user_id)
    except Exception:
        pass  # Never crash chat due to Mem0 rate limits

    return reply
