# RFC: Vector DB Memory for Infinite Chat History

## Problem

The standalone chat page loads **all** previous messages into the LLM context on every agent run (`getSessionMessages()` in `agent.ts:193`). As conversations grow, this will:

1. **Exceed the model's context window** — messages are unbounded
2. **Increase latency and cost** — every token in the context is billed and adds time
3. **Degrade relevance** — distant messages dilute the LLM's attention on recent context

We need a strategy to keep conversations effectively "infinite" while only feeding the LLM the most relevant context at each turn.

## Current Architecture

```
User message → POST /api/chat/:assigneeId/message
  → insertMessages() (SQLite, sequential by `seq`)
  → publish to RabbitMQ

Worker → runAgent()
  → getSessionMessages(sessionId)    ← loads ALL messages
  → streamText({ messages: ALL })    ← sends ALL to LLM
  → insertMessages() (persist response)
```

**Mem0 service** (`mem0/main.py`) already exists as a FastAPI wrapper around the `mem0` library, backed by Qdrant or Upstash Vector. It exposes:
- `POST /memories` — store conversation memories
- `POST /search` — semantic search over memories
- `GET /memories` — list all memories for a user/agent
- `DELETE /memories/:id` — delete a specific memory

## Proposed Design

### Overview

Split the message context into two tiers:

| Tier | Source | Content | Window |
|------|--------|---------|--------|
| **Recent messages** | SQLite `messages` table | Full `ModelMessage[]` verbatim | Last N messages (e.g. 50) |
| **Long-term memory** | Mem0 (vector DB) | Summarized/extracted facts | Semantic top-K retrieval |

The LLM receives: `system prompt` + `retrieved memories` + `recent N messages`.

---

## 1. When to Write to Memory

### Trigger: After agent run completes

**Where:** `runAgent()` in `agent.ts`, after the agent loop finishes and messages are persisted (line ~375).

**What to store:** The newly generated conversation turn (user message + assistant response) as a pair. Mem0's `memory.add()` internally extracts facts, deduplicates, and manages the vector store — we don't need to summarize ourselves.

```
// Pseudocode — after agent loop completes (around agent.ts line 375)
// messageCountBeforeRun = messages.length captured before the agent loop started
const newTurnMessages = currentMessages.slice(messageCountBeforeRun);
await mem0Client.addMemory({
  messages: newTurnMessages.map(m => ({
    role: m.role,
    content: extractTextContent(m.content),  // flatten to plain text
  })),
  user_id: userId,
  agent_id: session.assigneeId,
  run_id: sessionId,
});
```

### Why after completion (not during):

- **Atomic:** We only store complete turns, never partial streams
- **Non-blocking:** Memory write is async and doesn't delay the user's response
- **Deduplicated:** Mem0 handles dedup internally; writing once per turn is clean
- **Tool results included:** The full turn includes tool call results, which contain valuable factual context

### What NOT to write:

- Raw tool-call/tool-result message parts (too noisy; Mem0 extracts the relevant facts)
- System prompts (static, not conversational)
- Messages from an aborted/errored run (incomplete context)

---

## 2. When and How to Read Memory

### Trigger: At the start of `runAgent()`, before calling `streamText()`

**Where:** `runAgent()` in `agent.ts`, between loading messages (line ~193) and calling `streamText()` (line ~219).

### Step 1: Trim to recent window

Instead of sending all messages, take only the last N messages (configurable, e.g., 50):

```
const allMessages = await getSessionMessages(sessionId);
const recentMessages = allMessages.slice(-RECENT_WINDOW_SIZE);
```

### Step 2: Semantic retrieval from memory

Use the **latest user message** as the search query to retrieve relevant long-term memories.
If no user message exists in the recent window (edge case: only tool/assistant messages), skip memory retrieval and proceed with recent messages only:

```
const lastUserMessage = getLastUserMessage(recentMessages);
// Skip memory retrieval if no user message found (e.g., resumed confirmation-only turn)
const memories = lastUserMessage
  ? await mem0Client.search({
      query: lastUserMessage,
      user_id: userId,
      agent_id: session.assigneeId,
      limit: 10,
    })
  : [];
```

### Step 3: Inject into system prompt

