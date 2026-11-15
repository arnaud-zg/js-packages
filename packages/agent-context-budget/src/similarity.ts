/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { stripMarkdown } from "./redundancy";

// Deterministic multiplicative hash — no external deps required
function hashStr(s: string, seed: number): number {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const K_SHINGLE = 5;
const NUM_HASHES = 128;
const SEEDS = Array.from({ length: NUM_HASHES }, (_, i) => (i * 2654435761) >>> 0);

export function extractShingles(content: string, k = K_SHINGLE): Set<string> {
  const words = stripMarkdown(content).match(/\b[a-z]{2,}\b/g) ?? [];
  const out = new Set<string>();
  for (let i = 0; i <= words.length - k; i++) {
    out.add(words.slice(i, i + k).join(" "));
  }
  return out;
}

export function minHash(shingles: Set<string>, numHashes = NUM_HASHES): number[] {
  const sig = new Array<number>(numHashes).fill(Infinity);
  for (const s of shingles) {
    for (let i = 0; i < numHashes; i++) {
      const h = hashStr(s, SEEDS[i]!);
      if (h < sig[i]!) sig[i] = h;
    }
  }
  return sig;
}

export function jaccardFromMinHash(sigA: number[], sigB: number[]): number {
  // An all-Infinity signature comes from an empty shingle set: nothing to compare.
  if (sigA[0] === Infinity || sigB[0] === Infinity) return 0;
  let matches = 0;
  for (let i = 0; i < sigA.length; i++) {
    if (sigA[i] === sigB[i]) matches++;
  }
  return matches / sigA.length;
}

export type SimilarityFlag = "duplication" | "merge-candidate" | null;

export interface SimilarityPair {
  fileA: string;
  fileB: string;
  jaccard: number;
  flag: SimilarityFlag;
}

export function findSimilarFiles(
  files: Array<{ path: string; content: string }>,
  jMerge = 0.3,
  jDup = 0.6,
): SimilarityPair[] {
  const sigs = files.map((f) => ({ path: f.path, sig: minHash(extractShingles(f.content)) }));
  const pairs: SimilarityPair[] = [];

  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      const jaccard = jaccardFromMinHash(sigs[i]!.sig, sigs[j]!.sig);
      const flag: SimilarityFlag =
        jaccard >= jDup ? "duplication" : jaccard >= jMerge ? "merge-candidate" : null;
      if (flag !== null) {
        pairs.push({ fileA: sigs[i]!.path, fileB: sigs[j]!.path, jaccard, flag });
      }
    }
  }

  return pairs.sort((a, b) => b.jaccard - a.jaccard);
}
