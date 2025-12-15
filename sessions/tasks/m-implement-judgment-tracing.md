---
name: m-implement-judgment-tracing
branch: feature/implement-judgment-tracing
status: pending
created: 2025-12-15
---

# Implement Judgment Labs Tracing

## Problem/Goal

Set up Judgment Labs tracing for observability of AI agent execution. This provides automatic capture of execution traces, spans, LLM interactions (prompts, responses, token usage), tool usage, and performance metrics.

Reference: https://docs.judgmentlabs.ai/documentation/performance/tracing

## Success Criteria
- [ ] `judgeval` SDK installed and configured in the project
- [ ] Tracer initialized with project name
- [ ] At least one function/workflow traced using `@observe()` decorator
- [ ] Traces visible in Judgment Labs dashboard
- [ ] Documentation added for how to add tracing to new functions

## Context Manifest

### How Judgment Labs Tracing Works: OpenTelemetry-Based Observability for AI Agents

Judgment Labs provides an OpenTelemetry-based tracing SDK called `judgeval` that enables comprehensive observability for AI applications. The system is designed to capture execution traces, spans, LLM interactions (including prompts, responses, and token usage), tool usage, and performance metrics across distributed agent workflows.

**Core Architecture:**

The tracing system is built on OpenTelemetry, which means it's language-agnostic and can be used across polyglot codebases. For TypeScript/Node.js applications (like this codebase), the SDK provides:

1. **Tracer Initialization**: A project-level tracer that must be initialized once at application startup with organization credentials and project name
2. **Function Decorators**: The `@observe()` decorator (or `@judgment.observe()`) that automatically instruments functions to create trace spans
3. **Auto-Instrumentation**: Automatic capture of LLM client library calls (OpenAI, Anthropic, etc.) without manual instrumentation
4. **Span Context Propagation**: Automatic parent-child span relationships when decorated functions call each other
5. **Metadata Enrichment**: Ability to add custom attributes, tags, and context to spans for filtering and analysis

**How the @observe() Decorator Works:**

When you decorate a function with `@observe()`, the SDK:
- Creates a new trace span when the function is invoked
- Automatically captures function name, parameters (configurable), and execution time
- Propagates the span context to any child function calls (creating nested spans)
- Captures return values and exceptions
- Sends the completed span to Judgment Labs backend for visualization

**Example Usage Pattern:**
```typescript
import judgment from 'judgeval';

// Initialize once at startup
judgment.init({
  orgId: process.env.JUDGMENT_ORG_ID,
  apiKey: process.env.JUDGMENT_API_KEY,
  projectName: 'tinymade-skills'
});

// Decorate functions to trace
@judgment.observe()
async function executeQuery(prompt: string, model: string) {
  // Function logic here
  // Auto-captured: execution time, params, return value, exceptions
}
```

**Auto-Instrumentation for LLM Calls:**

The SDK automatically instruments common LLM client libraries. When your code makes calls to:
- OpenAI SDK (`openai` npm package)
- Anthropic SDK (`@anthropic-ai/sdk`)
- Google Generative AI (`@google/generative-ai`)
- And other popular LLM clients

The SDK captures:
- Model name and version
- Full prompt text (with optional PII masking)
- Complete response text
- Token usage (prompt tokens, completion tokens, total)
- Latency and error rates
- Cost estimates (based on public pricing)

This happens automatically once `judgment.init()` is called - no per-call instrumentation needed.

**Span Relationships and Nesting:**

When traced functions call other traced functions, the SDK automatically creates parent-child span relationships:

```
Root Span: executeGeminiSession()
├─ Child Span: buildPrompt()
├─ Child Span: callGeminiCLI()
│  └─ Auto-captured: Gemini API call (if SDK supported)
└─ Child Span: cacheResult()
   └─ Child Span: indexInMem0()
```

This creates a complete execution trace showing the full flow through your system.

### Current Codebase Architecture: Where Tracing Should Be Added

This codebase is a **Claude Code plugin marketplace** called `tinymade-skills`. It provides custom skills/commands that extend Claude Code's capabilities with specialized agent workflows. The architecture is:

**Runtime Environment:**
- **Bun** is the primary JavaScript runtime (not Node.js) - all TypeScript scripts use `#!/usr/bin/env bun`
- TypeScript with ES modules (`"type": "module"` in package.json)
- Zero external dependencies for most plugins (pure Bun/Node.js APIs)
- Some plugins use specific libraries (mem0ai, minimist)

