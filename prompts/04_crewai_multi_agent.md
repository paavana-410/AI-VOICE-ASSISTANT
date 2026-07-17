# Step 4: Multi-Agent CrewAI Shared-Memory Workflow

## Objective
Demonstrate that multiple autonomous agents can collaborate and share the same long-term memory store. You will implement a multi-agent workflow using CrewAI where a "Researcher" agent gathers information and writes it to MongoDB via MCP, and a "Personal Assistant" agent reads from the same memory to draft a personalized response.

---

## Instructions

### 1. Wrap MCP Tools for CrewAI (`backend/app/agents/crew_agents.py`)
Wrap the MCP tool endpoints (or direct Mem0 functions) as CrewAI `Tool` objects:
- `search_memory_tool`: Calls `memory_search` to find relevant user facts.
- `add_memory_tool`: Calls `memory_add` to save new facts.

### 2. Define the Agents
Using CrewAI:
1. **Researcher Agent:**
   - **Role:** Memory Researcher
   - **Goal:** Gather facts about the user's preferences, look up external stub info, and update the user's persistent memory.
   - **Tools:** `search_memory_tool`, `add_memory_tool`
2. **Personal Assistant Agent:**
   - **Role:** Personal Assistant
   - **Goal:** Synthesize information from the memory store to formulate a highly personalized and conversational response to the user.
   - **Tools:** `search_memory_tool`

### 3. Define the Crew Tasks and Run function
- **Task 1 (Research):** Task for the Researcher to identify and store new preferences/details from the user's request.
- **Task 2 (Synthesize):** Task for the Assistant to read all memories and write the final response.
- Create `run_crew(user_message: str, user_id: str) -> str` which compiles the crew and kicks off the process.

### 4. Wire the API Endpoint (`backend/app/api/crew.py`)
- Implement `POST /api/crew-chat`:
  - Request body: `CrewChatRequest` (contains `message`, `user_id`).
  - Logic: Calls `run_crew` and returns a `CrewChatResponse`.
  - Log both user prompt and crew response turns to the MongoDB history collection via `save_turn()`.

---

## Verification Tasks
1. Start the FastAPI server.
2. Execute a crew chat call:
   ```bash
   curl -X POST http://localhost:8000/api/crew-chat -H "Content-Type: application/json" -d '{"message": "I want to plan a trip. I hate cold weather and love beaches. Note this.", "user_id": "crew_user"}'
   ```
3. Check if the Researcher successfully added the facts to the memory store by searching via the memory GET API:
   ```bash
   curl http://localhost:8000/api/memory?user_id=crew_user
   ```
   *Verify that facts about hating cold weather and loving beaches were stored.*
4. Ask another query:
   ```bash
   curl -X POST http://localhost:8000/api/crew-chat -H "Content-Type: application/json" -d '{"message": "Suggest a destination.", "user_id": "crew_user"}'
   ```
   *Verify that the Assistant utilizes the beach/warm preference to suggest destinations like Hawaii or Miami, stating that it knows you hate cold weather.*
