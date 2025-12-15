---
name: 09-langfuse-observability
parent: h-implement-bun-eval-suite
status: pending
created: 2025-12-15
---

# Migrate Observability from Judgeval to Self-Hosted Langfuse

## Problem/Goal

The agent-evals testing framework currently uses Judgeval for trace storage and visualization. Judgeval has limitations:
- Metered SaaS with 50k trace spans + 1k evaluations/month cap
- No self-hosted UI option (only backend data plane)
- Ongoing cloud dependency for local development

Langfuse provides a fully MIT-licensed alternative with single `docker compose up` deployment, no usage limits when self-hosted, and equivalent feature set.

**Reference document**: `docs/migration-judgeval-to-langfuse.md`

## Success Criteria
- [ ] Langfuse Docker deployment runs locally and UI accessible
- [ ] Project created with valid API keys configured in `.envrc`
- [ ] Agent-evals test case produces visible trace in Langfuse UI
- [ ] AgentEvals trajectory scores attach to traces correctly
- [ ] Parallel test runs produce isolated traces (unique IDs)
- [ ] Judgeval dependencies removed from project

## Context Manifest
<!-- Added by context-gathering agent -->

## User Notes
<!-- Any specific notes or requirements from the developer -->

## Work Log
<!-- Updated as work progresses -->