**Project Structure:**
```
tinymade-skills/
├── plugins/                          # Individual skill plugins
│   ├── gemini-offloader/             # LLM agent offloading (PRIMARY TARGET)
│   │   └── skills/gemini-offloader/
│   │       ├── SKILL.md              # Skill definition and orchestration logic
│   │       └── scripts/              # Executable TypeScript scripts
│   │           ├── launcher.ts       # Skill initialization and state detection
│   │           ├── query.ts          # Single-shot Gemini queries with caching
│   │           ├── session.ts        # Multi-turn warm sessions
│   │           ├── memory.ts         # mem0 vector memory integration
│   │           ├── state.ts          # Persistence layer management
│   │           ├── status.ts         # System health checks
│   │           └── sync.ts           # Cache/index maintenance
│   ├── initializer/                  # Parallel agent coordination (SECONDARY TARGET)
│   │   ├── cli/                      # Status reporting CLI
│   │   │   └── src/
│   │   │       ├── index.ts          # CLI entry point
│   │   │       └── commands/
│   │   │           ├── status.ts     # Agent status reporting
│   │   │           ├── show.ts       # Status display
│   │   │           └── monitor.ts    # Real-time TUI dashboard
│   │   └── skills/
│   │       ├── agent-status/         # For agents in worktrees
│   │       └── agent-monitor/        # For orchestrators
│   ├── task-breakdown/               # Task decomposition workflows
│   ├── worktree-orchestrator/        # Git worktree management
│   └── plane/                        # Plane.so integration
└── sessions/                         # cc-sessions framework
    ├── api/                          # Command routing (Node.js)
    └── hooks/                        # Session lifecycle hooks (Node.js)
```

**Authentication Already Configured:**

The codebase already has Judgment Labs credentials configured! In `.envrc`:
```bash
export JUDGMENT_ORG_ID=$(pass judgement/org-id)
export JUDGMENT_API_KEY=$(pass judgement/api-key)
```

This means the environment variables are already available when using `direnv` (which is activated via `.envrc`).

### Primary Target: Gemini-Offloader Plugin

The **gemini-offloader** plugin is the most critical target for tracing because it implements complex AI agent workflows with:

**1. Multi-Turn Research Sessions (session.ts):**

When a user wants to conduct research across multiple interactions, they create a "warm session" that maintains context across turns. The flow is:

- User triggers skill via Claude Code (detected by SKILL.md frontmatter matching)
- `launcher.ts` runs first to understand system state: checks for gemini-cli installation, authentication status, existing active sessions, and generates contextual options
- User selects "create session" or "continue session" via AskUserQuestion
- For **create**: `session.ts create` command spawns `gemini` CLI with session flag, sends initial prompt, captures sessionId from gemini's output, stores session metadata to `~/.config/gemini-offloader/sessions.json` with SessionMapping format
- For **continue**: `session.ts continue` resolves session name to current sessionId (gemini sessions are index-based but indices shift, so we track by UUID), spawns gemini with `--session` flag, sends follow-up prompt, appends turn to session history
- Each turn's response is cached to `~/.gemini_offloader/projects/{project_hash}/cache/{source_hash}/full_response.md`
- A summary is generated (token-limited) and returned to Claude
- The full response + metadata is indexed in mem0 vector store for semantic search

