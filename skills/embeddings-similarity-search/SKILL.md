---
name: embeddings-similarity-search
description: Representing items (images, text, structured records) as vectors and finding similar ones — perceptual hashes, CLIP embeddings, pgvector, cosine similarity, and near-duplicate clustering.
used-by: [photo-dedupe-tool, trail-social-app]
---

# Skill: Embeddings & Similarity Search

## Purpose

"Find things like this thing." Convert items into fixed-length vectors so
similarity becomes a distance computation: near-duplicate photo detection
today, content-based trail recommendations later.

## When to Use

- Photo dedupe: exact dupes (checksums) → near dupes (perceptual hash) →
  visually similar (CLIP embeddings).
- Trail recommendations phase 2: embed trail descriptions/attributes and
  match against a user-taste vector (upgrade path from the rule-based engine).
- Any future semantic search over text.

Don't reach for embeddings when a checksum, a SQL filter, or a tag match
answers the question — cheaper signals first.

## Inputs

- The item corpus (photos on disk; trail records).
- A similarity threshold policy (what counts as "duplicate" vs "similar") —
  always tuned on real data, never guessed.

## Outputs

- An embeddings store (pgvector column or SQLite + in-memory index).
- A `find_similar(item, k, threshold)` query/function.
- For dedupe: clustered groups of near-duplicates for human review.

## Default Stack

| Concern | Default | Notes |
|---|---|---|
| Image embeddings | **CLIP** (`open_clip`, ViT-B/32) via Python | 512-dim, great for "same scene, different shot" |
| Perceptual hash | `pHash`/`dHash` (`imagehash` py / `sharp`+blockhash js) | 64-bit, catches resizes/re-encodes cheaply |
| Exact dupes | SHA-256 of file bytes | Free — do this first, always |
| Vector store (server) | **Postgres + pgvector** (`vector(512)` column, HNSW index) | One database, no new infra |
| Vector store (local tool) | SQLite + brute-force NumPy cosine (fine ≤ ~200k items) or `faiss` beyond | Zero-ops for a CLI |
| Text embeddings (future) | Provider API (e.g. Voyage) or `sentence-transformers` local | Same storage/query pattern |

**Language note:** the Python ML ecosystem wins for CLIP. For the photo tool,
Python end-to-end is simplest. In Node projects, run embedding generation as
a small Python worker (or ONNX runtime) and keep storage/query in Postgres.

## The Dedupe Ladder (cheapest first)

1. **SHA-256 checksum** → byte-identical duplicates. Group by hash. Done.
2. **Perceptual hash** → same image re-encoded/resized/lightly edited.
   Hamming distance on 64-bit hashes; distance ≤ 5 is a strong dupe signal.
   BK-tree or brute force (64-bit XOR+popcount is fast) for lookup.
3. **CLIP embedding + cosine similarity** → same scene/burst shots/crops.
   `similarity = 1 - cosine_distance`; start reviewing pairs above ~0.96,
   surface 0.90–0.96 as "similar, maybe not dupes". Tune on your own library.

Each rung reduces the candidate set for the next; never CLIP-compare what a
checksum already resolved.

## pgvector Essentials

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE photos ADD COLUMN embedding vector(512);

-- HNSW index for cosine distance (good default; build after bulk load)
CREATE INDEX idx_photos_embedding ON photos
  USING hnsw (embedding vector_cosine_ops);

-- k-NN query
SELECT id, 1 - (embedding <=> $1) AS similarity
FROM photos
WHERE id <> $2
ORDER BY embedding <=> $1
LIMIT 10;
```

- Normalize vectors on write (CLIP outputs should be L2-normalized) so
  cosine and inner-product agree.
- Record the model + version alongside vectors: `embedding_model text` —
  vectors from different models are **not comparable**; a model upgrade
  means re-embedding everything.

## Clustering Near-Duplicates for Review

Pairwise "A is similar to B" must become review groups:

- Build a graph: nodes = photos, edges = pairs above threshold.
- Connected components = duplicate groups (union-find is enough).
- Within each group, pick a suggested "keeper" by heuristic: highest
  resolution → largest file → earliest EXIF timestamp. The human confirms;
  the tool never auto-deletes.

## Best Practices

- Cache embeddings keyed by file checksum — never re-embed unchanged files.
- Batch embedding generation (GPU or not, batching is 10–50× faster).
- Store thresholds in config, log score distributions, and revisit after the
  first real run — thresholds are data-dependent.
- Evaluate with a small labeled set (50 known-dupe pairs, 50 known-distinct):
  report precision/recall before trusting a threshold.
- For recommendations: build the user-taste vector as a decayed mean of
  embeddings of items they engaged with; filter hard constraints (distance,
  difficulty) with SQL *first*, rank the survivors by similarity.

## Pitfalls

- Comparing vectors from different models/versions.
- Trusting cosine scores as probabilities — they're only ordinal; calibrate
  thresholds empirically.
- Auto-deleting on similarity alone — bursts, brackets, and panorama frames
  score high but are not duplicates. Human review is part of the design.
- Building a vector DB service (Pinecone etc.) for < millions of items —
  pgvector or in-process search is simpler and free.

## Used By

- **photo-dedupe-tool** — the core of the product (all three ladder rungs).
- **trail-social-app** — phase 2 recommendation upgrade (trail embeddings + user-taste vector).
