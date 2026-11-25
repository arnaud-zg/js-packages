import type { AnyDeliveryAdapter } from "../../modules/suggest";
import type { Detection, FolderView } from "../../ports/delivery.port";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { detecting, memoryRepository } from "../../testing/memoryRepository";
import { createWorkspace } from "../../testing/workspace";

// Init lists the workspace's folders from the disk under its root, then reads and writes every file
// through the files port. The same files sit in a temp folder, for the listing, and in memory, where
// every write lands: nothing outside the temp folder is read, nothing on disk is written.

/** An adapter that recognises a folder holding `marker` with the certainty given. */
const recognising = <Adapter extends AnyDeliveryAdapter>(
  adapter: Adapter,
  name: string,
  marker: string,
  certainty: Detection["certainty"],
): Adapter => ({
  ...adapter,
  name,
  detect: (folder: FolderView): Detection | null =>
    folder.has(marker) ? { certainty, reason: marker, options: {} } : null,
});

/** Cloud is sure of a cloud.toml; pages thinks a vite config likely; docker, a Dockerfile possible. */
export const initAdapters = () => [
  recognising(serverHostingFake(), "docker", "Dockerfile", "possible"),
  detecting(serverHostingFake(), "cloud", "cloud.toml", (folder) => ({ service: folder.name })),
  {
    ...recognising(staticHostingFake(), "pages", "vite.config.ts", "likely"),
    questions: () => [
      { key: "site", message: "Site name?", initial: "web" },
      { key: "build.command", message: "Build command?" },
    ],
  },
];

export const manifest = (name: string) => JSON.stringify({ name, version: "0.1.0" });

/** api ships on cloud, web is likely pages, tools has nothing to ship it, old has its unit file. */
export const WORKSPACE = {
  "package.json": JSON.stringify({ name: "@acme/mono", private: true }),
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  "apps/api/package.json": manifest("@acme/api"),
  "apps/api/cloud.toml": 'app = "acme-api"\n',
  "apps/api/Dockerfile": "FROM node\n",
  "apps/web/package.json": manifest("@acme/web"),
  "apps/web/vite.config.ts": "export default {};\n",
  "apps/web/Dockerfile": "FROM nginx\n",
  "apps/tools/package.json": manifest("@acme/tools"),
  "apps/notes/cloud.toml": "",
};

/** A repository for init: in memory, its folders listed from a temp copy that `remove` deletes. */
export const initRepository = (
  files: Record<string, string>,
  { interactive = true }: { interactive?: boolean } = {},
) => {
  const workspace = createWorkspace(files);
  const repo = memoryRepository(files, initAdapters(), { interactive });
  return {
    ...repo,
    context: { ...repo.context, root: workspace.root },
    remove: workspace.remove,
  };
};