**Why This Needs Tracing:**
- Sessions can have 10+ turns with 30-minute timeouts each (supporting Gemini's 1M token context window)
- Multiple async operations: CLI spawn, file I/O, mem0 indexing, cache lookups
- Complex state management: session index resolution, cache invalidation, orphan cleanup
- Error cases: stale sessions, authentication failures, CLI crashes

**What to Trace:**
```typescript
// session.ts
@judgment.observe()
async function createSession(args: { name: string; prompt: string; timeout: number })

@judgment.observe()
async function continueSession(args: { name: string; prompt: string; timeout: number })

@judgment.observe()
async function resolveSessionId(sessionName: string): Promise<number | null>

@judgment.observe()
async function listSessions(geminiPath: string): Promise<SessionInfo[]>
```

**2. Single-Shot Queries (query.ts):**

For one-off research questions, the flow is:

- User's query is hashed along with any included file contexts to generate a `sourceHash`
- Cache lookup checks `~/.gemini_offloader/projects/{project_hash}/cache/{source_hash}/` for existing result
- If cache hit: return summary immediately (full response available at path)
- If cache miss: build command arguments for gemini CLI (`-m model`, `--include-directories`, `-o json`), spawn gemini process with timeout (default 90s, up to 300s for complex queries), parse JSON response
- Extract full response text, generate summary (4x summary_max_tokens character limit)
- Write cache: create cache directory, write `full_response.md`, write `metadata.json` with OffloadMetadata schema
- Index in mem0: call `indexOffload()` from memory.ts to store in vector database
- Return summary to Claude

**Cache Structure:**
```
~/.gemini_offloader/
└── projects/
    └── {project_hash}/          # Based on git remote + cwd
        └── cache/
            └── {source_hash}/   # Hash of prompt + included files + model
                ├── full_response.md
                └── metadata.json  # CacheMetadata with OffloadMetadata
```

**Why This Needs Tracing:**
- Cache hit/miss ratio is critical for performance optimization
- Gemini CLI calls are the slowest operation (1-5 minutes for complex queries)
- File inclusion can process hundreds of files (token-heavy)
- Silent failures in mem0 indexing could degrade search quality over time

**What to Trace:**
```typescript
// query.ts
@judgment.observe()
async function runQuery(args: QueryArgs): Promise<QueryResult>

@judgment.observe()
async function generateSourceHash(options): Promise<{ hash: string; files: FileInfo[] }>

@judgment.observe()
async function lookupCache(projectHash: string, sourceHash: string)

@judgment.observe()
async function writeCache(data: CacheWriteData)
```

**3. Memory Management (memory.ts):**

The mem0 integration provides persistent vector memory across sessions:

- Dual-mode operation: hosted mem0 API (via MEM0_API_KEY) or local OSS mode (with local LLM + embeddings)
- Entity-scoped memory model with three levels:
  - Agent memories: `user_id="gemini-offloader"` (cross-project agent knowledge)
  - Project memories: `user_id={project_hash}` (project-specific patterns/conventions)
  - Session memories: `user_id={project_hash}` + `run_id={session_name}` (session-specific context)
- Local index fallback: if mem0 unavailable, maintains JSON index in `~/.gemini_offloader/index.json`
- Operations: add memory, search (semantic or filtered), get all memories for entity, delete memory

**Why This Needs Tracing:**
- Dual-mode complexity: failures could be in API auth, local LLM setup, or embeddings
- Vector search quality depends on proper scoping (wrong scope = no results)
- Index corruption could silently degrade search results
- Performance: local mode does on-device embeddings (slow)

**What to Trace:**
```typescript
// memory.ts
@judgment.observe()
export async function getMemory(): Promise<{ memory: any; error: string | null }>

@judgment.observe()
export async function indexOffload(summary: string, metadata: OffloadMetadata)

@judgment.observe()
export async function searchScoped(options: ScopedSearchOptions)

@judgment.observe()
async function searchLocalIndex(query: string, limit: number)
```

**4. State Management (state.ts):**

Core persistence layer that all other scripts depend on:

- Project initialization: auto-creates project directory structure on first use
- Project hash generation: combines git remote URL + cwd to create stable project identifier
- Cache operations: lookup, write, validation
- Session file parsing: reads gemini CLI session files to extract sessionId and turn history
- Config management: global config at `~/.gemini_offloader/config.json` with defaults

**Why This Needs Tracing:**
- Foundation for all other operations - failures here cascade everywhere
- File I/O heavy: potential for race conditions in concurrent access
- Hash collisions or corruption could cause cache mismatches
- Auto-initialization could fail silently

**What to Trace:**
```typescript
// state.ts
@judgment.observe()
export async function getOrCreateProject()

@judgment.observe()
export async function generateSourceHash(options)

@judgment.observe()
export async function lookupCache(projectHash: string, sourceHash: string)

@judgment.observe()
export async function writeCache(data: CacheWriteData)
```

**5. Launcher Orchestration (launcher.ts):**

The skill's entry point that determines user intent:

- System checks: finds gemini CLI in PATH, checks OAuth tokens or API key, verifies state directory initialization
- Project context: detects if in valid git repo, gets or creates project structure, loads active sessions
- Global stats: counts total projects, cache entries, sessions across all projects
- Builds available operations list with availability flags (e.g., "research" requires authentication)
- Suggests recommended action based on context (e.g., "continue your active session" if sessions exist)
- Outputs JSON for Claude Code to parse and present via AskUserQuestion

**Why This Needs Tracing:**
- First point of failure diagnosis - orchestrates all subsequent operations
- Complex decision tree based on system state
- Filesystem traversal (potentially slow with many projects/cache entries)
- Silent errors here lead to confusing UX (unavailable operations without clear reasons)

**What to Trace:**
```typescript
// launcher.ts
@judgment.observe()
async function main(): Promise<LauncherResult>

@judgment.observe()
async function getProjectContext()

@judgment.observe()
async function getGlobalStats()

@judgment.observe()
async function checkAuthentication()
```

### Secondary Target: Initializer Plugin

The **initializer** plugin coordinates parallel autonomous agents working in separate git worktrees:

**Architecture Flow:**

When using the worktree-orchestrator skill, Claude spawns multiple Claude instances in separate git worktrees to work on parallel tasks. Each agent needs to report its status back to the orchestrator. The flow is:

1. **Agent Status Reporting**: Agents in worktrees use `initializer status "description" --tests passed --todos 3/7 --blocked` to write their current state
2. **Atomic Status Writing**: Status goes to `.trees/.state/{task-name}.status.json` using atomic write pattern (temp file + rename) to prevent corruption with concurrent agents
3. **Orchestrator Reading**: Main branch orchestrator uses `initializer show` (CLI) or `initializer monitor` (TUI dashboard) to read all agent statuses
4. **Real-Time Monitoring**: The monitor command displays a live TUI with status badges (ACTIVE/BLOCKED/STALE), test results, todo progress bars, git diff stats, auto-refreshing every 2 seconds

**Why This Needs Tracing:**

While less critical than gemini-offloader (no external API calls), tracing here provides:
- Visibility into multi-agent coordination patterns
- Performance metrics for file I/O in high-concurrency scenarios
- Detection of race conditions or file corruption
- Understanding of stale agent detection accuracy

**What to Trace:**
```typescript
// initializer/cli/src/commands/status.ts
@judgment.observe()
export async function statusCommand(args: StatusArgs)

// initializer/cli/src/lib/state.ts
@judgment.observe()
export function writeStatus(stateDir: string, status: AgentStatus)

@judgment.observe()
export function readAllStatuses(stateDir: string): AgentStatus[]
```

### Implementation Approach

**Step 1: Install judgeval SDK**

Since this codebase uses Bun (not npm), installation must use bun:

```bash
cd /home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts
bun add judgeval
```

And for initializer:
```bash
cd /home/gulp/projects/tinymade-skills/plugins/initializer/cli
bun add judgeval
```

**Step 2: Initialize Tracer (One Per Script)**

Each executable script needs its own tracer initialization. Since these are CLI scripts (not long-running services), initialize immediately after imports:

**For gemini-offloader scripts:**
```typescript
#!/usr/bin/env bun
/**
 * [existing script comment]
 */

import judgment from 'judgeval';

// Initialize tracer immediately
judgment.init({
  orgId: process.env.JUDGMENT_ORG_ID || '',
  apiKey: process.env.JUDGMENT_API_KEY || '',
  projectName: 'tinymade-skills-gemini-offloader'
});

// Rest of imports and code...
```

**For initializer CLI:**
```typescript
#!/usr/bin/env bun
import judgment from 'judgeval';

judgment.init({
  orgId: process.env.JUDGMENT_ORG_ID || '',
  apiKey: process.env.JUDGMENT_API_KEY || '',
  projectName: 'tinymade-skills-initializer'
});
```

**CRITICAL**: Each script is a separate process (invoked by Bun directly), so each needs its own `judgment.init()` call. They don't share a runtime.

**Step 3: Add @observe() Decorators**

Bun supports TypeScript decorators natively (no babel/tsc required), but the tsconfig.json must enable them:

Update `plugins/initializer/cli/tsconfig.json`:
```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    // ... existing options
  }
}
```

Create tsconfig.json for gemini-offloader scripts if it doesn't exist:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "experimentalDecorators": true,
    "types": ["bun"]
  }
}
```

Then decorate the key functions listed in the "What to Trace" sections above.

**Decorator Usage Pattern:**
```typescript
import judgment from 'judgeval';

