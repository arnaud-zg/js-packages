import type { CatalogEntry } from "shiplane/plugin";
import { z } from "shiplane";
import { adapterEntry } from "shiplane/plugin";

import { cloudflarePagesStaticHosting } from "./cloudflare-pages-static-hosting.adapter";

/** What a shiplane.yml names from this plugin: `staticHosting: cloudflare-pages`. */
export const catalog: readonly CatalogEntry[] = [
  adapterEntry({
    name: "cloudflare-pages",
    port: "staticHosting",
    description: "Deploys each site to Cloudflare Pages, through wrangler",
    options: z.object({}),
    make: () => cloudflarePagesStaticHosting(),
  }),
];
