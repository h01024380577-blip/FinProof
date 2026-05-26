CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "evidence_chunks"
  ADD COLUMN IF NOT EXISTS "embedding_vector" vector;
