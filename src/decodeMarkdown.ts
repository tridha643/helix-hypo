import { TextDecoder } from "node:util";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/**
 * Decode markdown bytes as strict UTF-8 so invalid input fails loudly.
 */
export function decodeMarkdownBuffer(raw: Buffer): string {
  let text: string;

  try {
    text = UTF8_DECODER.decode(raw);
  } catch (error) {
    throw new Error("Markdown file is not valid UTF-8.", { cause: error });
  }

  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}
