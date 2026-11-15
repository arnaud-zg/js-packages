import type { CatalogWorkspace } from "./catalogWorkspace";

export type CatalogWorkspaceFile = {
  load(): CatalogWorkspace;
  save(workspace: CatalogWorkspace): void;
};
