import { z } from "zod";

import type { CatalogEntry } from "../ports/catalog.port";
import { shellServerHosting } from "../adapters/server-hosting/shell-server-hosting.adapter";
import { adapterEntry, deliveryIn, moduleEntry } from "../application/config/catalog";
import { agentPlugin } from "./agent-plugin/agent-plugin.module";
import { backendService } from "./backend-service/backend-service.module";
import { internalTool } from "./internal-tool/internal-tool.module";
import { mobileApp } from "./mobile-app/mobile-app.module";
import { publishedPackage } from "./published-package/published-package.module";
import { webApp } from "./web-app/web-app.module";

const Named = z.object({
  name: z
    .string()
    .optional()
    .describe("What an app's unit file names; the module's kind by default"),
});

/** What a YAML config names from shiplane itself: every module, and the built-in shell adapter. */
export const catalog: readonly CatalogEntry[] = [
  moduleEntry({
    name: "backend-service",
    description: "A long-lived service, such as an API: deployed from its tag",
    options: Named,
    slots: { serverHosting: { port: "serverHosting" } },
    make: ({ name }, slots) =>
      backendService({ name, serverHosting: deliveryIn(slots.serverHosting, "server-hosting") }),
  }),
  moduleEntry({
    name: "web-app",
    description: "A site served as static files, such as a single-page app",
    options: Named,
    slots: { staticHosting: { port: "staticHosting" } },
    make: ({ name }, slots) =>
      webApp({ name, staticHosting: deliveryIn(slots.staticHosting, "static-hosting") }),
  }),
  moduleEntry({
    name: "mobile-app",
    description: "A mobile app: a store build, or an update when its native layer did not change",
    options: Named,
    slots: { mobileDistribution: { port: "mobileDistribution" } },
    make: ({ name }, slots) =>
      mobileApp({
        name,
        mobileDistribution: deliveryIn(slots.mobileDistribution, "mobile-distribution"),
      }),
  }),
  moduleEntry({
    name: "published-package",
    description: "A package published to a registry, such as npm",
    options: Named,
    slots: { packageRegistry: { port: "packageRegistry" } },
    make: ({ name }, slots) =>
      publishedPackage({
        name,
        packageRegistry: deliveryIn(slots.packageRegistry, "package-registry"),
      }),
  }),
  moduleEntry({
    name: "internal-tool",
    description: "An app nothing deploys: versioned, tagged and noted, nothing more",
    options: Named,
    slots: {},
    make: ({ name }) => internalTool({ name }),
  }),
  moduleEntry({
    name: "agent-plugin",
    description: "A plugin for coding agents, such as a Claude Code plugin",
    options: Named,
    slots: {},
    make: ({ name }) => agentPlugin({ name }),
  }),
  adapterEntry({
    name: "shell",
    port: "serverHosting",
    description: "Deploys with the shell commands each app's unit file gives",
    options: z.object({}),
    make: () => shellServerHosting(),
  }),
];
