# Quickstart: [Task Name]

## Overview
This guide provides runtime testing instructions for validating the phased breakdown implementation.

## Prerequisites
- [List required tools, dependencies, environment setup]
- All spec artifacts reviewed (data-model.md, contracts/)

## Setup

### Environment
```bash
# Copy environment template
cp .env.example .env

# Install dependencies
[package manager] install
```

### Database (if applicable)
```bash
# Run migrations
[migration command]

# Seed test data
[seed command]
```

## Running Services

### Phase 1 Components
After Phase 1 completion, you can run:

```bash
# Start [Service 1] (from P1_1)
[start command]

# Start [Service 2] (from P1_2)
[start command]
```

### Full Stack (after all phases)
```bash
# Start all services
[start all command]
```

## Validation Tests

### Contract Validation
Verify API contracts are implemented correctly:

```bash
# Test P1_1 endpoints
curl http://localhost:3000/api/v1/[resource]

# Test P1_2 endpoints
curl http://localhost:3000/api/v1/[other-resource]
```

### Integration Tests
After Phase 2 completion:

```bash
# Run integration test suite
[test command]
```

### End-to-End Validation
After all phases complete:

```bash
# Run full E2E tests
[e2e test command]
```

## Common Issues

### Issue 1: [Common Problem]
**Symptom**: [What you see]
**Solution**: [How to fix]

### Issue 2: [Another Problem]
**Symptom**: [What you see]
**Solution**: [How to fix]

## Phase Completion Checklist

### Phase 1
- [ ] All parallel tasks complete
- [ ] Services start without errors
- [ ] Contract endpoints respond correctly

### Phase 2
- [ ] Integration task complete
- [ ] Services communicate correctly
- [ ] Integration tests pass

### Final
- [ ] All phases complete
- [ ] E2E tests pass
- [ ] Ready for merge

## Notes
- Each phase should be validated before proceeding to the next
- Report integration issues to orchestrator immediately
