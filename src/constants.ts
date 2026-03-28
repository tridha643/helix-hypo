export const IngestStatus = {
  pending: "pending",
  indexed: "indexed",
  failed: "failed",
} as const;

export type IngestStatus = (typeof IngestStatus)[keyof typeof IngestStatus];

export const SourceType = {
  markdown: "markdown",
  pdf: "pdf",
} as const;
