# API Contract: [Service/Component Name]

## Overview
This contract defines the interface for [Service/Component Name]. Implementing tasks and consuming tasks MUST adhere to this specification.

## Base URL
```
/api/v1/[resource]
```

## Endpoints

### GET /[resource]
List all resources.

**Response**:
```json
{
  "data": [
    {
      "id": "string",
      "field": "value"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

### GET /[resource]/:id
Get a single resource by ID.

**Response**:
```json
{
  "id": "string",
  "field": "value"
}
```

### POST /[resource]
Create a new resource.

**Request**:
```json
{
  "field": "value"
}
```

**Response**: `201 Created` with created resource.

### PUT /[resource]/:id
Update an existing resource.

**Request**:
```json
{
  "field": "updated value"
}
```

**Response**: `200 OK` with updated resource.

### DELETE /[resource]/:id
Delete a resource.

**Response**: `204 No Content`

## Error Responses

All endpoints may return:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

### Error Codes
- `NOT_FOUND` - Resource does not exist
- `VALIDATION_ERROR` - Invalid request payload
- `UNAUTHORIZED` - Missing or invalid authentication
- `FORBIDDEN` - Insufficient permissions

## Authentication
[Describe authentication requirements]

## Rate Limiting
[Describe rate limits if applicable]

## Implementing Tasks
- P1_1: Implements this contract
- P1_2: Consumes this contract

## Notes
- Contract version: 1.0
- Breaking changes require version bump
