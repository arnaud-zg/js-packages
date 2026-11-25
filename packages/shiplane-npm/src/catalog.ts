import type { CatalogEntry } from "shiplane/plugin";
import { z } from "shiplane";
import { adapterEntry } from "shiplane/plugin";

import { npmPackageRegistry } from "./npm-package-registry.adapter";

/** What a shiplane.yml names from this plugin: `packageRegistry: npm`. */
export const catalog: readonly CatalogEntry[] = [
  adapterEntry({
    name: "npm",
    port: "packageRegistry",
    description: "Publishes each package to npm, under its own dist-tag",
    options: z.object({
      staged: z
        .boolean()
        .optional()
        .describe("Wait for a person's 2FA approval on npm before a release is public"),
    }),
    make: (options) => npmPackageRegistry(options),
  }),
];
