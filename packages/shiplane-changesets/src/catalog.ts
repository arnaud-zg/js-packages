import type { CatalogEntry } from "shiplane/plugin";
import { z } from "shiplane";
import { adapterEntry } from "shiplane/plugin";

import { changesetsVersioning } from "./changesets-versioning.adapter";
import { commitsVersioning } from "./commits-versioning.adapter";
import { lines, presets } from "./thanks";

/** A template, or the name of a ready-made one, such as whatsChanged. */
const template = (named: Readonly<Record<string, string>>) => {
  const byName = new Map(Object.entries(named));
  return z
    .string()
    .transform((value) => byName.get(value) ?? value)
    .optional();
};

const Notes = {
  line: template(lines).describe(
    `A template for each change's line, with {summary}, {authors} and {pr}; or a ready-made one: ${Object.keys(lines).join(", ")}`,
  ),
  thanks: template(presets).describe(
    `A template for the section that thanks contributors once, with {changes}, {contributors}, {list} and {avatars}; or a ready-made one: ${Object.keys(presets).join(", ")}`,
  ),
};

/** What a shiplane.yml names from this plugin: `versioning: changesets` or `versioning: commits`. */
export const catalog: readonly CatalogEntry[] = [
  adapterEntry({
    name: "changesets",
    port: "versioning",
    description: "Versions from the changesets in .changeset/, written with each change",
    options: z.object({
      version: z
        .array(z.string())
        .optional()
        .describe("What versions the repository: changeset version by default"),
      ...Notes,
    }),
    make: (options) => changesetsVersioning(options),
  }),
  adapterEntry({
    name: "commits",
    port: "versioning",
    description: "Versions from conventional commit titles, with no changeset to write",
    options: z.object(Notes),
    make: (options) => commitsVersioning(options),
  }),
];
