"""
mcp/memory_server.py — OpenMemory MCP server wrapping Mem0.

Exposes three MCP tools:
  • memory_search  — semantic search over stored memories
  • memory_add     — store a new memory for a user
  • memory_delete  — delete a specific memory by its id

Run standalone (for testing):
    python -m app.mcp.memory_server

Or imported by mcp_client.py for in-process use.
"""
import json
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from app.agents.single_agent import get_memory_client

server = Server("openMemoryMCP")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="memory_search",
            description="Semantically search the persistent memory store for facts relevant to the query.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural-language query to search memories."},
                    "user_id": {"type": "string", "description": "The user whose memories to search."},
                    "limit": {"type": "integer", "default": 5, "description": "Max results to return."},
                },
                "required": ["query", "user_id"],
            },
        ),
        Tool(
            name="memory_add",
            description="Store a new fact or preference in the persistent memory store.",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The fact or preference to store."},
                    "user_id": {"type": "string", "description": "The user this memory belongs to."},
                },
                "required": ["content", "user_id"],
            },
        ),
        Tool(
            name="memory_delete",
            description="Delete a specific memory entry by its id.",
            inputSchema={
                "type": "object",
                "properties": {
                    "memory_id": {"type": "string", "description": "The id of the memory to delete."},
                    "user_id": {"type": "string", "description": "The user this memory belongs to."},
                },
                "required": ["memory_id", "user_id"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    mem = get_memory_client()

    if name == "memory_search":
        results = mem.search(
            query=arguments["query"],
            user_id=arguments["user_id"],
            limit=arguments.get("limit", 5),
        )
        memories = results.get("results", results) if isinstance(results, dict) else results
        return [TextContent(type="text", text=json.dumps(memories, default=str))]

    elif name == "memory_add":
        result = mem.add(
            messages=arguments["content"],
            user_id=arguments["user_id"],
        )
        return [TextContent(type="text", text=json.dumps(result, default=str))]

    elif name == "memory_delete":
        mem.delete(memory_id=arguments["memory_id"])
        return [TextContent(type="text", text=json.dumps({"deleted": arguments["memory_id"]}))]

    else:
        raise ValueError(f"Unknown tool: {name}")


async def run():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    import asyncio
    asyncio.run(run())
