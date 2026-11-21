import type { CatalogEntry } from "shiplane/plugin";
import { z } from "shiplane";
import { adapterEntry } from "shiplane/plugin";

import { gitSourceControl } from "./git-source-control.adapter";

/** What a shiplane.yml names from this plugin: `sourceControl: git`. */
export const catalog: readonly CatalogEntry[] = [
  adapterEntry({
    name: "git",
    port: "sourceControl",
    description: "Branches, commits and tags, through the git CLI",
    options: z.object({
      main: z
        .string()
        .optional()
        .describe(
          "The branch releases start from; origin's default branch, main or master, when absent",
        ),
      format: z
        .array(z.string())
        .optional()
        .describe("Run on the files of a commit before it is made, such as a formatter"),
      retryDelays: z
        .array(z.number())
        .optional()
        .describe("How long to wait before each new try of a push the network dropped, in ms"),
    }),
    make: (options) => gitSourceControl(options),
  }),
];
