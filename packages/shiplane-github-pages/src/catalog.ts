import type { CatalogEntry } from "shiplane/plugin";
import { z } from "shiplane";
import { adapterEntry } from "shiplane/plugin";

import { githubPagesStaticHosting } from "./github-pages-static-hosting.adapter";

/** What a shiplane.yml names from this plugin: `staticHosting: github-pages`. */
export const catalog: readonly CatalogEntry[] = [
  adapterEntry({
    name: "github-pages",
    port: "staticHosting",
    description: "Deploys each site to GitHub Pages, through a branch",
    options: z.object({}),
    make: () => githubPagesStaticHosting(),
  }),
];
