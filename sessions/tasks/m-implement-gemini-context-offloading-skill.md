---
name: m-implement-gemini-context-offloading-skill
branch: feature/gemini-context-offloading-skill
status: completed
created: 2025-12-13
---

# Gemini Context Offloading Skill

## Problem/Goal

Create a portable Claude Code skill that uses gemini-cli to offload heavy context tasks. When Claude's context window gets large or when research/summarization tasks would pollute the main conversation, this skill delegates to Gemini via its CLI.

Use cases:
- Research tasks that need extensive web fetching
- Summarizing large documents before bringing insights back
- Exploratory searches where you don't want to pollute Claude's context
- Parallel investigation while main Claude session continues

The skill should be portable across Claude Code projects (not specific to design-your-life).

## Success Criteria

- [x] SKILL.md created for gemini-cli context offloading
- [x] Skill invokes gemini-cli for offloading heavy context tasks (research, summarization, etc.)
- [x] Portable design (works across Claude Code projects, not design-your-life specific)
- [x] Documented usage patterns and triggers

## Context Manifest

### How Claude Code Skills Currently Work

Claude Code skills are specialized, reusable prompt templates stored as Markdown files with YAML frontmatter in the `.claude/skills/` directory. When a user makes a request that matches a skill's description, Claude Code can invoke that skill to handle the interaction using a predefined workflow.

**File Structure:** Each skill lives in its own directory under `.claude/skills/<skill-name>/` and contains at minimum a `SKILL.md` file. The frontmatter defines the skill's metadata:

```markdown
---
name: skill-name
description: Natural language description of when this skill should be used. Triggers include specific phrases...
---

# Skill Name

[Skill workflow documentation follows...]
```

The `name` field is a unique identifier (lowercase, hyphens). The `description` field is critical - it tells Claude Code when to proactively invoke this skill. Skills with phrases like "Use when user requests..." or explicit trigger patterns get matched against user input.

**Skill Invocation Pattern:** Skills are NOT subagents (which use the Task tool and have separate context windows). Skills are workflow templates that Claude follows within the main conversation context. When Claude sees a user request matching a skill's description, it reads the SKILL.md file and follows the documented workflow steps.

**Existing Skills in This Codebase:**

1. **daily-journaler** (`/.claude/skills/daily-journaler/SKILL.md`) - Interactive journaling with context selection menu. Shows pattern of offering multiple sub-workflows (morning/activity/evening).

2. **journal-morning** (`/.claude/skills/journal-morning/SKILL.md`) - Morning reflection workflow. Uses Python helper functions via libs/journal_helpers.py for file operations to minimize token usage.

3. **journal-activity** (`/.claude/skills/journal-activity/SKILL.md`) - Activity logging throughout day. Demonstrates token-efficient pattern: Python handles file I/O, not Read tool.

4. **journal-evening** (`/.claude/skills/journal-evening/SKILL.md`) - Evening reflection with conversation-based approach (not just form-filling). Shows pattern of reading past entries to identify patterns.

5. **idea-parker** (`/.claude/skills/idea-parker/SKILL.md`) - Fast idea capture skill. Demonstrates minimal-friction workflow pattern - captures ideas in under 30 seconds without breaking focus.

6. **linkedin-analyzer** (`/.claude/skills/linkedin-analyzer/SKILL.md`) - Batch processing skill for analyzing multiple files. Shows pattern for handling collections of data.

**Portability Pattern:** Looking at the existing skills, ALL of them are specific to the design-your-life project - they reference project-specific paths (`/home/gulp/projects/design-your-life/journal/`, `odyssey-plans/`, `market-analysis/`), use project-specific Python libraries (`libs/journal_helpers.py`), and assume project-specific data structures (DYL methodology, journal templates).

For a skill to be truly portable across Claude Code projects:
- Cannot hardcode paths to specific projects
- Cannot depend on project-specific libraries or data structures
- Should work with user-level installation (~/.claude/skills/) not just project-level
- Should handle its own file operations or use only Claude Code's built-in tools
- Should gracefully detect if required external dependencies exist

