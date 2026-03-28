import pdfParse from "pdf-parse";

export type ExtractPdfResult = {
  text: string;
  nPages: number;
  info?: Record<string, unknown>;
};

/**
 * Extract plain text from PDF bytes (no Python — uses `pdf-parse` / pdf.js).
 */
export async function extractTextFromPdfBuffer(
  pdfBuffer: Buffer
): Promise<ExtractPdfResult> {
  const data = await pdfParse(pdfBuffer);
  return {
    text: (data.text ?? "").trim(),
    nPages: data.numpages,
    info: data.info as Record<string, unknown> | undefined,
  };
}
