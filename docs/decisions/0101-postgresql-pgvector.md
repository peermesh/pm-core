# ADR-0101: PostgreSQL with pgvector Extension

## Metadata

| Field | Value |
|-------|-------|
| **Date** | 2026-01-02 |
| **Status** | accepted |
| **Authors** | AI-assisted |

---

## Context

PostgreSQL is the primary relational database for this project. Additionally, AI/RAG (Retrieval-Augmented Generation) applications like LibreChat require vector similarity search capabilities for storing and querying embeddings.

Options for vector search include:
- Dedicated vector databases (Pinecone, Weaviate, Milvus)
- PostgreSQL with pgvector extension
- Application-level vector search libraries

The solution must:
- Fit commodity VPS resource constraints
- Not require external cloud services
- Integrate with existing PostgreSQL infrastructure
- Support common embedding dimensions (OpenAI: 1536, others: 384-4096)

---

## Decision

**We will use pgvector/pgvector:pg16 as the PostgreSQL image**, which includes the pgvector extension pre-installed.

This decision:
- Uses PostgreSQL 16 (current stable)
- Includes pgvector for vector similarity search
- Uses IVFFlat indexing by default (memory-safe)
- Provides HNSW indexing as an option for scale

---

## Alternatives Considered

### Option A: Official postgres:16-alpine + Manual pgvector

**Description**: Use official PostgreSQL image and compile pgvector at runtime or in custom Dockerfile.

**Pros**:
- Smallest base image
- Full control over compilation

**Cons**:
- Build time adds 5-10 minutes to CI
- Compilation requires build dependencies in image
- Runtime installation delays container startup

**Why not chosen**: Pre-built images eliminate build complexity. Zero build time aligns with operational simplicity goals.

### Option B: Dedicated Vector Database

**Description**: Run Pinecone, Weaviate, Milvus, or Qdrant alongside PostgreSQL.

**Pros**:
- Purpose-built for vector operations
- Higher performance at scale

**Cons**:
- Additional container (500MB-2GB RAM)
- Separate backup/recovery procedures
- Data synchronization complexity
- Some require cloud services

**Why not chosen**: For VPS deployments under 10M vectors, pgvector provides excellent performance without additional infrastructure. A dedicated vector database would consume resources better used for applications.

### Option C: ankane/pgvector Image

**Description**: Community-maintained PostgreSQL + pgvector image.

**Pros**:
- Established community image
- Good documentation

**Cons**:
- Superseded by official pgvector team image
- May lag behind pgvector releases

**Why not chosen**: The `pgvector/pgvector` image is maintained by the pgvector team themselves, making it the authoritative source.

---

## Consequences

### Positive

- Vector search integrated with relational data in single database
- No additional containers for vector operations
- Familiar PostgreSQL tooling and backup procedures
- Pre-built image means zero build time

### Negative

- Debian-based image is larger than Alpine (~400MB vs ~80MB)
- IVFFlat indexes require periodic reindexing after large data changes
- HNSW index builds consume significant memory

### Neutral

- Vector operations use standard SQL syntax with pgvector operators

---

## Implementation Notes

### Image Selection

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    # NOT postgres:16-alpine (missing pgvector)
```

### Extension Initialization

Extensions must be created per-database:

```sql
-- In init script or manually
\c librechat
CREATE EXTENSION IF NOT EXISTS vector;
```

### Index Strategy

**IVFFlat (Default)** - Use for most deployments:
```sql
CREATE INDEX ON embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**HNSW (Scale)** - Use when query performance is critical:
```sql
CREATE INDEX ON embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### Memory Configuration

To prevent OOM during index builds:

```yaml
command:
  - "postgres"
  - "-c"
  - "maintenance_work_mem=256MB"  # Cap for safe index builds
```

### Storage Calculation

For OpenAI embeddings (1536 dimensions):
- Per vector: 4 * 1536 + 8 = 6,152 bytes (~6KB)
- 100k vectors: ~600MB
- 1M vectors: ~6GB

### Version Pinning for Production

```yaml
# Development - floating tag
image: pgvector/pgvector:pg16

# Production - pinned version
image: pgvector/pgvector:0.8.0-pg16
```

---

## References

### Documentation

- [pgvector GitHub](https://github.com/pgvector/pgvector) - Extension source and documentation
- [pgvector Docker Hub](https://hub.docker.com/r/pgvector/pgvector) - Official images

### Related ADRs

- [ADR-0100: Multi-Database Profiles](./0100-multi-database-profiles.md) - Database profile architecture

### Internal Reference

- D2.6-POSTGRESQL-EXTENSIONS.md - Original decision document with IVFFlat vs HNSW analysis

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-02 | Initial draft | AI-assisted |
| 2026-01-02 | Status changed to accepted | AI-assisted |
