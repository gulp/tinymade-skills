# Migration Guide: Judgeval → Self-Hosted Langfuse

## Context

This document outlines migration from Judgeval (judgementlabs) to self-hosted Langfuse for Claude Code agent testing observability. AgentEvals remains unchanged as the trajectory evaluation engine.

---

## Why Migrate

### Judgeval Limitations Discovered

The Judgeval platform has a split architecture that wasn't immediately apparent:

- **judgeval npm package**: MIT licensed, open source, usable anywhere
- **Judgment Platform UI**: Closed source, SaaS-only, no self-hosting option
- **"Self-hosting" documentation**: Refers only to backend data plane, not the dashboard
- **Free tier caps**: 50,000 trace spans + 1,000 evaluations per month

For extensive local testing of Claude Code subagents across parallel worktrees, these limits would be reached quickly. The inability to self-host the UI means ongoing dependency on their cloud service even for local development.

### Langfuse Advantages

- Fully MIT licensed including UI
- Single `docker compose up` deployment
- No usage limits when self-hosted
- Native TypeScript SDK (v4, OTEL-based)
- LLM-as-judge evaluators built into UI
- REST API fallback for Bun compatibility edge cases

---

## Architecture Comparison

### Before: Judgeval Stack

```
Claude Code Hooks → AgentEvals → Judgeval SDK → Judgment Cloud UI
                    (local)      (local)        (remote, metered)
```

### After: Langfuse Stack

```
Claude Code Hooks → AgentEvals → Langfuse SDK/API → Langfuse UI
                    (local)      (local)            (local Docker)
```

The key change is the observability sink moves from remote SaaS to local infrastructure. AgentEvals remains the evaluation engine — Langfuse replaces only the storage and visualization layer.

---

## What Stays the Same

### AgentEvals Role (Unchanged)

AgentEvals continues to handle all trajectory evaluation logic:

- Tool call sequence matching (strict, unordered, subset, superset modes)
- Tool argument comparison with per-tool override functions
- Deterministic scoring with no LLM API calls
- Pure function: trajectories in, score out

The only integration point that changes is where evaluation results are reported.

### Claude Code Hooks (Unchanged)

The PreToolUse and PostToolUse hook configuration remains identical. Hooks capture tool calls to JSONL files, which are then processed by your test harness and fed to AgentEvals.

### Test Harness Structure (Unchanged)

Your bun:test wrapper, eval case definitions, and trajectory fixtures require no modification. Only the `reportToUI()` function implementation changes.

---

## Langfuse Self-Hosted Setup

### Prerequisites

- Docker and Docker Compose installed
- Ports 3000 (UI) and 5432 (Postgres) available
- Approximately 2GB disk space for images

### Deployment Steps

1. Clone the Langfuse repository
2. Navigate to the project directory
3. Run `docker compose up -d`
4. Access UI at `http://localhost:3000`
5. Create initial admin account through web interface
6. Create a project and note the public/secret key pair

### Configuration Considerations

**Persistence**: Default compose file includes a Postgres volume. For ephemeral testing environments, this can be removed to start fresh each session.

**Resource allocation**: Default settings work for development. For CI environments, consider reducing memory limits if running alongside other services.

**Network mode**: If Claude Code runs in a container and needs to reach Langfuse, ensure they share a Docker network or use host networking.

---

## Migration Steps

### Step 1: Deploy Langfuse Locally

Follow the setup steps above. Verify you can access the UI and create a project.

### Step 2: Update Environment Variables

Replace Judgeval credentials with Langfuse credentials in your test environment:

| Old Variable | New Variable |
|--------------|--------------|
| `JUDGEVAL_API_KEY` | `LANGFUSE_SECRET_KEY` |
| `JUDGEVAL_PROJECT_ID` | `LANGFUSE_PUBLIC_KEY` |
| — | `LANGFUSE_BASE_URL` (set to `http://localhost:3000`) |

### Step 3: Replace Reporting Function

The conceptual change is minimal. Where you previously called Judgeval's trace/score APIs, call Langfuse's equivalent:

**Judgeval pattern** (conceptual):
```
judgeval.trace(name, input, output)
judgeval.score(traceId, "trajectory_match", score)
```

**Langfuse pattern** (conceptual):
```
langfuse.trace(name, input, output) → traceId
langfuse.score(traceId, "trajectory_match", score)
```

The data shape is nearly identical. Both accept trace metadata, both accept numeric scores with optional comments.

### Step 4: Verify Integration

Run a single test case and confirm:

- Trace appears in Langfuse UI under your project
- Input/output are correctly captured
- AgentEvals score is attached to the trace
- Score comment (match details) is visible

