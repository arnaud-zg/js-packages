// Two modules as a real shiplane.config.ts composes them, each given a local adapter.
export const MODULE_CONFIG = `
import {
  backendService,
  defineRelease,
  defineServerHosting,
  defineStaticHosting,
  perEnv,
  releaseFlow,
  webApp,
  z,
} from "shiplane";
import {
  ciPipelineFake,
  codeHostFake,
  sourceControlFake,
  versioningFake,
} from "shiplane/testing";

// A flow of Fakes: plugins fill these ports in a real repository.
const flow = releaseFlow({
  sourceControl: sourceControlFake(),
  codeHost: codeHostFake(),
  ciPipeline: ciPipelineFake(),
  versioning: versioningFake(),
});

// A feature as a plugin gives one, such as release comments.
const notes = {
  type: "feature" as const,
  name: "release-comments",
  adapters: [],
  afterShip: () => Promise.resolve([]),
};

const pages = defineStaticHosting({
  name: "pages",
  settings: z.object({
    project: z.string(),
    url: perEnv(z.string()).optional(),
    build: z.object({ env: z.record(z.string(), perEnv(z.string())) }).optional(),
  }),
  describe: () => "",
  jobs: () => [],
});

const server = defineServerHosting({
  name: "server",
  settings: z.object({ app: perEnv(z.string()), url: perEnv(z.string()) }),
  describe: () => "",
  jobs: () => [],
});

export default defineRelease({
  flow,
  modules: [backendService({ serverHosting: server }), webApp({ staticHosting: pages })],
});
`;

const MODULES =
  "modules: [backendService({ serverHosting: server }), webApp({ staticHosting: pages })]";

/** The same config composing other modules, and features when given. */
export const withModules = (modules: string, features?: string) =>
  MODULE_CONFIG.replace(
    MODULES,
    `modules: [${modules}]${features ? `,\n  features: [${features}]` : ""}`,
  );

export const SERVER_UNIT = `module: backend-service
app:
  preview: api-preview
  production: api-production
url:
  preview: https://api-preview.example.com
  production: https://api.example.com
`;

export const ADMIN_UNIT = `module: web-app
project: admin-site
build:
  env:
    API_URL: \${units.api.url}
`;

/** The adapters MODULE_CONFIG composes, as a local file's catalog a shiplane.yml names. */
export const FAKES_CATALOG = `
import { z } from "shiplane";
import { adapterEntry, defineServerHosting, defineStaticHosting, perEnv } from "shiplane/plugin";
import {
  ciPipelineFake,
  codeHostFake,
  sourceControlFake,
  versioningFake,
} from "shiplane/testing";

export const pages = defineStaticHosting({
  name: "pages",
  settings: z.object({
    project: z.string(),
    url: perEnv(z.string()).optional(),
    build: z.object({ env: z.record(z.string(), perEnv(z.string())) }).optional(),
  }),
  describe: () => "",
  jobs: () => [],
});

export const server = defineServerHosting({
  name: "server",
  settings: z.object({ app: perEnv(z.string()), url: perEnv(z.string()) }),
  describe: () => "",
  jobs: () => [],
});

const none = z.object({});
export const catalog = [
  adapterEntry({ name: "fake", port: "sourceControl", description: "", options: none, make: () => sourceControlFake() }),
  adapterEntry({ name: "fake", port: "codeHost", description: "", options: none, make: () => codeHostFake() }),
  adapterEntry({ name: "fake", port: "ciPipeline", description: "", options: none, make: () => ciPipelineFake() }),
  adapterEntry({ name: "fake", port: "versioning", description: "", options: none, make: () => versioningFake() }),
  adapterEntry({ name: "server", port: "serverHosting", description: "", options: none, make: () => server }),
  adapterEntry({ name: "pages", port: "staticHosting", description: "", options: none, make: () => pages }),
];
`;

/** MODULE_CONFIG as a shiplane.yml, its adapters from FAKES_CATALOG at shiplane/adapters/fakes.ts. */
export const YAML_MODULE_CONFIG = `flow:
  sourceControl: ./shiplane/adapters/fakes.ts
  codeHost: ./shiplane/adapters/fakes.ts
  ciPipeline: ./shiplane/adapters/fakes.ts
  versioning: ./shiplane/adapters/fakes.ts
modules:
  - use: backend-service
    with:
      serverHosting: ./shiplane/adapters/fakes.ts
  - use: web-app
    with:
      staticHosting: ./shiplane/adapters/fakes.ts
`;

/** MODULE_CONFIG's release, its adapters imported from FAKES_CATALOG's file: what migrate converts. */
export const MIGRATABLE_CONFIG = `
import { backendService, comments, defineRelease, releaseFlow, webApp } from "shiplane";
import { ciPipelineFake, codeHostFake, sourceControlFake, versioningFake } from "shiplane/testing";

import { pages, server } from "./shiplane/adapters/fakes";

export default defineRelease({
  flow: releaseFlow({
    sourceControl: sourceControlFake(),
    codeHost: codeHostFake(),
    ciPipeline: ciPipelineFake(),
    versioning: versioningFake(),
  }),
  modules: [backendService({ name: "api-eu", serverHosting: server }), webApp({ staticHosting: pages })],
  tag: "plugin",
  testComment: comments.compact,
  prepare: "pnpm --filter {unit}... build",
});
`;