**File Operations Pattern:** The journaling skills demonstrate two approaches:
1. Use Python helper functions that abstract file operations (journal_helpers.py)
2. Use Claude Code's built-in Read/Edit/Write tools directly

For portable skills, option 2 is better (no dependency on project libraries).

**Token Efficiency Pattern:** The journal skills explicitly optimize for minimal context pollution:
- journal-activity: "Python handles file I/O (no Read tool needed), Direct append operation (doesn't load full file)"
- journal-evening: "Python reads journal file (not loaded into LLM context), Only Activity Log section shown for review"

This is exactly the problem the gemini-cli skill should solve - offload heavy context tasks to prevent polluting Claude's context window.

### How Claude Code Subagents Work (For Comparison)

Subagents are NOT the same as skills. Understanding the difference is critical:

**Subagents** (stored in `.claude/agents/`):
- Have their own separate context window
- Are invoked via the Task tool
- Can be configured with specific tool permissions
- Operate independently and return results
- Examples in this project: context-gathering, logging, context-refinement

**Skills** (stored in `.claude/skills/`):
- Are workflow templates followed in the main conversation
- Share the same context window as the main conversation
- Cannot offload context - they operate within Claude's current session
- Are about guiding the interaction pattern, not delegation

The gemini-cli skill should enable Claude to delegate context-heavy work to an external AI (Gemini) similar to how subagents delegate to separate Claude instances, but using a different AI entirely.

### How Context-Gathering Agent Works (Parallel Pattern)

The context-gathering agent demonstrates the offloading pattern we want to replicate:

**Location:** `.claude/agents/context-gathering.md`

**Purpose:** "Use when creating a new task OR when starting/switching to a task that lacks a context manifest. ALWAYS provide the task file path so the agent can read it and update it directly with the context manifest."

**Why It Exists:** From sessions/CLAUDE.sessions.md:
```
When you need to answer a question that would require reading many files (polluting your context window), use the context-gathering agent instead.

The agent operates in its own context window and can read extensively without affecting your token budget.
```

**Invocation Pattern:** User or main Claude explicitly delegates: "Use the context-gathering subagent to research X and write to the task file" or Claude proactively delegates during task startup.

**Key Constraint:** The agent can only Edit/MultiEdit the task file it's given. It cannot touch other files in the codebase.

**Output:** Either writes findings to task file's Context Manifest section OR returns findings directly in response.

This is the closest parallel to what the gemini-cli skill should do, but with Gemini instead of a Claude subagent.

### How Gemini CLI Works

**Official Package:** `@google/gemini-cli` (npm package, version 0.20.2 as of Dec 2024)
- TypeScript-based CLI tool
- Brings Google Gemini API access to terminal
- Apache 2.0 licensed
- Main repo: https://github.com/google-gemini/gemini-cli

**Installation:**
```bash
npm install -g @google/gemini-cli
# OR run without install:
npx @google/gemini-cli
```

**Authentication Options:**
1. Login with Google (OAuth) - Free tier: 60 req/min, 1000 req/day
2. API Key (GEMINI_API_KEY env var) - Usage-based billing
3. Vertex AI (GOOGLE_API_KEY + GOOGLE_GENAI_USE_VERTEXAI=true) - Enterprise

**Key Capabilities:**
- Access to Gemini 2.5 Pro with 1M token context window
- Built-in tools: Google Search grounding, file operations, shell commands, web fetching
- MCP (Model Context Protocol) support for extensions
- Terminal-first design

**Non-Interactive Mode (Critical for Skill Usage):**

```bash
# Simple text response:
gemini -p "Explain the architecture of this codebase"

# JSON output for programmatic use:
gemini -p "Research topic X" --output-format json

# Stream JSON for monitoring long operations:
gemini -p "Summarize these 50 files" --output-format stream-json
```

**Key Features for Context Offloading:**
- Can process large codebases without loading into current context
- Can query and edit files
- Can perform web searches (Google Search grounding)
- Can handle multimodal inputs (PDFs, images, sketches)
- Conversation checkpointing to save/resume sessions
- Custom context files (GEMINI.md) for project-specific behavior

