---
name: h-implement-gemini-observer
branch: feature/gemini-observer
status: pending
created: 2025-12-15
---

# Observable Research Sessions for gemini-offloader

## Problem/Goal

gemini-offloader is currently fire-and-forget. No visibility into:
- What's happening during long-running research
- Chain-of-thought reasoning
- Multi-pass iteration state
- Whether Gemini is blocked, confused, or confident

We need an observability layer that:
1. Tracks research progress via structured traces
2. Enables polling/watching from orchestrator
3. Uses hardened system prompts with parseable markers (since Gemini can't call tools)
4. Maintains orthogonal separation: INITIALIZE / OFFLOAD / OBSERVE

## Success Criteria

- [ ] Observer module with trace management (init, append, checkpoint, recover)
- [ ] Hardened Gemini prompt template with parseable markers ([PHASE], [COT], [CONFIDENCE], etc.)
- [ ] Output parser that extracts markers and updates trace state
- [ ] Status query commands (list, status, watch with --until/--timeout for Claude polling)
- [ ] Aspect tracking to prevent premature completion (all aspects must be covered)
- [ ] Shared runtime in `~/.gemini_offloader/observer/` with file locking
- [ ] Integration point: `research.ts` that composes OFFLOAD + OBSERVE
- [ ] Clean orthogonal separation from existing offload/initialize concerns

## Architecture

### Three Orthogonal Concerns

```
INITIALIZE          OFFLOAD             OBSERVE
(setup, auth)       (Gemini calls)      (tracking)
     │                   │                   │
     └───────────────────┴───────────────────┘
                         │
                    research.ts
                  (integration point)
```

### Directory Structure

```
scripts/
├── initialize/          # INITIALIZE concern
│   ├── init.ts
│   ├── auth.ts
│   ├── config.ts
│   └── sync.ts
│
├── offload/             # OFFLOAD concern
│   ├── query.ts
│   ├── session.ts
│   └── cache.ts
│
├── observe/             # OBSERVE concern
│   ├── trace.ts         # Trace management
│   ├── parse.ts         # Output marker parsing
│   ├── status.ts        # Status queries
│   ├── watch.ts         # Polling/streaming
│   └── prompt.ts        # Hardened prompt templates
│
└── research.ts          # Integration: observable research
```

### Shared Runtime

```
~/.gemini_offloader/
├── config.json              # INITIALIZE owns
├── projects/{hash}/         # OFFLOAD owns
│   ├── cache/
│   └── sessions/
├── observer/                # OBSERVE owns
│   ├── active.json
│   ├── traces/{trace_id}.jsonl
│   └── locks/
└── index.json               # INITIALIZE owns
```

### Hardened Prompt Pattern

Since Gemini CLI can't call tools, we use parseable output markers:

```markdown
[PHASE:sourcing|analyzing|synthesizing|blocked]
[PASS:N/M]
[CONFIDENCE:0.X]

[COT]
Chain-of-thought reasoning here.
[/COT]

[SOURCE:name|quality:high|medium|low]
[FINDING:aspect_id]
[BLOCK:reason]
[CHECKPOINT]
```

Wrapper parses these markers and updates observer state.

### Query Interface

```bash
# Start observable research (async)
gemini-offloader research --async "complex topic"
→ {"trace_id": "t_abc123", "status": "started"}

# Poll status (snapshot)
gemini-offloader observe t_abc123
→ {"phase": "analyzing", "pass": {"current": 2, "total": 3}, "confidence": 0.7}

# Wait for condition (for Claude orchestration)
gemini-offloader observe t_abc123 --until phase:complete --timeout 120

# Stream for humans
gemini-offloader observe t_abc123 --watch
```

## Key Design Decisions

1. **Proactive communication**: Hardened prompt enforces marker output; wrapper parses
2. **Blocking as feature**: Explicit blocked state prevents low-confidence propagation
3. **CoT as first-class**: Chain-of-thought is searchable, indexable knowledge
4. **Context budgeting**: Multi-pass with checkpoints for long research sessions
5. **Aspect tracking**: Research can't complete until all aspects covered

## References

- Anthropic's long-running agent harness patterns
- para system prompt for status reporting patterns
- initializer plugin for parallel agent observability patterns

## Context Manifest
<!-- Added by context-gathering agent -->

## User Notes
<!-- Any specific notes or requirements from the developer -->

## Work Log
<!-- Updated as work progresses -->
- [2025-12-15] Task created from deep design discussion
