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

You have tools available. Use them when appropriate:
- create_task: when user says add/schedule/create a task
- update_task_status: when user says they started/completed a task
- get_tasks: when asked about pending tasks or task list
- search_documents: when asked about content in uploaded files/documents
- summarise_document: when asked to summarise/analyse an uploaded document

Do NOT use tools for normal conversation.
After tool results, give a clear helpful response to the user.

IMAGE & DOCUMENT ANALYSIS RULES:
- Always examine DOCUMENT CONTEXT and tool results thoroughly.
- For any document or image (scans, certificates, screenshots, diagrams, PDFs):
  1. Produce a beautifully formatted Markdown analysis.
  2. Use a Markdown Table (`| Item | Information |`) listing key extracted fields, numbers, titles, names, dates, IDs, or metrics.
  3. Provide bullet points for key takeaways and insights.
  4. Include a concise summary section at the bottom.
- NEVER ask the user to describe what's in the image if text/context is already available in DOCUMENT CONTEXT or tool results.

MEMORY (past conversations):
{memories}

DOCUMENT CONTEXT (uploaded files):
{doc_context}

Be concise for simple questions, thorough and structured for document/image analysis.
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
                    user_text = m.content
                    break
            if user_text:
                res = mem.search(query=user_text, filters={"user_id": user_id}, limit=5)
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
    # Use a bare (non-fallback) LLM for bind_tools — with_fallbacks() chains
    # don't support bind_tools. Plain invocation uses the full fallback chain.
    bare_llm = _get_bare_llm()
    full_llm = get_llm()

    response = None
    if bare_llm is not None:
        try:
            llm_with_tools = bare_llm.bind_tools(tools)
            response = await llm_with_tools.ainvoke(full_messages)
        except Exception:
            response = None

    if response is None:
        # Plain invocation with full fallback chain
        response = await full_llm.ainvoke(full_messages)

    return {"messages": [response]}


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
                return str(m.content)
        return "Task processed successfully."
    except Exception as e:
        # Fallback to plain single agent execution if graph execution encounters unexpected issues
        from app.agents.single_agent import chat_with_memory
        return chat_with_memory(user_message=user_message, user_id=user_id, doc_context=doc_context)
