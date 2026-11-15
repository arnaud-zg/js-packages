// Empirically derived coefficients per content type.
// Prose merges well under BPE (4 chars → 1 token on average English).
// Code/identifiers and symbols are less compressible (~2.8 chars/token).
// Markdown structure (pipes, dashes, hashes) tokenizes poorly (~2.2 chars/token).
export const CHARS_PER_TOKEN = {
  prose: 4.0,
  code: 2.8,
  structural: 2.2,
} as const;

export function estimateTokens(content: string): number {
  const lines = content.split("\n");
  let proseChars = 0;
  let codeChars = 0;
  let structuralChars = 0;
  let inCodeFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^```|^~~~/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      structuralChars += line.length + 1;
      continue;
    }

    if (inCodeFence) {
      codeChars += line.length + 1;
      continue;
    }

    if (trimmed.startsWith("|")) {
      structuralChars += line.length + 1;
      continue;
    }

    if (/^[-─═*_]{3,}\s*$/.test(trimmed)) {
      structuralChars += line.length + 1;
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      structuralChars += line.length + 1;
      continue;
    }

    // Blank lines cost almost nothing — count as 1 char each
    if (trimmed === "") {
      proseChars += 1;
      continue;
    }

    proseChars += line.length + 1;
  }

  return Math.round(
    proseChars / CHARS_PER_TOKEN.prose +
      codeChars / CHARS_PER_TOKEN.code +
      structuralChars / CHARS_PER_TOKEN.structural,
  );
}
