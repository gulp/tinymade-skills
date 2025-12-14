# Data Model: [Task Name]

## Overview
This document defines shared entity schemas and type definitions used across all parallel tasks in this breakdown. All subtasks MUST reference these definitions to ensure compatibility.

## Entities

### [EntityName]
```typescript
interface EntityName {
  id: string;
  // Add fields as identified during breakdown
}
```

**Used by**: P1_1, P1_2, P2_1

### [AnotherEntity]
```typescript
interface AnotherEntity {
  id: string;
  entityNameId: string; // Foreign key to EntityName
  // Add fields
}
```

**Used by**: P1_2, P2_1

## Enums and Constants

### [StatusEnum]
```typescript
enum StatusEnum {
  PENDING = 'pending',
  ACTIVE = 'active',
  COMPLETED = 'completed',
}
```

## Shared Types

### [CommonType]
```typescript
type CommonType = {
  // Shared type definition
};
```

## Database Schema (if applicable)

### Tables
- `entity_name` - Stores EntityName records
- `another_entity` - Stores AnotherEntity records

### Migrations
Migration files should be created in Phase 1 infrastructure task.

## Notes
- All parallel tasks implementing these entities must use these exact schemas
- Changes to this model require coordination across all dependent tasks
- Version: 1.0 (update when schema changes)
