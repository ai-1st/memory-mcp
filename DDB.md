# DynamoDB Schema

Single-table design. All entities live in one table.

## Table

- **Name**: `${StackName}-table`
- **Billing**: PAY_PER_REQUEST
- **Primary key**: `PK` (String, HASH) + `SK` (String, RANGE)
- **GSI1**: `GSI1PK` (String, HASH) + `GSI1SK` (String, RANGE), projection ALL

## Entities

| Entity | PK | SK | GSI1PK | GSI1SK |
|---|---|---|---|---|
| Project | `PROJECT` | `PROJECT#<ulid>` | — | — |
| Document | `P#<pid>#DOC` | `DOC#<ulid>` | `P#<pid>#DOCURL#<sha256(url)>` | `DOC#<ulid>` |
| Chunk | `P#<pid>#CHUNK` | `CHUNK#<ulid>` | `P#<pid>#DOCCHUNKS#<docId>` | `CHUNK#<ulid>` |
| Embedding Cache | `EMBED` | `EMBED#<sha256>` | — | — |
| Scrape Job | `P#<pid>#SCRAPE` | `JOB#<ulid>` | — | — |
| Process Job | `P#<pid>#PQUEUE` | `JOB#<ulid>` | — | — |

### Project

| Attribute | Type | Description |
|---|---|---|
| `id` | String (ULID) | Project identifier |
| `name` | String | Display name |
| `prompts` | Map (optional) | Configurable prompts: `{ chunking: "..." }` |
| `createdAt` | String (ISO 8601) | Creation timestamp |

### Document

Source pages / articles. SK uses ULID for chronological ordering.
GSI1 enables lookup by URL to detect unchanged content and skip reprocessing.

| Attribute | Type | Description |
|---|---|---|
| `id` | String (ULID) | Document identifier |
| `url` | String | Source URL |
| `title` | String | Page / article title |
| `contents` | String | Full text content |
| `contentsSha256` | String | SHA-256 of `contents`, used for change detection |
| `chunksCreated` | Number | Count of chunks created when this doc was processed |
| `createdAt` | String (ISO 8601) | When the document was ingested |

### Chunk

Individual chunks extracted from documents. Each chunk is a standalone piece
of text with contextual preamble, suitable for embedding and retrieval.

| Attribute | Type | Description |
|---|---|---|
| `id` | String (ULID) | Chunk identifier |
| `type` | String | `summary`, `qa`, or `text` |
| `content` | String | The chunk text (with contextual preamble) |
| `docId` | String (ULID) | Source document ID |
| `sha256` | String | SHA-256 of content, for dedup |

### Embedding Cache

Global (not project-scoped) cache of text embeddings to avoid redundant Bedrock calls.

| Attribute | Type | Description |
|---|---|---|
| `embedding` | List\<Number\> | Vector embedding array |

### Scrape Job

| Attribute | Type | Description |
|---|---|---|
| `id` | String (ULID) | Job identifier |
| `source` | String | `jira` or `confluence` |
| `config` | Map | Source-specific config (baseUrl, jql, parentUrl) |
| `status` | String | `pending`, `scraping`, `completed`, `failed` |
| `docsFound` | Number | Count of documents found |
| `error` | String | Error message if failed |
| `createdAt` | String (ISO 8601) | When the job was created |

### Process Job

| Attribute | Type | Description |
|---|---|---|
| `id` | String (ULID) | Job identifier |
| `docId` | String (ULID) | Document to process |
| `status` | String | `pending`, `processing`, `completed`, `failed` |
| `chunksCreated` | Number | Count of chunks created |
| `error` | String | Error message if failed |
| `createdAt` | String (ISO 8601) | When the job was created |

## Access Patterns

| Pattern | Key condition | Index |
|---|---|---|
| List all projects | `PK = 'PROJECT'` | Table |
| Get project by ID | `PK = 'PROJECT', SK = 'PROJECT#<id>'` | Table |
| Get document by ID | `PK = 'P#<pid>#DOC', SK = 'DOC#<id>'` | Table |
| List documents for project | `PK = 'P#<pid>#DOC'` | Table |
| Get latest doc by URL | `GSI1PK = 'P#<pid>#DOCURL#<sha256(url)>'`, ScanIndexForward=false, Limit=1 | GSI1 |
| List chunks for project | `PK = 'P#<pid>#CHUNK'` | Table |
| List chunks by document | `GSI1PK = 'P#<pid>#DOCCHUNKS#<docId>'` | GSI1 |
| Get cached embedding | `PK = 'EMBED', SK = 'EMBED#<sha256>'` | Table |

## Entity Relationships

```
Project
  ├── Documents (many)
  │     PK: P#<pid>#DOC
  │     GSI1: lookup by URL hash
  ├── Chunks (many)
  │     PK: P#<pid>#CHUNK
  │     GSI1: grouped by source document
  │     References Document via docId
  ├── Scrape Jobs (many)
  │     PK: P#<pid>#SCRAPE
  └── Process Jobs (many)
        PK: P#<pid>#PQUEUE

Embedding Cache (global)
      PK: EMBED
      Caches embeddings by content sha256
```
