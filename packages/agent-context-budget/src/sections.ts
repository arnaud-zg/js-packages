/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { estimateTokens } from "./tokenEstimate";

export interface Section {
  heading: string;
  level: number;
  tokens: number;
}

export function parseSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let heading = "(preamble)";
  let level = 0;
  let buf: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    if (buf.length > 0) {
      sections.push({ heading, level, tokens: estimateTokens(buf.join("\n")) });
      buf = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```|^~~~/.test(trimmed)) {
      inCodeFence = !inCodeFence;
    }

    if (!inCodeFence) {
      const m = /^(#{1,6})\s+(.+)/.exec(trimmed);
      if (m) {
        flush();
        level = m[1]!.length;
        heading = m[2]!.trim();
        continue;
      }
    }

    buf.push(line);
  }

  flush();
  return sections;
}

export interface ParetoSection extends Section {
  pct: number;
  flagExtract: boolean;
}

export function computePareto(
  sections: Section[],
  fileTokens: number,
  fileRatio: number,
): ParetoSection[] {
  return [...sections]
    .sort((a, b) => b.tokens - a.tokens)
    .map((s) => ({
      ...s,
      pct: fileTokens > 0 ? s.tokens / fileTokens : 0,
      flagExtract: fileTokens > 0 && s.tokens / fileTokens >= 0.2 && fileRatio >= 0.85,
    }));
}
