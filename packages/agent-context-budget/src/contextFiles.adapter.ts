import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ContextFiles } from "./contextFiles.ports";

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isFile(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function claudeMdUnder(dirs: string[]): string[] {
  return dirs
    .flatMap((dir) => entriesOf(dir).map((entry) => join(dir, entry, "CLAUDE.md")))
    .filter(isFile)
    .sort();
}

function markdownIn(dir: string): string[] {
  return entriesOf(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => join(dir, file));
}

export function createContextFiles(): ContextFiles {
  return { read, exists: existsSync, claudeMdUnder, markdownIn };
}