### Step 5: Remove Judgeval Dependencies

Once verified, remove the judgeval package from your project and any Judgeval-specific configuration.

---

## SDK vs Direct API Decision

### Use Langfuse SDK When

- Running tests under Node.js
- OTEL NodeSDK initializes without errors under Bun
- You want automatic batching and retry logic
- You need the decorator/context manager patterns

### Use Direct HTTP API When

- Bun compatibility issues arise with OTEL dependencies
- You prefer zero external dependencies
- You're integrating from shell scripts or non-JS environments
- You want explicit control over request timing

The direct API approach uses Langfuse's `/api/public/ingestion` endpoint with batch payloads. This is officially supported and documented.

---

## Data Model Mapping

### Concepts Translation

| Judgeval Term | Langfuse Term | Notes |
|---------------|---------------|-------|
| Trace | Trace | Direct equivalent |
| Span | Observation | Langfuse uses "observation" as umbrella term |
| Generation | Generation | LLM calls specifically |
| Score | Score | Direct equivalent |
| Dataset | Dataset | Direct equivalent |
| Experiment | Experiment/Run | Similar concept |

### Score Types

Langfuse accepts three score data types:

- **NUMERIC**: Floating point values (use for AgentEvals 0/1 scores)
- **BOOLEAN**: True/false
- **CATEGORICAL**: String labels

AgentEvals returns `{ score: 0 | 1 }`, so use NUMERIC type.

---

## LLM-as-Judge Migration

If you were using Judgeval's LLM-as-judge features for output quality assessment (separate from AgentEvals trajectory matching), Langfuse provides equivalent functionality:

### UI-Based Evaluators

Langfuse includes a managed evaluator system accessible through the web UI:

- Pre-built templates (Hallucination, Helpfulness, Toxicity, etc.)
- Custom evaluation prompts with variable mapping
- Automatic execution on new traces matching filter criteria
- Support for multiple judge models (OpenAI, Anthropic, etc.)

### Configuration Approach

1. Navigate to Evaluators section in project settings
2. Create new evaluator or select from template catalog
3. Configure variable mapping (which trace fields map to prompt variables)
4. Set trigger conditions (which traces should be evaluated)
5. Assign LLM connection for judge model

### Execution Visibility

Each LLM-as-judge evaluation creates its own trace in a special `langfuse-llm-as-a-judge` environment. This provides full visibility into judge prompts, responses, and token usage.

---

## Nested Trace Support

For complex agent runs with multiple tool calls, Langfuse supports hierarchical observations:

```
Trace: "agent-run-file-search"
├── Observation: "tool-glob"
│   └── input/output captured
├── Observation: "tool-grep" 
│   └── input/output captured
└── Score: trajectory_match = 1.0
```

This maps naturally to Claude Code's multi-turn tool sequences. Each PreToolUse/PostToolUse capture can become a child observation under the parent trace.

---

## CI/CD Considerations

### Ephemeral Langfuse for CI

For CI pipelines, consider:

1. **Spin up Langfuse as a service** in your CI configuration
2. **Run tests** that report to the ephemeral instance
3. **Export summary metrics** before teardown if needed
4. **Discard instance** — no persistent storage needed

This avoids accumulating test data and keeps CI isolated.

### Persistent Langfuse for Development

For local development, keep Langfuse running persistently to:

- Track evaluation trends over time
- Compare test runs across branches
- Debug failing tests by inspecting historical traces

---

## Verification Checklist

Before considering migration complete:

- [ ] Langfuse UI accessible at configured URL
- [ ] Project created with valid API keys
- [ ] Single test case produces visible trace
- [ ] AgentEvals score attached to trace correctly
- [ ] Score comment/details visible in UI
- [ ] Multiple test cases batch correctly
- [ ] Parallel test runs don't conflict (unique trace IDs)
- [ ] Judgeval dependencies removed from project
- [ ] Environment variables updated in all environments
- [ ] CI configuration updated if applicable

---

## Rollback Path

If issues arise, rollback is straightforward:

1. Re-add judgeval package
2. Restore original environment variables
3. Revert reporting function to Judgeval API calls
4. Judgeval cloud retains historical data (within retention period)

The evaluation logic in AgentEvals is unaffected either way.

---

## Summary

This migration replaces a metered SaaS observability layer with self-hosted infrastructure while preserving all evaluation logic. The primary benefits are:

- No usage limits for local testing
- Full data ownership
- No network dependency for test runs
- Equivalent feature set for the observability use case

AgentEvals continues to be the evaluation engine. Langfuse becomes the eyes into what those evaluations produce.
