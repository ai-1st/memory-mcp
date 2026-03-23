# API Reference

Memory MCP has three application seams: the **Admin REST API** (for the UI and management), the **MCP Server** (for AI agents), and **background workers** (SQS-driven).

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   React UI  │────▶│  Admin REST API   │────▶│  DynamoDB   │
└─────────────┘     │  (Lambda)         │────▶│  S3 Vectors │
                    └──────┬───────────┘     └─────────────┘
                           │ SQS
                    ┌──────▼───────────┐
                    │  Scrape Worker   │──▶ SQS ──▶ Process Worker
                    │  (Lambda)        │           │  (Lambda)
                    └──────────────────┘           └──────────────┘
                                                         │
┌─────────────┐     ┌──────────────────┐                 │
│  AI Agents  │────▶│  MCP Server      │◀── same DynamoDB + S3 Vectors
│  (Cursor,   │     │  (Lambda)        │
│   Claude)   │     └──────────────────┘
└─────────────┘
```

---

## 1. Admin REST API

Lambda Function URL. Used by the React UI for all management operations.

### Projects

#### `GET /projects`

List all projects.

**Response:**
```json
{
  "projects": [
    { "id": "01KK...", "name": "My Project", "prompts": {}, "createdAt": "2026-03-07T..." }
  ]
}
```

#### `GET /projects/:id`

Get a project with its prompts and default prompt values.

**Response:**
```json
{
  "id": "01KK...",
  "name": "My Project",
  "prompts": { "chunking": "custom prompt or empty" },
  "defaultPrompts": { "chunking": "...default chunking prompt text..." },
  "createdAt": "2026-03-07T..."
}
```

#### `POST /projects`

Create a new project.

**Request body:**
```json
{ "name": "My Project", "prompts": { "chunking": "optional custom prompt" } }
```

**Response:** `201` with `{ id, name, prompts, createdAt }`

#### `PUT /projects/:id`

Update project name and/or prompts.

**Request body:**
```json
{ "name": "New Name", "prompts": { "chunking": "new prompt" } }
```

**Response:** `200` with `{ id, name, prompts }`

#### `DELETE /projects/:id`

Delete a project and all its documents, chunks, vectors, and jobs.

**Response:** `200` with `{ id, deleted: { db: {...}, vectors: N } }`

---

### Documents

Documents are unique by URL within a project. Re-ingesting the same URL updates the existing document in place.

#### `GET /projects/:id/documents`

List all documents in a project.

**Response:**
```json
{
  "documents": [
    { "id": "01KK...", "url": "https://...", "title": "Page Title", "chunksCreated": 15, "createdAt": "..." }
  ]
}
```

#### `GET /projects/:id/documents/:docId`

Get a single document with full contents.

**Response:**
```json
{ "id": "01KK...", "url": "https://...", "title": "...", "contents": "full text...", "chunksCreated": 15, "createdAt": "..." }
```

#### `POST /projects/:id/documents`

Add a document and generate chunks. If a document with the same URL exists, it is updated in place.

**Request body:**
```json
{ "url": "https://...", "contents": "full text", "title": "optional", "force": false }
```

- `force: true` — reprocess even if content hash hasn't changed

**Response:** `201` with `{ docId, url, skipped, chunksCreated }`

#### `POST /projects/:id/documents/:docId/reprocess`

Reprocess an existing document: delete old chunks/vectors and regenerate using the current chunking prompt. No request body needed.

**Response:** `200` with `{ docId, chunksCreated }`

---

### Chunks

#### `GET /projects/:id/chunks`

List all chunks in a project, optionally filtered by document.

**Query params:**
- `docId` — filter to chunks from a specific document

**Response:**
```json
{
  "chunks": [
    { "id": "01KK...", "type": "summary|qa|text", "content": "chunk text with preamble...", "docId": "01KK..." }
  ]
}
```

---

### Search

#### `GET /projects/:id/search`

Semantic similarity search across all chunks.

**Query params:**
- `q` — search query text (required)
- `limit` — max results (default: 5)

**Response:**
```json
{
  "results": [
    { "id": "01KK...", "type": "qa", "docId": "01KK...", "title": "preview...", "summary": "longer preview...", "score": 0.847 }
  ]
}
```

---

### Scraping

#### `POST /projects/:id/scrape`

Enqueue a new scrape job. Credentials are saved with the job for rerun support.

**Request body:**
```json
{
  "source": "jira|confluence",
  "config": {
    "baseUrl": "https://org.atlassian.net",
    "jql": "project=FOO AND resolution=Done",
    "parentUrl": "https://org.atlassian.net/wiki/spaces/SPACE/pages/123/Title"
  },
  "credentials": { "email": "you@company.com", "token": "atlassian-api-token" }
}
```

- Jira requires `config.jql` + `config.baseUrl`
- Confluence requires `config.parentUrl` + `config.baseUrl`

**Response:** `202` with `{ jobId, status: "pending" }`

#### `POST /projects/:id/scrape/:jobId/rerun`

Rerun a previous scrape job using its saved config and credentials.

**Request body (optional):**
```json
{ "config": { "override": "values" }, "credentials": { "override": "values" } }
```

**Response:** `202` with `{ jobId, rerunOf, status: "pending" }`

---

### Queues

#### `GET /projects/:id/queues`

Get queue status and job listings.

**Query params:**
- `processStatus` — filter process jobs by status (`pending`, `processing`, `completed`, `failed`, `none` to skip)
- `scrapeStatus` — filter scrape jobs by status
- `limit` — max process jobs to return (default: 100)
- `after` — pagination cursor (SK from previous response)

**Response:**
```json
{
  "scrape": {
    "pending": 0, "scraping": 1, "completed": 5, "failed": 0, "total": 6,
    "jobs": [
      {
        "id": "01KK...", "source": "jira", "config": { "baseUrl": "...", "jql": "..." },
        "status": "completed", "docsFound": 100, "docsEnqueued": 100,
        "hasCredentials": true, "error": null,
        "createdAt": "...", "updatedAt": "..."
      }
    ]
  },
  "process": {
    "pending": 0, "processing": 0, "completed": 100, "failed": 2, "total": 102,
    "hasMore": false, "lastSK": "JOB#01KK...",
    "jobs": [
      {
        "id": "01KK...", "docId": "01KK...", "url": "https://...", "title": "...",
        "status": "completed", "chunksCreated": 15,
        "error": null, "createdAt": "...", "updatedAt": "..."
      }
    ]
  }
}
```

#### `POST /projects/:id/queues/control`

Control queue workers (start/stop/clear/concurrency).

**Request body:**
```json
{ "queue": "scrape|process", "action": "start|stop|clear|concurrency", "value": 5 }
```

- `start`/`stop` — enable/disable the SQS event source mapping
- `clear` — purge the SQS queue and delete all job records
- `concurrency` — set max concurrent Lambda invocations (2-10)

#### `POST /projects/:id/queues/requeue`

Requeue failed or stuck process jobs.

**Request body:**
```json
{ "jobIds": ["01KK..."], "status": "processing|failed" }
```

Provide either `jobIds` (specific jobs) or `status` (all jobs with that status).

---

## 2. MCP Server

Lambda Function URL. JSON-RPC 2.0 protocol for AI agent integration. Read-only tools.

### Configuration

Project scoping is passed via `params.config.projectId` in the JSON-RPC payload, or as a `?projectId=` query parameter.

### Tools

#### `semantic_search`

Search chunks by semantic similarity.

**Input:** `{ query: string, limit?: number }`
**Config:** `{ projectId: string }`
**Returns:** Array of `{ id, type, docId, title, summary, score }`

#### `list_projects`

List all projects.

**Input:** `{}`
**Returns:** `{ projects: [{ id, name, createdAt }] }`

#### `list_documents`

List all documents in a project.

**Input:** `{}`
**Config:** `{ projectId: string }`
**Returns:** `{ documents: [{ id, url, title, chunksCreated, createdAt }] }`

#### `get_document`

Retrieve a document by ID with full contents.

**Input:** `{ id: string }`
**Config:** `{ projectId: string }`
**Returns:** `{ id, url, title, contents, chunksCreated, createdAt }`

---

## 3. Background Workers

SQS-triggered Lambda functions. Not called directly.

### Scrape Worker

**Trigger:** SQS `scrape` queue
**Concurrency:** max 2

Receives `{ projectId, jobId, source, config, credentials }`. Scrapes Jira (via JQL search) or Confluence (recursive page walk). For each document found:

1. Stores raw document in DynamoDB
2. Creates a process job
3. Sends message to the `process` SQS queue

Updates the scrape job status as it progresses (`pending` → `scraping` → `completed`/`failed`).

### Process Worker

**Trigger:** SQS `process` queue
**Concurrency:** max 5

Receives `{ projectId, jobId }`. Loads the document, runs the chunking pipeline:

1. Generates chunks via Claude Haiku (summary + Q&A + text chunks)
2. Embeds each chunk via Amazon Titan
3. Stores chunks in DynamoDB
4. Stores vectors in S3 Vectors

Updates the process job status (`pending` → `processing` → `completed`/`failed`).

---

## Data Flow

```
Scrape (Jira/Confluence)
  └─▶ Raw documents stored in DynamoDB
       └─▶ Process queue (SQS)
            └─▶ Process Worker
                 ├─▶ Claude Haiku generates chunks (summary, Q&A, text)
                 ├─▶ Titan embeds each chunk
                 ├─▶ Chunks stored in DynamoDB
                 └─▶ Vectors stored in S3 Vectors

Search query
  └─▶ Titan embeds query
       └─▶ S3 Vectors cosine similarity search
            └─▶ Top-K chunks returned with scores
```
