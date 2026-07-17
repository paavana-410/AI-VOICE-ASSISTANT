# Step 5: Build React + Vite Frontend & Memory Inspector UI

## Objective
Build a visually stunning, responsive React web interface that allows testing the AI Assistant in real time. The interface must provide a chat window with a toggle between Single-Agent and Multi-Agent paths, a Sidebar for User ID isolation, and a "Memories" inspector tab to view, add, or delete stored facts from MongoDB Atlas.

---

## Technical Stack & Structure
- **Framework:** React with Vite
- **Styling:** Premium Vanilla CSS (custom properties, dark mode, smooth micro-animations, glassmorphism).
- **Core files to create:**
  ```text
  frontend/
    src/
      App.jsx
      App.css
      api.js                     # Fetch wrappers
      components/
        ChatWindow.jsx
        ChatWindow.css
        MemoryInspector.jsx
        MemoryInspector.css
    index.html
    package.json
    vite.config.js
  ```

---

## Instructions

### 1. Build API client wrapper (`frontend/src/api.js`)
Implement simple HTTP request handlers using `fetch`:
- `sendChatMessage(message, userId, isCrew)`: Sends a POST request to `/api/chat` (if `isCrew` is false) or `/api/crew-chat` (if `isCrew` is true).
- `getMemories(userId)`: GET request to `/api/memory?user_id=${userId}`.
- `addMemory(content, userId)`: POST request to `/api/memory` with `{content, user_id}`.
- `deleteMemory(memoryId, userId)`: DELETE request to `/api/memory/${memoryId}?user_id=${userId}`.

### 2. Design the Layout (`frontend/src/App.jsx` & `App.css`)
- **Sidebar Navigation:**
  - Application logo/title ("MemAI").
  - Tab selectors: "💬 Chat" and "🧠 Memories".
  - Active User ID selection (editable chip/button allowing the user to change their `user_id` to test isolation).
  - Static footer showcasing the zero-cost stack credits.
- **Main View Area:** Renders the active tab based on state (`chat` or `memory`).

### 3. Create the Chat Component (`frontend/src/components/ChatWindow.jsx` & `ChatWindow.css`)
- **Routing Selector:** A toggle/switch to select between "Single Agent (LangChain)" and "Multi-Agent (CrewAI)".
- **Message List:** Chronological bubbles indicating "user" vs "assistant" (and "[crew]" for multi-agent).
- **Interactive State:** Show a pulsing loading indicator while waiting for the API reply.
- **Input Bar:** Message input field with a Send button.

### 4. Create the Memory Inspector (`frontend/src/components/MemoryInspector.jsx` & `MemoryInspector.css`)
- **Display List:** Shows list items of each memory returned from the database. Each card should list the text fact and a prominent "Delete" button.
- **Form Input:** A "Create Memory" bar to insert a text fact manually without having to state it in chat.
- **Refresh Control:** A "Refresh" button to reload the memory list from MongoDB Atlas.

### 5. Styling Guidelines (Premium Visuals)
- **Colors:** Use a modern dark palette: dark slate background (`#0f172a`), deep gray panels (`#1e293b`), neon indigo highlights (`#6366f1`), and clean borders (`#334155`).
- **Typography:** Import and apply Google Fonts "Inter" or "Outfit".
- **Hover Micro-animations:** Translate buttons slightly upwards (`transform: translateY(-2px)`) and change opacities on hover.
- **Responsive:** Ensure sidebar collapses or stacks nicely on mobile viewports.

---

## Verification Tasks
1. Run the frontend server:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
2. Navigate to `http://localhost:5173`.
3. Verify that typing messages saves facts, and switching to the "Memories" tab lists those facts correctly.
4. Delete a fact in the UI and verify it is removed from the MongoDB collection immediately.
