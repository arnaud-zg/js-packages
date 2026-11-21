import type { CatalogEntry } from "shiplane/plugin";
import { z } from "shiplane";
import { adapterEntry } from "shiplane/plugin";

import { easMobileDistribution } from "./eas-mobile-distribution.adapter";

/** What a shiplane.yml names from this plugin: `mobileDistribution: eas`. */
export const catalog: readonly CatalogEntry[] = [
  adapterEntry({
    name: "eas",
    port: "mobileDistribution",
    description: "Builds, submits and updates each app with Expo Application Services",
    options: z.object({}),
    make: () => easMobileDistribution(),
  }),
];
