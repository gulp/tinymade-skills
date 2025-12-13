---
name: gemini-offloader
description: Offload context-heavy tasks to Google Gemini via gemini-cli with warm session support and persistent vector memory. Use when user requests research with web search, large document summarization, multi-turn research sessions, or exploratory searches that would pollute Claude's context. Triggers include "ask Gemini", "offload to Gemini", "Gemini search", "research with Gemini", "continue Gemini session", "remember this research", or any request explicitly delegating work to Gemini. Also use proactively when a task would benefit from Gemini's 1M token context, Google Search grounding, or when building on previous research.
---

# Gemini Context Offloader

Delegate context-heavy work to Gemini via CLI with warm sessions for multi-turn research and mem0 vector store for persistent memory.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude (Main Context)                     │
│                                                             │
│  1. User requests research                                  │
│  2. Claude invokes bundled scripts (Bun - deterministic)    │
│  3. Scripts return JSON → Claude presents results           │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ gemini-cli   │ │   Sessions   │ │   mem0.ai    │
│ (1M context) │ │ (warm state) │ │ (vector DB)  │
└──────────────┘ └──────────────┘ └──────────────┘
```

## When to Use

**Good candidates for Gemini offloading:**
- Web research needing Google Search grounding
- Multi-turn research sessions (warm sessions preserve context)
- Summarizing large documents (>50k tokens)
- Building on previous research (mem0 retrieval)
- Comparing technologies or gathering external knowledge

**Keep in Claude's context:**
- Codebase analysis (Claude has better tool access)
- File editing and manipulation
- Tasks requiring direct conversation continuity

## Bundled Scripts (Bun/TypeScript)

Execute these directly for deterministic, token-efficient operations.

### Check Status
```bash
bun run scripts/status.ts
```
Output: `{"installed": true, "authenticated": true, "sessions": [...]}`

### Single Query
```bash
# Basic query with JSON output
bun run scripts/query.ts --prompt "Explain WASM for backends"

# With local directory context
bun run scripts/query.ts --prompt "Analyze architecture" --include-dirs ./src,./docs

# Save response to file
bun run scripts/query.ts --prompt "Research topic X" --output research.md

# Pipe content for summarization
cat large-doc.md | bun run scripts/query.ts --prompt "Summarize key points"
```

### Warm Sessions (Multi-turn Research)
```bash
# List existing sessions
bun run scripts/session.ts list

# Create named session for ongoing research
bun run scripts/session.ts create --name "wasm-research" --prompt "Research WebAssembly for server-side"

# Continue named session
bun run scripts/session.ts continue --name "wasm-research" --prompt "Compare Wasmtime vs Wasmer"

# Continue latest session
bun run scripts/session.ts continue --prompt "Go deeper on performance"

# Resume specific session by index
bun run scripts/session.ts resume --index 2 --prompt "Continue from here"

# Delete old session
bun run scripts/session.ts delete --index 5
```

### Persistent Memory (mem0.ai)
```bash
# Check if mem0 is available
bun run scripts/memory.ts status

# Store research finding
bun run scripts/memory.ts add --user "research" --topic "wasm" \
  --text "Key finding: Wasmtime has best cold-start performance at 0.5ms"

# Search past research
bun run scripts/memory.ts search --user "research" --query "WASM performance"

# Store gemini response directly
bun run scripts/query.ts -p "Research X" | bun run scripts/memory.ts store-response \
  --user "research" --topic "topic-x"

# Get all memories on a topic
bun run scripts/memory.ts get --user "research"
```

## Workflows

### One-Shot Research
```bash
# Check status
bun run scripts/status.ts

# Execute query
bun run scripts/query.ts --prompt "Provide comprehensive 2024 overview of [TOPIC]: current state, key players, use cases, limitations, trajectory"
```

### Multi-Turn Deep Dive
```bash
# Start named session
bun run scripts/session.ts create --name "deep-dive-X" \
  --prompt "I'm researching X. Give me an overview to start."

# Follow up questions (context preserved)
bun run scripts/session.ts continue --name "deep-dive-X" \
  --prompt "Go deeper on the performance characteristics"

bun run scripts/session.ts continue --name "deep-dive-X" \
  --prompt "What are the main criticisms and limitations?"

# Store final synthesis
bun run scripts/session.ts continue --name "deep-dive-X" \
  --prompt "Synthesize everything into actionable recommendations" \
  | bun run scripts/memory.ts store-response --user "research" --topic "X"
```

### Research with Memory Retrieval
```bash
# Search past research first
bun run scripts/memory.ts search --user "research" --query "topic keywords"

# If relevant memories found, include in new query
bun run scripts/query.ts --prompt "Building on prior research that [MEMORY], now explore [NEW ANGLE]"

# Store new findings
bun run scripts/memory.ts add --user "research" --topic "topic" \
  --text "New finding: ..."
```

## Prompt Patterns

| Task Type | Prompt Structure |
|-----------|------------------|
| Research | "Provide comprehensive overview of X: current state, key features, use cases, recent developments" |
| Comparison | "Compare A vs B across: features, performance, ecosystem, learning curve, use cases" |
| Summarization | "Summarize the following, extracting key points, decisions, and action items" |
| Examples | "Find 3-5 real-world production examples of X pattern with explanations" |
| Deep Dive | "Go deeper on [aspect]. Include technical details, tradeoffs, and edge cases" |
| Synthesis | "Synthesize everything discussed into actionable recommendations" |

## Error Handling

| Error | Resolution |
|-------|------------|
| `gemini-cli not found` | `npm install -g @google/gemini-cli` |
| `authentication required` | Run `gemini` interactively to login, or set `GEMINI_API_KEY` |
| `rate limit exceeded` | Free tier: 60 req/min, 1000 req/day. Wait or use API key |
| `mem0 not installed` | `bun add mem0ai` (requires OpenAI API key for embeddings) |
| `session not found` | Use `session.ts list` to see available sessions |

## Installation

**Required:**
```bash
npm install -g @google/gemini-cli
```

**For running scripts (Bun):**
```bash
# Bun is typically pre-installed with Claude Code
# If not: curl -fsSL https://bun.sh/install | bash
```

**Optional (for mem0 memory):**
```bash
cd plugins/gemini-offloader/skills/gemini-offloader
bun add mem0ai
export OPENAI_API_KEY="..."  # Required for mem0 embeddings
```

## Notes

- Gemini has 1M token context (vs Claude's ~200k in conversation)
- Free tier available with Google login (no API key needed)
- Warm sessions persist across CLI invocations (per-project)
- mem0 provides semantic search across all research sessions
- Scripts output JSON for reliable parsing - no code regeneration needed
- Bun scripts start faster than Python (~10ms vs ~100ms cold start)