**Use Cases Matching Our Need:**
From the README: "Run non-interactively in scripts for workflow automation"
- Research tasks needing extensive web fetching
- Summarizing large documents before bringing insights back
- Exploratory searches where you don't want to pollute Claude's context
- Querying and understanding large codebases

### For New Feature Implementation: Gemini Context Offloading Skill

Since we're building a portable Claude Code skill that uses gemini-cli to offload context-heavy tasks, here's what needs to connect:

**Skill Architecture Decision:**

The skill should be a workflow template that guides Claude through delegating work to Gemini via the CLI, not a subagent. This means:

1. **User or Claude initiates:** "Research X using Gemini" or "Offload this summarization to Gemini"
2. **Skill workflow activates:** Claude reads the SKILL.md template
3. **Claude executes Bash commands:** Using the Bash tool to invoke `gemini -p "prompt" --output-format json`
4. **Results return to main context:** Claude processes Gemini's output and presents to user

**Portability Requirements:**

To work across any Claude Code project (not just design-your-life):

1. **Installation Detection:** Check if gemini-cli is installed, provide installation instructions if not
2. **Authentication Detection:** Check for API key or OAuth login, guide setup if needed
3. **No Project-Specific Paths:** Cannot assume any particular directory structure
4. **Work with Current Directory:** Use Claude's cwd (current working directory) as context
5. **User-Level Skill Location:** Should be installed to `~/.claude/skills/gemini-offloader/` so it's available in all projects

**Integration Points:**

The skill will integrate with:
- **Bash tool:** To execute `gemini` CLI commands
- **Claude's conversation context:** To formulate prompts for Gemini based on user's request
- **File system:** Optionally save Gemini's outputs to files for review

**Workflow Pattern (Based on Existing Skills):**

Looking at idea-parker and linkedin-analyzer, the pattern should be:

```markdown
## When to Use This Skill

Use this skill when the user requests:
- "Research X using Gemini"
- "Offload context to Gemini"
- "Gemini search for X"
- "Ask Gemini about X"
- Any request involving heavy context that would pollute Claude's window

## Workflow

### Step 1: Verify Gemini CLI Installation

Check if gemini-cli is available:
```bash
which gemini-cli || which gemini
```

If not found, provide installation instructions and exit.

### Step 2: Check Authentication

Verify authentication by attempting a simple query:
```bash
gemini -p "test" --output-format json
```

If fails, provide authentication setup guidance.

### Step 3: Formulate Delegation Prompt

Based on user's request, construct appropriate prompt for Gemini.
Consider:
- Research scope
- Output format needed
- Context from current directory (if relevant)

### Step 4: Execute Gemini Query

```bash
gemini -p "<constructed prompt>" --output-format json
```

For long-running tasks, use --output-format stream-json to provide progress.

### Step 5: Process and Present Results

Parse Gemini's JSON output and present key findings to user.
Optionally save full output to file for detailed review.
```

**Error Handling:**

Must handle:
- gemini-cli not installed
- Authentication not configured
- API rate limits exceeded
- Network errors
- Gemini API errors

Each should provide helpful error messages with next steps.

**Comparison to Context-Gathering Agent:**

| Aspect | Context-Gathering Agent | Gemini Offloading Skill |
|--------|------------------------|------------------------|
| Execution | Separate Claude instance (Task tool) | External AI via CLI (Bash tool) |
| Context Window | Independent Claude context | External Gemini context |
| Cost | Claude API costs | Gemini API costs (free tier available) |
| Capabilities | Claude Code tools (Read, Grep, Glob, Edit) | Gemini capabilities (Search, multimodal, 1M context) |
| Output Location | Writes to task files OR returns response | Returns response OR saves to file |
| When to Use | Need Claude's deep codebase analysis | Need web research, large document summarization, exploration |

**Key Design Decisions:**

1. **Skill vs Subagent:** Make it a skill (workflow template) not a subagent, because:
   - Simpler to use (no Task tool complexity)
   - More portable (no dependency on cc-sessions framework)
   - User controls delegation explicitly

2. **Output Format:** Default to JSON output from Gemini for programmatic parsing, but support streaming for long operations

