/**
 * Local text embeddings (Orama-style): TensorFlow.js + Universal Sentence Encoder.
 * 512-dimensional vectors, L2-normalized before storage in HelixDB (same pattern as @orama/plugin-embeddings).
 */
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-cpu";
import { load as loadUseModel } from "@tensorflow-models/universal-sentence-encoder";

/** Matches Helix `CreateFileEmbedding` default model label. */
export const LOCAL_EMBED_MODEL_ID = "universal-sentence-encoder-512";

const MAX_CHARS = 12_000;

let useModel: Awaited<ReturnType<typeof loadUseModel>> | null = null;

export async function ensureLocalEmbeddingBackend(): Promise<void> {
  await tf.setBackend("cpu");
  await tf.ready();
}

export async function loadLocalEmbeddingModel(): Promise<void> {
  await ensureLocalEmbeddingBackend();
  if (!useModel) {
    useModel = await loadUseModel();
  }
}

function normalizeVector(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) {
    return values;
  }
  return values.map((val) => val / norm);
}

function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_CHARS) {
    return text;
  }
  return text.slice(0, MAX_CHARS);
}

/**
 * Embed a single string to a 512-dim normalized vector for `AddV<FileEmbedding>(vector, …)` in HelixDB.
 */
export async function helixEmbed(text: string): Promise<number[]> {
  await loadLocalEmbeddingModel();
  const input = truncateForEmbedding(text);
  const embedded = await useModel!.embed(input);
  const data = await embedded.data();
  embedded.dispose();
  const arr = Array.from(data) as number[];
  return normalizeVector(arr);
}

export function disposeLocalEmbeddingModel(): void {
  useModel = null;
}
