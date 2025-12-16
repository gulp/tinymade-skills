# Testing Claude Code CLI agents locally with Bun

Claude Code's hook system combined with custom bun:test evaluators offers the most practical path for testing subagent behavior locally. The five frameworks on your shortlist face significant Bun compatibility issues—**vitest-evals** and **@langwatch/scenario** require Vitest internals that don't work with bun:test, while **Zevals doesn't exist** (likely confused with Evalite). This report provides a concrete implementation strategy using Claude Code's native capabilities and Bun-compatible patterns.

## Claude Code's hook system enables complete tool call interception

The most critical discovery is Claude Code's **8-event hook system**, which solves all three testing needs directly at the CLI level. The `PreToolUse` and `PostToolUse` hooks intercept every tool call with full parameter access, enabling deterministic assertions without external frameworks.

```json
// .claude/settings.json - Hook configuration
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "./hooks/capture-tool.ts" }]
    }],
    "PostToolUse": [{
      "matcher": "*", 
      "hooks": [{ "type": "command", "command": "./hooks/log-result.ts" }]
    }]
  }
}
```

Hook scripts receive JSON via stdin containing `tool_name`, `tool_input`, `session_id`, and `tool_use_id`. Exit code 0 allows execution; exit code 2 blocks it. Hooks can output JSON to modify tool inputs or mock responses entirely:

```typescript
// hooks/capture-tool.ts
const input = await Bun.stdin.json();
await Bun.write("./test-output/tool-calls.jsonl", 
  JSON.stringify({ tool: input.tool_name, args: input.tool_input }) + "\n",
  { append: true }
);
process.exit(0); // Allow tool execution
```

## Bun compatibility eliminates Vitest-based frameworks

The four Vitest-dependent frameworks face a fundamental problem: **Vitest on Bun actually runs on Node.js**, negating Bun's benefits. GitHub issue #4145 (195+ upvotes) tracks incomplete support. The `describeEval()` API in vitest-evals wraps Vitest's `describe()` which bun:test doesn't provide.

| Framework | bun:test | Vitest on Bun | Key Limitation |
|-----------|----------|---------------|----------------|
| **vitest-evals** | ❌ | ⚠️ Node.js | Wraps Vitest describe() |
| **@langwatch/scenario** | ❌ | ⚠️ Node.js | Custom Vitest config/reporters |
| **EvalFlow** | ✅ | ✅ | Limited tool call validation |
| **OpenEvals** | ✅ | ✅ | LangSmith-oriented |
| **AgentEvals** | ✅ | ✅ | Best trajectory matching |

**OpenEvals and AgentEvals** (LangChain) work as plain TypeScript libraries and offer the strongest tool call validation. AgentEvals' `createTrajectoryMatchEvaluator` with `strict`, `unordered`, `subset`, and `superset` match modes handles multi-step workflows:

```typescript
import { createTrajectoryMatchEvaluator } from "agentevals";

const evaluator = createTrajectoryMatchEvaluator({
  trajectoryMatchMode: "unordered",
  toolArgsMatchMode: "exact",
  toolArgsMatchOverrides: {
    search_files: (x, y) => x.pattern.toLowerCase() === y.pattern.toLowerCase()
  }
});
```

## A custom bun:test eval wrapper provides the cleanest solution

Since vitest-evals won't port cleanly, building a lightweight eval wrapper yields better results. This pattern mirrors vitest-evals' API but uses bun:test primitives:

