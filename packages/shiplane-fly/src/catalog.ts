import type { CatalogEntry } from "shiplane/plugin";
import { z } from "shiplane";
import { adapterEntry } from "shiplane/plugin";

import { flyServerHosting } from "./fly-server-hosting.adapter";

/** What a shiplane.yml names from this plugin: `serverHosting: fly`. */
export const catalog: readonly CatalogEntry[] = [
  adapterEntry({
    name: "fly",
    port: "serverHosting",
    description: "Deploys each app to Fly.io, through flyctl",
    options: z.object({}),
    make: () => flyServerHosting(),
  }),
];
