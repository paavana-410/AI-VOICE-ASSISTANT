"""
agents/crew_agents.py — CrewAI multi-agent setup sharing the same Mem0/MongoDB memory store.

Two agents:
  • Researcher  — can search the web (stub) and write discovered facts to shared memory.
  • Assistant   — reads shared memory and responds to the user.

Both agents read from / write to the SAME MongoDB Atlas memory store, proving
cross-agent memory sharing.
"""
from __future__ import annotations

import json
from typing import Optional

from crewai import Agent, Crew, Task
from crewai.tools import tool
from app.agents.single_agent import get_memory_client


def get_crew_llm():
    from app.config import LLM_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL, GROQ_API_KEY, GROQ_MODEL
    if LLM_PROVIDER == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            google_api_key=GEMINI_API_KEY,
            model=GEMINI_MODEL,
            temperature=0.5,
        )
    else:
        from langchain_groq import ChatGroq
        return ChatGroq(
            api_key=GROQ_API_KEY,
            model_name=GROQ_MODEL,
            temperature=0.5,
        )


# ---------------------------------------------------------------------------
# MCP-backed memory tools exposed as CrewAI tools
# ---------------------------------------------------------------------------

def _make_memory_tools(user_id: str):
    """Return CrewAI tool callables bound to a specific user_id."""

    @tool("memory_search")
    def memory_search(query: str) -> str:
        """Search the shared persistent memory store for relevant facts."""
        mem = get_memory_client()
        result = mem.search(query=query, user_id=user_id, limit=5)
        memories = result.get("results", result) if isinstance(result, dict) else result
        return json.dumps(memories, default=str)

    @tool("memory_add")
    def memory_add(content: str) -> str:
        """Store a new fact or preference in the shared persistent memory store."""
        mem = get_memory_client()
        result = mem.add(messages=content, user_id=user_id)
        return json.dumps(result, default=str)

    @tool("web_search_stub")
    def web_search_stub(query: str) -> str:
        """
        Stub web search tool — returns a canned result for demo purposes.
        Replace with a real search API (e.g. Tavily free tier) when needed.
        """
        return (
            f"[Stub search result for '{query}']: "
            "This is a placeholder. Integrate a free search API (e.g. Tavily) for real results."
        )

    return memory_search, memory_add, web_search_stub


# ---------------------------------------------------------------------------
# Crew factory
# ---------------------------------------------------------------------------

def build_crew(user_id: str) -> Crew:
    llm = get_crew_llm()

    memory_search_tool, memory_add_tool, web_search_tool = _make_memory_tools(user_id)

    researcher = Agent(
        role="Researcher",
        goal=(
            "Search for information requested by the user (or from a web query), "
            "then store any discovered facts in the shared memory store so the "
            "Personal Assistant can recall them."
        ),
        backstory=(
            "You are a meticulous research agent. You find facts and persist them "
            "so the team's memory grows over time."
        ),
        tools=[web_search_tool, memory_add_tool],
        llm=llm,
        verbose=True,
    )

    assistant = Agent(
        role="Personal Assistant",
        goal=(
            "Respond to the user's message in a helpful, personalised way by "
            "first retrieving relevant memories from the shared memory store."
        ),
        backstory=(
            "You are a warm, knowledgeable personal assistant. You always check "
            "shared memory before responding to personalise your answers."
        ),
        tools=[memory_search_tool],
        llm=llm,
        verbose=True,
    )

    return Crew(
        agents=[researcher, assistant],
        tasks=[],   # tasks are created per-request in run_crew()
        verbose=True,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_crew(user_message: str, user_id: str) -> str:
    """
    Run the two-agent crew for a single user turn.

    Flow:
      1. Researcher searches the web (stub) and stores new facts.
      2. Assistant retrieves memories and crafts the final reply.
    """
    llm = get_crew_llm()
    memory_search_tool, memory_add_tool, web_search_tool = _make_memory_tools(user_id)

    researcher = Agent(
        role="Researcher",
        goal="Search for information and store discovered facts in shared memory.",
        backstory="Meticulous fact-finding agent that persists knowledge for the team.",
        tools=[web_search_tool, memory_add_tool],
        llm=llm,
        verbose=True,
    )

    assistant = Agent(
        role="Personal Assistant",
        goal="Respond helpfully by recalling relevant memories first.",
        backstory="Warm personal assistant that always checks shared memory before responding.",
        tools=[memory_search_tool],
        llm=llm,
        verbose=True,
    )

    research_task = Task(
        description=(
            f"The user asked: '{user_message}'. "
            "Search for any relevant information and store key facts in shared memory."
        ),
        expected_output="A brief summary of what was found and stored.",
        agent=researcher,
    )

    reply_task = Task(
        description=(
            f"The user asked: '{user_message}'. "
            "Retrieve relevant memories and compose a helpful, personalised reply."
        ),
        expected_output="A natural-language reply to the user's message.",
        agent=assistant,
        context=[research_task],
    )

    crew = Crew(
        agents=[researcher, assistant],
        tasks=[research_task, reply_task],
        verbose=True,
    )

    result = crew.kickoff()
    return str(result)