```typescript
// lib/bun-evals.ts
import { test, expect } from "bun:test";

interface EvalCase { input: string; expected?: string; expectedTools?: ToolCall[] }
interface ToolCall { name: string; arguments?: Record<string, unknown> }
interface Scorer { (ctx: { input: string; output: any; expected?: string }): Promise<{ score: number }> }

export function describeEval(name: string, config: {
  data: () => Promise<EvalCase[]>;
  task: (input: string) => Promise<{ result: string; toolCalls: ToolCall[] }>;
  scorers: Scorer[];
  threshold?: number;
}) {
  test(name, async () => {
    const cases = await config.data();
    const threshold = config.threshold ?? 0.8;
    
    for (const { input, expected, expectedTools } of cases) {
      const output = await config.task(input);
      
      // Tool call validation (deterministic, no LLM judge)
      if (expectedTools) {
        const actualTools = output.toolCalls.map(t => t.name);
        const expectedNames = expectedTools.map(t => t.name);
        expect(actualTools).toEqual(expectedNames);
        
        for (const exp of expectedTools) {
          const actual = output.toolCalls.find(t => t.name === exp.name);
          if (exp.arguments) {
            expect(actual?.arguments).toMatchObject(exp.arguments);
          }
        }
      }
      
      // Custom scorers
      for (const scorer of config.scorers) {
        const { score } = await scorer({ input, output: output.result, expected });
        expect(score).toBeGreaterThanOrEqual(threshold);
      }
    }
  });
}
```

## Running Claude Code programmatically from tests

The **Claude Agent SDK** (TypeScript/Python) and CLI's `--output-format json` enable test harness integration. For bun:test, spawn Claude Code as a subprocess:

```typescript
// tests/agent.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";

beforeEach(() => Bun.write("./test-output/tool-calls.jsonl", ""));

test("agent calls correct tools for file search", async () => {
  const result = await $`claude -p "Find all TypeScript files with TODO comments" \
    --output-format json \
    --allowedTools Read Grep Glob \
    --max-turns 5 \
    --dangerously-skip-permissions`.json();
  
  // Parse captured tool calls from hooks
  const toolLog = await Bun.file("./test-output/tool-calls.jsonl").text();
  const toolCalls = toolLog.trim().split("\n").map(JSON.parse);
  
  // Assert tool discovery - agent should find Grep
  expect(toolCalls.some(t => t.tool === "Grep")).toBe(true);
  
  // Assert tool parameters
  const grepCall = toolCalls.find(t => t.tool === "Grep");
  expect(grepCall.args.pattern).toMatch(/TODO/i);
});
```

For isolation across parallel tests in git worktrees, each worktree gets its own `.claude/settings.json` with distinct hook output paths:

```typescript
// conftest.ts - Parallel test setup
export async function setupWorktreeHooks(worktreePath: string, testId: string) {
  const hookConfig = {
    hooks: {
      PreToolUse: [{
        matcher: "*",
        hooks: [{ type: "command", command: `./hooks/capture.ts ${testId}` }]
      }]
    }
  };
  await Bun.write(`${worktreePath}/.claude/settings.json`, JSON.stringify(hookConfig));
}
```

## Local-first evaluation without external API calls

Three patterns avoid LLM-as-judge API costs entirely:

**Pattern 1: VCR/Cassette recording** records Claude API responses for deterministic replay. The `vcr-langchain` library or custom HTTP interception captures responses once, then replays from local files:

```typescript
// Mock fetch for Claude API calls
import { mock } from "bun:test";

const cassette = await Bun.file("./cassettes/file-search.json").json();
let callIndex = 0;

mock.module("node:https", () => ({
  request: (url, opts, cb) => {
    const response = cassette[callIndex++];
    cb({ on: (e, h) => e === "data" && h(JSON.stringify(response)) });
  }
}));
```

**Pattern 2: JSON Schema validation** asserts tool call structure without semantic analysis:

```typescript
import { z } from "zod";

const GrepToolSchema = z.object({
  name: z.literal("Grep"),
  arguments: z.object({
    pattern: z.string().min(1),
    path: z.string().optional(),
    include: z.string().optional()
  })
});

test("tool calls match schema", () => {
  const toolCalls = parseToolLog();
  for (const call of toolCalls) {
    expect(() => GrepToolSchema.parse(call)).not.toThrow();
  }
});
```

**Pattern 3: Mock MCP servers** provide deterministic tool responses. Create a test MCP server that returns fixtures:

```typescript
// mock-mcp-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const server = new Server({ name: "test-mock", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler("tools/call", async (request) => {
  if (request.params.name === "read_file") {
    return { content: [{ type: "text", text: "// Mock file content" }] };
  }
});
```

Configure with `claude --mcp-config ./test-mcp.json --strict-mcp-config` to use only mock servers.

## Tracing and observation for multi-step workflows

For debugging complex agent behavior, **Langfuse** offers self-hosted observability with a Docker Compose deployment:

```bash
git clone https://github.com/langfuse/langfuse && cd langfuse && docker compose up
```

Integrate via PostToolUse hooks that POST to localhost:3000. For lighter-weight tracing, OpenTelemetry with a local Jaeger instance works:

```typescript
// hooks/trace-tool.ts
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("claude-agent-tests");
const input = await Bun.stdin.json();

const span = tracer.startSpan(`tool:${input.tool_name}`);
span.setAttribute("tool.input", JSON.stringify(input.tool_input));
span.end();
```

Session replay uses Claude Code's native `.jsonl` session files stored in `~/.claude/projects/<project>/<session-id>.jsonl`. Parse these for post-hoc analysis:

```typescript
async function analyzeSession(sessionId: string) {
  const sessionPath = `${Bun.env.HOME}/.claude/projects/current/${sessionId}.jsonl`;
  const lines = (await Bun.file(sessionPath).text()).trim().split("\n");
  return lines.map(JSON.parse).filter(turn => turn.tool_calls);
}
```

## Recommended implementation stack

For a solo developer testing Claude Code subagents across git worktrees:

| Need | Solution |
|------|----------|
| **Test runner** | bun:test with custom `describeEval` wrapper |
| **Tool call capture** | Claude Code PreToolUse/PostToolUse hooks |
| **Assertions** | Zod schemas + exact match (deterministic) |
| **Agent invocation** | `Bun.spawn(["claude", "-p", ...])` with JSON output |
| **Mocking** | Mock MCP servers + VCR cassettes |
| **Tracing** | Self-hosted Langfuse or JSONL session parsing |
| **Parallel isolation** | Per-worktree hook configs with unique output paths |

## Conclusion

The intersection of Claude Code's hook system with bun:test's speed creates a testing approach that outperforms the Vitest-based frameworks for this specific use case. **vitest-evals' ToolCallScorer** is excellent—but unavailable on Bun. The custom wrapper above replicates its core functionality while **Claude Code's native hooks provide deeper integration** than any external framework could achieve. Focus implementation effort on the hook-based tool call capture pattern and JSON schema assertions rather than fighting framework compatibility issues.

---

## Implementation Complete (2025-12-16)

The framework described in this research doc has been fully implemented at:

**Location**: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/`

**Key components**:
- Hook scripts: `scripts/capture-tool.ts`, `scripts/log-result.ts`, `scripts/common.ts`
- Test infrastructure: `tests/lib/harness.ts`, `tests/lib/bun-evals.ts`, `tests/lib/evaluators.ts`, `tests/lib/vcr.ts`, `tests/lib/worktree.ts`
- Example tests: Gemini-offloader unit tests (30 tests) and skill invocation tests (6 tests)

**Architecture decisions validated**:
1. Hook types defined locally (SDK doesn't exist on npm) ✓
2. `appendFile` used instead of `Bun.write()` for JSONL append ✓
3. AgentEvals integration with message format adapter ✓
4. Tool-level VCR (not API-level HTTP mocking) ✓
5. Fuzzy argument matching for production tests ✓

**Documentation**:
- Plugin README: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/README.md`
- Plugin CLAUDE.md: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/CLAUDE.md`
- PRD (updated): `/home/gulp/projects/tinymade-skills/docs/prd-claude-code-agent-testing.md`
- Task file: `/home/gulp/projects/tinymade-skills/sessions/tasks/done/h-implement-bun-eval-suite/README.md`