class QueryExecutor {
  @judgment.observe()
  async runQuery(args: QueryArgs): Promise<QueryResult> {
    // existing implementation
  }
}

// For standalone functions (not in a class):
@judgment.observe()
async function runQuery(args: QueryArgs): Promise<QueryResult> {
  // existing implementation
}
```

**Step 4: Test and Validate**

1. Verify environment variables are loaded: `echo $JUDGMENT_ORG_ID`
2. Run a traced script: `bun run scripts/query.ts --prompt "test query"`
3. Check Judgment Labs dashboard for trace appearance
4. Verify span nesting for nested function calls
5. Check for any errors in script output

**Step 5: Document Usage**

Add to each plugin's SKILL.md or README.md:

```markdown
## Observability

This skill is instrumented with Judgment Labs tracing. Execution traces are automatically captured and sent to the Judgment Labs dashboard.

**Required Environment Variables:**
- `JUDGMENT_ORG_ID`: Your Judgment Labs organization ID
- `JUDGMENT_API_KEY`: Your Judgment Labs API key

**Viewing Traces:**
Visit https://app.judgmentlabs.ai and select the `tinymade-skills-[plugin-name]` project.

**Adding Tracing to New Functions:**
Decorate functions with `@judgment.observe()`:

\`\`\`typescript
import judgment from 'judgeval';

@judgment.observe()
async function newFeature(args: Args): Promise<Result> {
  // implementation
}
\`\`\`
```

