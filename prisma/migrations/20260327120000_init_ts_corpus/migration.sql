-- CreateTable
CREATE TABLE "corpus_files" (
    "id" UUID NOT NULL,
    "corpus_id" VARCHAR(256) NOT NULL,
    "storage_path" VARCHAR(4096) NOT NULL,
    "original_filename" VARCHAR(1024) NOT NULL,
    "raw_content" BYTEA,
    "content_sha256" VARCHAR(64),
    "bytes_size" INTEGER,
    "source_type" VARCHAR(32) NOT NULL,
    "ingest_status" VARCHAR(32) NOT NULL,
    "helix_doc_id" VARCHAR(128),
    "last_ingested_at" TIMESTAMPTZ(6),
    "extracted_text" TEXT,
    "text_extractor" VARCHAR(128),
    "extracted_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "corpus_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_corpus_files_corpus_sha" ON "corpus_files"("corpus_id", "content_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ix_corpus_files_corpus_path" ON "corpus_files"("corpus_id", "storage_path");
