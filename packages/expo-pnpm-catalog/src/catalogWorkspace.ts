/**
 * Represents pnpm-workspace.yaml — reads, resolves catalog references,
 * and writes version updates in place (preserving comments).
 */
import { load } from "js-yaml";

import type { WorkspaceYaml } from "./schemas";
import {
  DEFAULT_WORKSPACE_DIRS,
  getAllCatalogVersions,
  resolveCatalogRefs,
  updateVersionInYaml,
} from "./catalogUtils";
import { parseOrThrow, WorkspaceYamlSchema } from "./schemas";

export type { WorkspaceYaml };

export type WorkspaceText = {
  text: string;
  /** Names the file in a parse error. */
  source?: string;
};

export class CatalogWorkspace {
  private constructor(
    private readonly raw: string,
    private readonly source: string,
    private readonly data: WorkspaceYaml,
  ) {}

  static fromText({ text, source = "pnpm-workspace.yaml" }: WorkspaceText): CatalogWorkspace {
    const data = parseOrThrow({ schema: WorkspaceYamlSchema, value: load(text), source });
    return new CatalogWorkspace(text, source, data);
  }

  toText(): string {
    return this.raw;
  }

  getAllCatalogVersions(): Record<string, string> {
    return getAllCatalogVersions(this.data);
  }

  /**
   * Top-level workspace directories declared by `packages:` (e.g. `apps/*`
   * → `apps`). Falls back to the monorepo defaults when none are declared.
   */
  getWorkspaceDirs(): string[] {
    const dirs = new Set<string>();
    for (const pattern of this.data.packages ?? []) {
      const base = pattern.split("/")[0];
      if (base) dirs.add(base);
    }
    return dirs.size > 0 ? Array.from(dirs) : [...DEFAULT_WORKSPACE_DIRS];
  }

  resolveDeps(deps: Record<string, string>): Record<string, string> {
    return resolveCatalogRefs(deps, this.data);
  }

  writeVersion(packageName: string, newVersion: string): CatalogWorkspace {
    const text = updateVersionInYaml(this.raw, packageName, newVersion);
    return CatalogWorkspace.fromText({ text, source: this.source });
  }
}