### Technical Reference Details

#### Judgment Labs SDK API

**Initialization:**
```typescript
judgment.init({
  orgId: string,      // From JUDGMENT_ORG_ID env var
  apiKey: string,     // From JUDGMENT_API_KEY env var
  projectName: string // Human-readable project identifier
});
```

**Decorator:**
```typescript
@judgment.observe(options?: {
  name?: string,           // Override span name (defaults to function name)
  captureArgs?: boolean,   // Include function arguments (default: true)
  captureReturn?: boolean, // Include return value (default: true)
  metadata?: Record<string, any> // Additional span attributes
})
```

**Manual Span Creation (if needed):**
```typescript
const span = judgment.startSpan('operation-name');
try {
  // operation
  span.setAttributes({ key: 'value' });
} catch (error) {
  span.recordException(error);
  throw error;
} finally {
  span.end();
}
```

#### Key Data Structures

**OffloadMetadata (from state.ts):**
```typescript
interface OffloadMetadata {
  project_hash: string;
  project_path: string;
  source_path: string;
  source_hash: string;
  source_type: "folder" | "file" | "stdin";
  session_name: string | null;
  turn_number: number | null;
  timestamp: string;
  type: "offload" | "research" | "synthesis";
  topics: string[];
  model: string;
  prompt_hash: string;
  response_file: string;
  token_count: number;
}
```

**SessionMapping (from session.ts):**
```typescript
interface SessionMapping {
  sessionId: string;        // UUID from gemini CLI
  lastTurn: number;         // Turn counter
  createdAt: string;        // ISO timestamp
  lastAccessedAt: string;   // ISO timestamp
}
```

**AgentStatus (from initializer):**
```typescript
interface AgentStatus {
  task_name: string;
  worktree_path: string | null;
  branch: string | null;
  current_work: string;
  test_status: "passed" | "failed" | "unknown";
  is_blocked: boolean;
  blocked_reason: string | null;
  todos_completed: number | null;
  todos_total: number | null;
  diff_stats: {
    additions: number;
    deletions: number;
  } | null;
  last_update: string;  // ISO 8601
}
```

#### File Locations

**Gemini-Offloader Implementation:**
- Tracer initialization: Each script file's top (after imports)
- Functions to trace:
  - `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/launcher.ts`
  - `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/query.ts`
  - `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/session.ts`
  - `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/memory.ts`
  - `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/state.ts`

**Initializer Implementation:**
- Tracer initialization: `/home/gulp/projects/tinymade-skills/plugins/initializer/cli/src/index.ts`
- Functions to trace:
  - `/home/gulp/projects/tinymade-skills/plugins/initializer/cli/src/commands/status.ts`
  - `/home/gulp/projects/tinymade-skills/plugins/initializer/cli/src/lib/state.ts`

