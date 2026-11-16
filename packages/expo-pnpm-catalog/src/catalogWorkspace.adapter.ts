import fs from "fs";

import type { CatalogWorkspaceFile } from "./catalogWorkspace.ports";
import { CatalogWorkspace } from "./catalogWorkspace";

export function createCatalogWorkspaceFile(filePath: string): CatalogWorkspaceFile {
  return {
    load: () =>
      CatalogWorkspace.fromText({ text: fs.readFileSync(filePath, "utf-8"), source: filePath }),
    save: (workspace) => fs.writeFileSync(filePath, workspace.toText()),
  };
}
