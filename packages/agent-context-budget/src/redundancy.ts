import { gzipSync } from "node:zlib";

import { CHARS_PER_TOKEN, estimateTokens } from "./tokenEstimate";

export type RedundancyLevel = "shrink" | "ok" | "dense";

export function computeGzipRatio(content: string): number {
  const raw = Buffer.from(content, "utf-8");
  if (raw.length === 0) return 1;
  const compressed = gzipSync(raw, { level: 9 });
  return compressed.length / raw.length;
}

export function redundancyLevelFromGzip(ratio: number): RedundancyLevel {
  if (ratio < 0.3) return "shrink";
  if (ratio > 0.55) return "dense";
  return "ok";
}

export interface NoiseResult {
  tokens: number;
  pct: number;
  flagged: boolean;
}

const NOISE_THRESHOLD = 0.1;

export function detectStructuralNoise(content: string): NoiseResult {
  let noiseChars = 0;

  // Horizontal rules
  for (const m of content.matchAll(/^[-─═*_]{3,}\s*$/gm)) {
    noiseChars += m[0].length + 1;
  }

  // HTML comments
  for (const m of content.matchAll(/<!--[\s\S]*?-->/g)) {
    noiseChars += m[0].length;
  }

  // Table separator rows (| :--- | :---: | ---: |)
  for (const m of content.matchAll(/^\|[-: |]+\|$/gm)) {
    noiseChars += m[0].length + 1;
  }

  // Consecutive blank lines beyond 1 (each extra newline is waste)
  for (const m of content.matchAll(/\n{3,}/g)) {
    noiseChars += m[0].length - 2;
  }

  const noiseTokens = Math.round(noiseChars / CHARS_PER_TOKEN.structural);
  const fileTokens = estimateTokens(content);
  const pct = fileTokens > 0 ? noiseTokens / fileTokens : 0;

  return { tokens: noiseTokens, pct, flagged: pct > NOISE_THRESHOLD };
}

export function stripMarkdown(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^#{1,6}\s/gm, "")
    .replace(/\|[^\n]*/g, "")
    .replace(/[*_~[\]()]/g, "")
    .toLowerCase();
}

export function computeTTR(content: string): number {
  const words = stripMarkdown(content).match(/\b[a-z]{2,}\b/g) ?? [];
  if (words.length < 10) return 1;
  return new Set(words).size / words.length;
}

export function computeShannonEntropy(content: string): number {
  const words = stripMarkdown(content).match(/\b[a-z]{2,}\b/g) ?? [];
  if (words.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  let H = 0;
  for (const count of freq.values()) {
    const p = count / words.length;
    H -= p * Math.log2(p);
  }
  return H;
}

export function computeRedundancyScore(
  gzipRatio: number,
  ttr: number,
  entropy: number,
  maxEntropy: number,
): number {
  const w1 = 0.5,
    w2 = 0.3,
    w3 = 0.2;
  const H = maxEntropy > 0 ? entropy / maxEntropy : 0;
  return w1 * (1 - gzipRatio) + w2 * (1 - ttr) + w3 * (1 - H);
}