3. **Session Management:** For now, stateless queries. Future enhancement could use Gemini's conversation checkpointing for multi-turn research

4. **Scope Control:** The skill should help Claude formulate focused prompts for Gemini rather than dumping entire context. Think: "What specific question would answer the user's need?"

### Technical Reference Details

#### Gemini CLI Command Patterns

```bash
# Basic query
gemini -p "your prompt here"

# JSON output (for parsing)
gemini -p "your prompt" --output-format json

# Stream JSON (for long operations)
gemini -p "your prompt" --output-format stream-json

# Specify model
gemini -m gemini-2.5-flash -p "your prompt"

# Include additional directories
gemini --include-directories ../lib,../docs -p "your prompt"
```

#### JSON Output Structure

When using `--output-format json`, Gemini returns:
```json
{
  "response": "The actual response text",
  "model": "gemini-2.5-pro",
  "usage": {
    "promptTokens": 100,
    "completionTokens": 200,
    "totalTokens": 300
  }
}
```

(Note: Actual schema may vary, need to test)

#### Environment Variables

```bash
# API Key auth
export GEMINI_API_KEY="YOUR_API_KEY"

# Vertex AI auth
export GOOGLE_API_KEY="YOUR_API_KEY"
export GOOGLE_GENAI_USE_VERTEXAI=true
```

#### Skill Frontmatter Format

```yaml
---
name: gemini-offloader
description: Use when user requests context offloading to Gemini, research tasks requiring web search, or heavy summarization. Triggers include "ask Gemini", "offload to Gemini", "Gemini search", "research with Gemini".
---
```

#### File Locations

- Portable skill location: `~/.claude/skills/gemini-offloader/SKILL.md`
- Project-specific override: `.claude/skills/gemini-offloader/SKILL.md` (if user wants project-specific behavior)
- Optional support files: `~/.claude/skills/gemini-offloader/examples.md` (example prompts)

#### Installation Detection Script

```bash
# Check if gemini is available
if command -v gemini &> /dev/null; then
    echo "gemini-cli is installed"
    gemini --version
else
    echo "gemini-cli not found. Install with:"
    echo "  npm install -g @google/gemini-cli"
    echo "Or run without install:"
    echo "  npx @google/gemini-cli"
fi
```

#### Authentication Detection Script

```bash
# Test authentication
if gemini -p "test" --output-format json 2>&1 | grep -q "error\|authentication"; then
    echo "Authentication required. Options:"
    echo "1. Login with Google: gemini (then select Login with Google)"
    echo "2. API Key: export GEMINI_API_KEY=your_key"
    echo "3. Vertex AI: export GOOGLE_API_KEY=your_key && export GOOGLE_GENAI_USE_VERTEXAI=true"
else
    echo "Authentication configured"
fi
```

#### Error Handling Patterns

Common errors to handle:
- `command not found: gemini` → Installation guidance
- `authentication required` → Auth setup guidance
- `rate limit exceeded` → Suggest waiting or upgrading
- `network error` → Check connectivity
- `invalid prompt` → Help reformulate

#### Use Case Mapping

| User Request | Gemini Prompt Strategy |
|--------------|------------------------|
| "Research X technology" | "Provide a comprehensive overview of X including current state, key features, use cases, and recent developments" |
| "Summarize these files" | Include file list, ask for structured summary with key points |
| "Find examples of X pattern" | "Search for and explain 3-5 real-world examples of X pattern in production use" |
| "Compare A vs B" | "Compare A and B across dimensions: features, use cases, performance, ecosystem, learning curve" |

#### Integration with Existing Patterns

This skill complements but doesn't replace:
- **context-gathering agent:** Use when you need Claude's deep codebase analysis with tool access
- **gemini-offloader skill:** Use when you need web research, large document summarization, or external knowledge
- **Regular Claude conversation:** Use when context is manageable and no offloading needed

#### Success Metrics

A successful implementation will:
- Install in `~/.claude/skills/gemini-offloader/`
- Work in any Claude Code project (not just design-your-life)
- Detect gemini-cli installation status
- Guide authentication setup if needed
- Accept natural language delegation requests
- Formulate focused prompts for Gemini
- Parse and present Gemini's responses clearly
- Handle errors gracefully with helpful guidance
- Provide examples of good use cases vs bad use cases

