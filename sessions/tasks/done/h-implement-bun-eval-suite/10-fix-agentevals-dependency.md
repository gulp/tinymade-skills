---
name: 10-fix-agentevals-dependency
parent: h-implement-bun-eval-suite
status: done
---

# Fix AgentEvals Dependency Issue

## Problem/Goal

The `agentevals` package has a broken transitive dependency on `@langchain/openai`. When importing from `evaluators.ts`, we get:

```
SyntaxError: Export named '_convertMessagesToOpenAIParams' not found in module '@langchain/openai'
```

This blocks trajectory matching functionality in skill invocation tests.

## Success Criteria

- [x] Add `overrides` section to `plugins/agent-evals/tests/package.json` with pinned langchain versions
- [x] Clean install resolves the dependency issue
- [x] Uncomment evaluators imports in `gemini-offloader.test.ts`
- [x] Tests pass with trajectory matching enabled
- [x] Document the override with comment explaining why it exists

## Implementation

### 1. Add Overrides to package.json

```json
{
  "overrides": {
    "@langchain/core": "0.1.54",
    "@langchain/openai": "0.0.28"
  }
}
```

### 2. Clean Install

```bash
cd plugins/agent-evals/tests
rm -rf node_modules bun.lock
bun install
```

### 3. Uncomment Imports

In `skills/gemini-offloader.test.ts`, uncomment:
- `describeEval`, `describeEvalIndividual`, etc. from `bun-evals.ts`
- `createTrajectoryMatchScorer`, `claudeToolScorer` from `evaluators.ts`

### 4. Verify Tests Pass

```bash
SKIP_AGENT_TESTS=true bun test skills/gemini-offloader.test.ts
```

## Notes

- Gemini research confirmed this is a known issue with specific langchain versions
- The override is a temporary fix until agentevals updates its dependencies
- Periodically check if override can be removed
