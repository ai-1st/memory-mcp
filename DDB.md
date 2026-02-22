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
| Topic | `P#<pid>#TOPIC` | `TOPIC#<ulid>` | `P#<pid>#CAT#<category>` | `TOPIC#<ulid>` |
| Replaced Topic | `P#<pid>#REPLACED` | `TOPIC#<ulid>` | *(original values)* | *(original values)* |
| Category | `P#<pid>#CAT` | `CAT#<category>` | `P#<pid>#CATS` | `CAT#<category>` |
| Embedding Cache | `EMBED` | `EMBED#<sha256>` | — | — |

### Project

| Attribute | Type | Description |
|---|---|---|
| `id` | String (ULID) | Project identifier |
| `name` | String | Display name |
| `createdAt` | String (ISO 8601) | Creation timestamp |
| `rules` | String (optional) | Categorization rules for how-to extraction |

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
| `topicsCreated` | Number | Count of topics ADDed when this doc was processed |
| `topicsReplaced` | Number | Count of topics REPLACEd when this doc was processed |
| `createdAt` | String (ISO 8601) | When the document was ingested |

### Topic

How-to entries extracted from documents.

| Attribute | Type | Description |
|---|---|---|
| `id` | String (ULID) | Topic identifier |
| `category` | String | Hierarchical category path (e.g. `infra/deployments`) |
| `title` | String | Action-oriented title (starts with "How to") |
| `summary` | String | Step-by-step procedure text |
| `doc_ids` | List\<String\> | ULIDs of source documents |
| `sha256` | String | SHA-256 of `title + summary`, used for deduplication |

### Replaced Topic

Archived topics that were superseded by a newer merged topic.
Same attributes as Topic, plus:

| Attribute | Type | Description |
|---|---|---|
| `replacement_topic_id` | String (ULID) | ID of the topic that replaced this one |

### Category

Aggregate counts per category within a project.

| Attribute | Type | Description |
|---|---|---|
| `category` | String | Category path |
| `topicCount` | Number | Number of active topics in this category |

### Embedding Cache

Global (not project-scoped) cache of text embeddings to avoid redundant Bedrock calls.

| Attribute | Type | Description |
|---|---|---|
| `embedding` | List\<Number\> | Vector embedding array |

## S3 Vector Storage

Bucket: `${StackName}-vectors-${AccountId}`

Each topic's embedding is stored as a JSON file:

```
vectors/<projectId>/<topicId>.json
```

Contains: `{ id, category, title, summary, doc_ids, embedding }`.

## Access Patterns

| Pattern | Key condition | Index |
|---|---|---|
| List all projects | `PK = 'PROJECT'` | Table |
| Get project by ID | `PK = 'PROJECT', SK = 'PROJECT#<id>'` | Table |
| Get document by ID | `PK = 'P#<pid>#DOC', SK = 'DOC#<id>'` | Table |
| List documents for project | `PK = 'P#<pid>#DOC'` | Table |
| Get latest doc by URL | `GSI1PK = 'P#<pid>#DOCURL#<sha256(url)>'`, ScanIndexForward=false, Limit=1 | GSI1 |
| Get topic by ID | `PK = 'P#<pid>#TOPIC', SK = 'TOPIC#<id>'` | Table |
| List topics by category | `GSI1PK = 'P#<pid>#CAT#<category>'` | GSI1 |
| Find topic by sha256 | `PK = 'P#<pid>#TOPIC'` + FilterExpression on `sha256` | Table |
| List all categories | `PK = 'P#<pid>#CAT'` | Table |
| Get cached embedding | `PK = 'EMBED', SK = 'EMBED#<sha256>'` | Table |

## Entity Relationships

```
Project
  ├── Documents (many)
  │     PK: P#<pid>#DOC
  │     GSI1: lookup by URL hash
  ├── Topics (many)
  │     PK: P#<pid>#TOPIC
  │     GSI1: grouped by category
  │     References Documents via doc_ids[]
  ├── Replaced Topics (many)
  │     PK: P#<pid>#REPLACED
  │     Points to replacement via replacement_topic_id
  └── Categories (many)
        PK: P#<pid>#CAT
        Tracks topicCount per category

Embedding Cache (global)
      PK: EMBED
      Caches embeddings by content sha256
```