#### Future Enhancements (Out of Scope for MVP)

- Conversation checkpointing for multi-turn research
- Automatic context pruning (decide what to send to Gemini)
- Cost tracking (token usage across queries)
- Integration with GEMINI.md project context files
- MCP server connections for specialized capabilities

## User Notes

- Emerged from immediate need while writing metaprompting textbook
- Parked idea (from 2025-12-13 journal): [12:14] - Claude skill using gemini-cli for context offloading
- Should complement Claude Code's Task tool pattern (offload to another AI instead of subagent)

## Work Log

### 2025-12-13

#### Completed
- Created gemini-offloader skill with deterministic bundled scripts
- Implemented warm session management and context preservation
- Added mem0.ai vector store integration for persistent research memory
- Registered plugin in .claude-plugin/marketplace.json
- Created feature/gemini-context-offloading-skill branch with 3 commits

#### Decisions
- **TypeScript over Python**: Rewrote all scripts in TypeScript for Bun runtime (Anthropic acquired Bun, likely native to Claude Code)
- **Bundled scripts pattern**: Following Plane skills architecture for deterministic execution without code regeneration
- **Warm sessions**: Using gemini-cli's built-in session checkpointing with local state tracking
- **mem0.ai integration**: Optional vector store for persistent memory across sessions

#### Implementation Details

**Bundled Scripts (TypeScript/Bun):**
- `scripts/status.ts` - Installation/auth detection with JSON output
- `scripts/query.ts` - Single query execution with stdin piping support
- `scripts/session.ts` - Warm session management (create, continue, resume, list, delete)
- `scripts/memory.ts` - mem0.ai vector store integration for research memory

**SKILL.md Architecture:**
- Three usage modes: One-Shot Research, Multi-Turn Deep Dive, Research with Memory Retrieval
- Architecture diagram showing Claude → Scripts → Gemini/Sessions/mem0 flow
- All scripts output JSON for deterministic parsing
- No code regeneration - scripts are stable and tested

**Git History:**
- `de06fcc` - refactor(gemini-offloader): rewrite scripts in TypeScript for Bun
- `4ce8008` - chore: update gitignore for python cache, local files, skill packages
- `67a6b78` - feat(gemini-offloader): add context offloading skill with warm sessions and mem0

#### Research Conducted
- Studied Anthropic's long-running agent patterns via context-gathering agent
- Analyzed Plane skills for bundled script architecture
- Researched context preservation strategies in cc-sessions framework
- Identified deterministic execution as key pattern for reliable skill operations

---

### Discovered During Implementation
**Date: 2025-12-13 / Session: Context Refinement**

During implementation, we discovered critical architectural patterns and technology choices that fundamentally changed the skill's design from the original conception. These discoveries should inform future skill development.

#### Architectural Pivot: From Workflow to Bundled Scripts

The original context manifest described a simple "workflow-based" skill where Claude would execute bash commands inline (`gemini -p "prompt"`). However, research into Anthropic's long-running agent patterns and the Plane skills architecture revealed that **bundled scripts** are the preferred pattern for reliable, deterministic skill operations.

**Why this matters:** Skills that generate code on each invocation are:
- Token-inefficient (regenerate same code repeatedly)
- Error-prone (different formatting/bugs each time)
- Difficult to test and maintain
- Not aligned with Anthropic's recommended patterns

**The Plane pattern:** Plane skills demonstrated bundled Python scripts that:
- Output JSON for programmatic parsing
- Handle one specific operation deterministically
- Live with the skill in `skills/*/scripts/`
- Are tested once, executed reliably forever

This discovery led to completely rewriting the skill architecture.

#### Bun as Native Runtime for Claude Code

Mid-implementation, we discovered that **Anthropic acquired Bun** (the JavaScript/TypeScript runtime). This has major implications:

