"""
agents/graph_agent.py — LangGraph powered agentic engine for TESS.

Replaces standard loops with a compiled LangGraph StateGraph:
  1. StateGraph with messages, user_id, doc_context state
  2. Dynamic native async tool binding per request
  3. Conditional edges for automated tool execution & loop termination
  4. Multi-provider fallbacks via get_llm()
"""
from __future__ import annotations

from typing import Annotated, Sequence, TypedDict
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

from app.agents.single_agent import get_llm, get_memory_client, _format_memories, _build_llm_by_name
from app.agents.tools import make_tools
from app.config import LLM_PROVIDER


def _get_bare_llm():
    """Return a bare (no .with_fallbacks) LLM suitable for bind_tools."""
    # Try nvidia and gemini first as they have native 100% compliant tool binding support
    for p in ["nvidia", "gemini", LLM_PROVIDER, "openrouter", "groq"]:
        llm = _build_llm_by_name(p)
        if llm is not None:
            return llm
    return None

SYSTEM_TEMPLATE = """\
You are TESS — an Advanced Reasoning Intelligence Assistant for business and personal productivity.
You are the user's chief of staff, analyst, and personal advisor.

RESPONSE STYLE (strictly follow):
- Casual talk, greetings, simple questions: respond in natural spoken prose — no markdown, no bullets, no headers, no dashes. Write like you are talking to a person face to face.
- Document analysis, data, tables, multi-step answers: use clean markdown with headers and tables.
- Never open with filler phrases like "Certainly!", "Of course!", "Absolutely!".
- Keep conversational replies under 3 sentences unless depth is clearly needed.

TOOLS — use only when needed:
- create_task: user says add/schedule/create a task
- update_task_status: user says started/completed a task
- get_tasks: user asks about pending tasks
- search_documents: user asks about uploaded files
- summarise_document: user asks to summarise/analyse a document

IMAGE & DOCUMENT ANALYSIS:
- You have full OCR capability via DOCUMENT CONTEXT below. Never say you cannot see images.
- For documents and images: produce a markdown analysis with a table of key fields, bullet takeaways, and a summary.
- If DOCUMENT CONTEXT contains "vision description unavailable": tell the user "Your image was received but vision timed out. Try again in a few minutes."
- If no image content exists yet: ask the user to paste or upload it.

MEMORY:
{memories}

DOCUMENT CONTEXT:
{doc_context}
"""

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    user_id: str
    doc_context: str


async def call_model_node(state: AgentState):
    user_id = state.get("user_id", "demo_user")
    doc_context = state.get("doc_context", "No relevant business documents found.")
    messages = list(state["messages"])

    # ── Memory context retrieval ──────────────────────────────────────────────
    raw_memories = []
    try:
        mem = get_memory_client()
        if mem is not None:
            user_text = ""
            for m in reversed(messages):
                if isinstance(m, HumanMessage):
                    user_text = str(m.content)
                    break
            if user_text:
                clean_query = user_text.strip().split("\n\n")[-1].strip()[:100]
                if clean_query:
                    res = mem.search(query=clean_query, filters={"user_id": user_id}, limit=5)
                    raw_memories = res.get("results", res) if isinstance(res, dict) else res
    except Exception:
        raw_memories = []
    
    memory_text = _format_memories(raw_memories)
    sys_msg = SystemMessage(content=SYSTEM_TEMPLATE.format(memories=memory_text, doc_context=doc_context))

    # Prepend SystemMessage if not present
    if not messages or not isinstance(messages[0], SystemMessage):
        full_messages = [sys_msg] + messages
    else:
        full_messages = [sys_msg] + messages[1:]

    tools = make_tools(user_id)

    # Try providers with tool binding sequentially — catch 429/rate/quota silently
    # openrouter first since it has the most reliable free quota
    response = None
    for provider in ["openrouter", "cerebras", "groq", "gemini", "nvidia"]:
        bare_llm = _build_llm_by_name(provider)
        if bare_llm is None:
            continue
        try:
            llm_with_tools = bare_llm.bind_tools(tools)
            response = await llm_with_tools.ainvoke(full_messages)
            if response:
                break
        except Exception as _e:
            err_str = str(_e).lower()
            if "429" in err_str or "rate" in err_str or "quota" in err_str or "overloaded" in err_str:
                response = None
                continue
            response = None  # non-rate error — still try next provider

    # Last resort: plain invocation without tools, fresh provider loop (no cached llm)
    if response is None:
        for provider in ["openrouter", "cerebras", "groq", "gemini", "nvidia"]:
            plain_llm = _build_llm_by_name(provider)
            if plain_llm is None:
                continue
            try:
                response = await plain_llm.ainvoke(full_messages)
                if response:
                    break
            except Exception as _e:
                err_str = str(_e).lower()
                if "429" in err_str or "rate" in err_str or "quota" in err_str or "overloaded" in err_str:
                    continue

    return {"messages": [response] if response else [AIMessage(content="I'm experiencing high load. Please try again in a moment.")]}


async def execute_tools_node(state: AgentState):
    user_id = state.get("user_id", "demo_user")
    messages = state["messages"]
    last_message = messages[-1]

    tools = make_tools(user_id)
    tool_map = {t.name: t for t in tools}

    tool_outputs = []
    tool_calls = getattr(last_message, "tool_calls", []) or []

    for tc in tool_calls:
        name = tc.get("name")
        args = tc.get("args", {})
        call_id = tc.get("id", name)
        try:
            if name in tool_map:
                res = await tool_map[name].ainvoke(args)
            else:
                res = f"Unknown tool: {name}"
        except Exception as e:
            res = f"Tool execution error: {e}"
        tool_outputs.append(ToolMessage(content=str(res), tool_call_id=call_id))

    return {"messages": tool_outputs}


def should_continue(state: AgentState) -> str:
    messages = state["messages"]
    last_message = messages[-1]
    if getattr(last_message, "tool_calls", None):
        return "tools"
    return END


# ── Compile LangGraph ─────────────────────────────────────────────────────────
builder = StateGraph(AgentState)
builder.add_node("agent", call_model_node)
builder.add_node("tools", execute_tools_node)

builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", should_continue, ["tools", END])
builder.add_edge("tools", "agent")

langgraph_app = builder.compile()


async def run_langgraph_chat(
    user_message: str,
    user_id: str,
    doc_context: str = "No relevant business documents found.",
) -> str:
    """Native async entry point for LangGraph execution."""
    initial_state: AgentState = {
        "messages": [HumanMessage(content=user_message)],
        "user_id": user_id,
        "doc_context": doc_context,
    }

    try:
        final_state = await langgraph_app.ainvoke(initial_state)
        messages = final_state.get("messages", [])
        for m in reversed(messages):
            if isinstance(m, AIMessage) and m.content:
                if isinstance(m.content, list):
                    return "".join(item.get("text", "") if isinstance(item, dict) else str(item) for item in m.content).strip()
                return str(m.content)
        return "Task processed successfully."
    except Exception as e:
        # Fallback to plain single agent execution if graph execution encounters unexpected issues
        from app.agents.single_agent import chat_with_memory
        return chat_with_memory(user_message=user_message, user_id=user_id, doc_context=doc_context)
