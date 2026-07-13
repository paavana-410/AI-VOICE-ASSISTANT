"""
mcp/mcp_client.py — MCP client used by LangChain and CrewAI agents.

Starts the MCP server as a subprocess (stdio transport) and provides
a thin Python wrapper so agent code can call the three memory tools
without knowing about MCP internals.
"""
import asyncio
import json
import subprocess
import sys
from typing import Any


class MCPMemoryClient:
    """
    Synchronous wrapper around the MCP memory server.

    Usage:
        client = MCPMemoryClient()
        results = client.search("favorite color", user_id="alice")
        client.add("Alice likes blue", user_id="alice")
        client.delete(memory_id="abc123", user_id="alice")
        client.close()
    """

    def __init__(self):
        # Import here to avoid circular imports at module load time
        from mcp import ClientSession
        from mcp.client.stdio import StdioServerParameters, stdio_client

        self._ClientSession = ClientSession
        self._stdio_client = stdio_client
        self._StdioServerParameters = StdioServerParameters
        self._session = None
        self._context = None
        self._loop = asyncio.new_event_loop()
        self._loop.run_until_complete(self._connect())

    async def _connect(self):
        params = self._StdioServerParameters(
            command=sys.executable,
            args=["-m", "app.mcp.memory_server"],
        )
        self._context = self._stdio_client(params)
        streams = await self._context.__aenter__()
        self._session = self._ClientSession(*streams)
        await self._session.__aenter__()
        await self._session.initialize()

    def _run(self, coro):
        return self._loop.run_until_complete(coro)

    def search(self, query: str, user_id: str, limit: int = 5) -> list[dict]:
        result = self._run(
            self._session.call_tool(
                "memory_search",
                {"query": query, "user_id": user_id, "limit": limit},
            )
        )
        raw = result.content[0].text if result.content else "[]"
        return json.loads(raw)

    def add(self, content: str, user_id: str) -> dict:
        result = self._run(
            self._session.call_tool(
                "memory_add",
                {"content": content, "user_id": user_id},
            )
        )
        raw = result.content[0].text if result.content else "{}"
        return json.loads(raw)

    def delete(self, memory_id: str, user_id: str) -> dict:
        result = self._run(
            self._session.call_tool(
                "memory_delete",
                {"memory_id": memory_id, "user_id": user_id},
            )
        )
        raw = result.content[0].text if result.content else "{}"
        return json.loads(raw)

    def close(self):
        async def _close():
            if self._session:
                await self._session.__aexit__(None, None, None)
            if self._context:
                await self._context.__aexit__(None, None, None)

        self._run(_close())
        self._loop.close()


# Module-level singleton — created lazily
_mcp_client: MCPMemoryClient | None = None


def get_mcp_client() -> MCPMemoryClient:
    global _mcp_client
    if _mcp_client is None:
        _mcp_client = MCPMemoryClient()
    return _mcp_client