Prepend retrieved memories to the system prompt as structured context:

```
const memoryBlock = memories.map(m => `- ${m.memory}`).join("\n");

const enrichedSystemPrompt = `${systemPrompt}

## Relevant context from previous conversations
${memoryBlock}

Use this context when relevant, but prioritize the recent conversation.`;
```

### Why system prompt injection (not extra messages):

- **Clean separation** — memories are context, not conversation turns
- **No confusion** — the LLM won't try to "respond" to injected memories
- **Controllable** — easy to tune the amount of injected context
- **Compatible** — works with any model, no special message format needed

### Alternative: Memory as a tool

An alternative approach is to expose Mem0 search as a tool the agent can invoke itself (e.g., `search_memory`). This lets the LLM decide when it needs more context. However, this adds latency (extra tool-call round-trip) and relies on the LLM knowing when to search. **Recommended:** Start with automatic injection, add the tool later for on-demand deep retrieval.

---

## 3. When to Delete Memory

### 3a. User clears chat messages

**Trigger:** `DELETE /api/chat/:assigneeId/messages` (existing endpoint that calls `deleteSessionMessages()`).

**Action:** Also delete all memories scoped to that session:

```
await mem0Client.deleteAll({
  user_id: userId,
  agent_id: assigneeId,
  run_id: sessionId,
});
```

**Rationale:** If the user explicitly clears their chat, they expect a fresh start. Keeping ghost memories from a cleared conversation would be surprising.

### 3b. User deletes an assignee

**Trigger:** `DELETE /api/assignees/:id` (existing endpoint).

**Action:** Delete all memories scoped to that agent:

```
await mem0Client.deleteAll({
  user_id: userId,
  agent_id: assigneeId,
});
```

**Rationale:** Deleting an assignee means all conversations with that agent are gone. Memories should follow.

### 3c. Mem0 self-management (automatic)

Mem0 internally manages memory lifecycle:
- **Deduplication:** Identical or near-identical memories are merged
- **Updates:** If new information contradicts an old memory, Mem0 updates it
- **No TTL needed initially:** Memories represent factual context, not ephemeral state

### 3d. NOT deleted on:

- **App restart** — memories are persistent
- **Session status changes** — stopping/starting a session doesn't affect memory
- **Token refresh** — authentication changes don't affect stored knowledge

---

## Implementation Phases

### Phase 1: Write path (low risk)
- Add Mem0 client to backend (`lib/memory/client.ts`)
- Call `addMemory()` after successful agent runs in `runAgent()`
- No read path yet — existing behavior unchanged

### Phase 2: Read path (context trimming)
- Add `RECENT_WINDOW_SIZE` config (default: 50)
- Trim messages to recent window in `runAgent()`
- Retrieve memories via `search()` and inject into system prompt

### Phase 3: Delete path (cleanup)
- Hook into `deleteSessionMessages()` to also clear session memories
- Hook into assignee deletion to clear agent memories

### Phase 4: Memory tool (optional)
- Expose `search_memory` as an agent tool for on-demand retrieval
- Useful for questions like "what did we discuss last week about X?"

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MEM0_API_URL` | `http://mem0:8000` | Mem0 service endpoint |
| `RECENT_WINDOW_SIZE` | `50` | Number of recent messages to include verbatim |
| `MEMORY_SEARCH_LIMIT` | `10` | Max memories to retrieve per query |
| `MEMORY_ENABLED` | `false` | Feature flag to enable/disable memory |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Mem0 service down | Memory write/read failures should be non-fatal; agent works without memories (graceful degradation) |
| Irrelevant memories injected | Tune search limit and relevance threshold; add "Use this context when relevant" instruction |
| Sensitive data in vector DB | Memories are scoped by `user_id`; Mem0 inherits the same access control as the chat |
| Increased latency from search | Memory search is fast (~50ms for vector similarity); parallelize with message loading |
| Context window still exceeded | Cap total tokens: recent messages + memories must fit within model limit minus response budget. Token counting should happen in `runAgent()` after assembling the full prompt — use a tokenizer (e.g., `tiktoken`) to measure, then trim oldest recent messages or reduce memory results until within budget. Exact thresholds are model-specific and should be configurable. |