**What this means:**
- Bun is likely to become the native runtime for Claude Code skills
- TypeScript/Bun scripts start ~10x faster than Python (10ms vs 100ms cold start)
- Bun has built-in TypeScript support (no compilation step)
- The `$` template literal for shell commands makes scripting elegant

**Decision impact:** We rewrote all Python scripts to TypeScript/Bun. This is the first skill in this codebase to use Bun, establishing a pattern for future skills.

**Example of Bun's elegance:**
```typescript
import { $ } from "bun";
const geminiPath = await $`which gemini`.text();
```

Future skills should strongly consider TypeScript/Bun over Python for bundled scripts.

#### gemini-cli Session Management Capabilities

The original context mentioned gemini-cli's "conversation checkpointing" feature generically. During implementation, we discovered the actual CLI interface:

**Session Management Flags:**
- `--resume latest` or `--resume N` - Resume a specific session by index
- `--list-sessions` - List all available sessions for current project
- `--delete-session N` - Delete a session by index
- Sessions are per-project (based on current directory)
- Session 0 is always the most recent

**Implementation pattern discovered:**
```typescript
// List sessions
await $`${geminiPath} --list-sessions`

// Resume session
await $`${geminiPath} --resume latest -o json "Continue research"`

// Create new session (just run without --resume)
await $`${geminiPath} -o json "Start new research"`
```

**State management layer:** We added a JSON state file (`.gemini-offloader-sessions.json`) to track:
- Named session mappings (user-friendly names → session indices)
- Last used session info
- Per-project or user-level state

This pattern allows "warm sessions" where context is preserved across multiple research queries, critical for multi-turn deep dives.

#### mem0.ai Integration Discovery

The original context didn't mention mem0.ai. During research, we discovered:

**mem0.ai capabilities:**
- Node.js SDK available: `npm install mem0ai` (Bun-compatible)
- Provides semantic search across all research sessions
- Uses OpenAI embeddings (requires `OPENAI_API_KEY`)
- Stores memories in vector database for retrieval

**Use case:** After a Gemini research session, store key findings in mem0. Future sessions can search past research before asking new questions, building institutional knowledge over time.

**Implementation pattern:**
```typescript
// Store finding
await memory.add({
  user_id: "research",
  messages: [{ role: "user", content: "Key finding: ..." }]
});

// Search past research
const memories = await memory.search({
  user_id: "research",
  query: "WASM performance"
});
```

This is **optional** - the skill works without mem0, but it enables powerful long-term research memory.

#### Updated Technical Details

**Runtime Architecture:**
- **Language:** TypeScript (not Python)
- **Runtime:** Bun (not Node.js or Python)
- **Script location:** `plugins/gemini-offloader/skills/gemini-offloader/scripts/*.ts`
- **Output format:** All scripts output JSON to stdout

**Session State Management:**
- **State file:** `.gemini-offloader-sessions.json` (project-level) or `~/.config/gemini-offloader/sessions.json` (user-level)
- **State schema:**
  ```json
  {
    "named_sessions": { "session-name": session_index },
    "last_used": {
      "session": { "type": "named|indexed|latest", "name": "...", "index": N },
      "timestamp": "ISO-8601",
      "prompt_preview": "first 100 chars"
    }
  }
  ```

**Dependencies:**
- **Required:** `@google/gemini-cli` (npm global install)
- **Optional:** `mem0ai` (Bun local install, requires `OPENAI_API_KEY`)

**Error Handling Patterns:**
All scripts follow consistent error format:
```json
{
  "success": false,
  "error": "Human-readable error message",
  "response": null
}
```

Exit codes: 0 for success, 1 for failure.

#### Lessons for Future Skill Development

1. **Research first, implement second** - Using the context-gathering agent to study existing patterns (Plane skills, Anthropic's recommendations) prevented costly rewrites

2. **Bun > Python for scripts** - Faster, more elegant, likely native to Claude Code going forward

3. **Bundled scripts > Generated code** - Deterministic, testable, token-efficient

4. **Session/state management matters** - For long-running research tasks, preserve context between invocations

5. **JSON output always** - Makes parsing reliable, enables script composition

6. **Optional enhancements** - mem0.ai integration is optional but powerful - design for graceful degradation
