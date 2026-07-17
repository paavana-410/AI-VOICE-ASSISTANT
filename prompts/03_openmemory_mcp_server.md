# Step 3: Wrap Memory in an OpenMemory MCP Server

## Objective
Decouple the memory engine from the agent logic by wrapping the Mem0/MongoDB implementation in a standard Model Context Protocol (MCP) server. The backend agent will interact with memory solely by calling these standard tools, promoting modularity and compliance with the MCP standard.

---

## Instructions

### 1. Implement the MCP Server (`backend/app/mcp/memory_server.py`)
Using the `mcp` Python library, build a stdio-based MCP server named `openMemoryMCP`:
- **Define Tools:**
  1. `memory_search`: Arguments `query` (string), `user_id` (string), and optional `limit` (integer).
  2. `memory_add`: Arguments `content` (string) and `user_id` (string).
  3. `memory_delete`: Arguments `memory_id` (string) and `user_id` (string).
- **Tool Handling:**
  - Route incoming calls to the singleton Mem0 client (`get_memory_client()`).
  - Return outputs formatted as a list of `TextContent` objects containing JSON serialized response data.
- **Entrypoint:**
  - Provide a standalone runner that starts the `stdio` server asynchronously if the file is executed directly.

### 2. Implement the MCP Client (`backend/app/mcp/mcp_client.py`)
Create a client wrapper that:
- Spawns the MCP server as a subprocess using python stdio, OR executes memory operations directly by calling the server's handlers to mimic standard tool communication.
- Exposes `search(query, user_id)`, `add(content, user_id)`, and `delete(memory_id, user_id)` helper functions.

### 3. Rewire Single Agent (`backend/app/agents/single_agent.py`)
- Modify `chat_with_memory` so that if an `mcp_client` is passed/available, it calls `mcp_client.search(...)` and `mcp_client.add(...)` rather than referencing the raw Mem0 instance.
- This maintains clean separation of concern where the agent behaves as a client to the MCP server.

### 4. Implement Memory Inspector CRUD Endpoints (`backend/app/api/memory.py`)
Expose REST endpoints for the Memory Inspector UI:
- `GET /api/memory?user_id=...` -> fetch all memories (or search with empty string).
- `POST /api/memory` -> add new memory statement manually.
- `DELETE /api/memory/{memory_id}?user_id=...` -> delete memory by its ID.

---

## Verification Tasks
1. Launch the standalone MCP server:
   ```bash
   python -m app.mcp.memory_server
   ```
   *Verify it doesn't crash on boot and waits on stdio streams.*
2. Start the FastAPI app and verify that `/api/chat` still functions seamlessly, executing memory lookup and inserts through the MCP tool wrappers.
3. Call the HTTP GET memory endpoint:
   ```bash
   curl http://localhost:8000/api/memory?user_id=user_123
   ```
   *Expected reply: JSON list of all memories stored for `user_123`, showing memory IDs and content.*