**TypeScript Config:**
- Gemini-offloader: Create `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/tsconfig.json`
- Initializer: Update `/home/gulp/projects/tinymade-skills/plugins/initializer/cli/tsconfig.json`

**Documentation:**
- Gemini-offloader: Add section to `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/SKILL.md`
- Initializer: Add section to `/home/gulp/projects/tinymade-skills/plugins/initializer/cli/README.md`

#### Configuration Requirements

**Environment Variables (Already Configured):**
- `JUDGMENT_ORG_ID`: Organization ID from Judgment Labs
- `JUDGMENT_API_KEY`: API key for authentication

These are already set up in `/home/gulp/projects/tinymade-skills/.envrc` via `pass` (password manager).

**Runtime Requirements:**
- Bun runtime (already in use)
- Internet connectivity to send traces to Judgment Labs
- No additional dependencies beyond `judgeval` npm package

**Optional: Trace Sampling**

For high-throughput operations, add sampling config to `judgment.init()`:
```typescript
judgment.init({
  orgId: process.env.JUDGMENT_ORG_ID || '',
  apiKey: process.env.JUDGMENT_API_KEY || '',
  projectName: 'tinymade-skills-gemini-offloader',
  sampling: {
    rate: 0.1  // Trace 10% of executions (useful if query.ts runs 100s of times)
  }
});
```

**Trace Data Retention:**

Judgment Labs retains traces according to your plan. For local development, traces are ephemeral (sent to cloud, not stored locally).

### Potential Issues and Solutions

**Issue 1: Bun Compatibility**

Judgment Labs SDK is designed for Node.js. If Bun compatibility issues arise:

**Solution**: Use Bun's Node.js compatibility layer explicitly:
```typescript
// At top of script
import { setDefaultAutoSelectFamily } from 'node:dns';
setDefaultAutoSelectFamily(true);
```

Or run scripts with Node.js instead of Bun (though this loses Bun's performance benefits).

**Issue 2: Decorator Support in Bun**

Bun supports TypeScript decorators natively, but if issues occur:

**Solution**: Use manual span creation instead of decorators:
```typescript
import judgment from 'judgeval';

async function runQuery(args: QueryArgs): Promise<QueryResult> {
  const span = judgment.startSpan('runQuery', {
    attributes: { prompt: args.prompt, model: args.model }
  });
  
  try {
    const result = await actualQueryLogic(args);
    return result;
  } catch (error) {
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
```

**Issue 3: Missing Environment Variables**

If `JUDGMENT_ORG_ID` or `JUDGMENT_API_KEY` are not set:

**Solution**: The scripts will still run but traces won't be sent. Add validation:
```typescript
if (!process.env.JUDGMENT_ORG_ID || !process.env.JUDGMENT_API_KEY) {
  console.warn('Warning: Judgment Labs credentials not found. Tracing disabled.');
  console.warn('Set JUDGMENT_ORG_ID and JUDGMENT_API_KEY to enable tracing.');
} else {
  judgment.init({
    orgId: process.env.JUDGMENT_ORG_ID,
    apiKey: process.env.JUDGMENT_API_KEY,
    projectName: 'tinymade-skills-gemini-offloader'
  });
}
```

**Issue 4: Performance Overhead**

Tracing adds minimal overhead (~1-5ms per span), but for tight loops this can accumulate.

**Solution**: Use selective tracing:
- Trace top-level functions (runQuery, createSession) always
- Trace helper functions (generateHash, lookupCache) only during debugging
- Use sampling for high-frequency operations

**Issue 5: Sensitive Data in Traces**

Prompts and responses may contain sensitive information.

**Solution**: Configure PII masking in decorator:
```typescript
@judgment.observe({
  captureArgs: false,  // Don't capture function arguments
  metadata: {
    prompt_length: prompt.length,  // Capture metadata instead
    model: args.model
  }
})
async function runQuery(args: QueryArgs) {
  // implementation
}
```

Or use Judgment Labs' built-in PII redaction features (check their docs for configuration).

## User Notes
- Uses `judgeval` SDK (TypeScript/Node.js)
- OpenTelemetry-based for cross-language compatibility
- Auto-instrumentation for LLM client calls
- `@judgment.observe()` decorator for function tracing

## Work Log
<!-- Updated as work progresses -->
