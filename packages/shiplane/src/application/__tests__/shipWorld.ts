import { z } from "zod";

import type { ReleaseModule } from "../../modules/module";
import type { Decision, Job } from "../../ports/delivery.port";
import { MemoryFiles } from "../../adapters/files/__fakes__/memory-files.fake";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { backendService } from "../../modules/backend-service/backend-service.module";
import { testContext, testUnit } from "../../testing/releaseContext";

/** The workflow file a tag holds when it can ship through the CI pipeline. */
export const SHIP_YML = "ci/ship.yml";

/** A module whose own platform decides, answering `decide` per tag. */
export const decidingModule = (
  decide: (tag: string) => Decision,
  overrides: Partial<ReleaseModule> = {},
): ReleaseModule => ({
  type: "module",
  name: "deciding",
  kind: "deciding",
  provider: "store",
  settings: z.object({}),
  adapters: [],
  ship: () => ({ where: "the store", jobs: [] }),
  decide: (_context, { tag }) => Promise.resolve(decide(tag)),
  ...overrides,
});

/** A job this machine runs, which the CI pipeline can also run from `ref` when given. */
export const jobOn = (label: string, ref?: string): Job => ({
  label,
  local: [{ command: "echo", args: [label] }],
  ...(ref ? { ci: { ref } } : {}),
});

/**
 * Backend services over a Fake host, then units of `deciding` when given, each tagged at 0.1.0 on
 * its own commit with ship.yml on its tag: both ways can ship every one until a test says otherwise.
 */
export const shipWorld = (
  names: string[] = ["api"],
  {
    yes = false,
    interactive = true,
    deciding,
    decided = [],
    prepare,
  }: {
    yes?: boolean;
    interactive?: boolean;
    /** The module the `decided` units name. */
    deciding?: ReleaseModule;
    decided?: string[];
    /** The config's `prepare`, run before each unit ships from this machine. */
    prepare?: string;
  } = {},
) => {
  const hosting = serverHostingFake();
  const files = new MemoryFiles();
  const all = [...names, ...decided];
  const world = testContext({
    units: [
      ...names.map((name) =>
        testUnit(name, { module: "backend-service", options: { service: `acme-${name}` } }),
      ),
      ...decided.map((name) => testUnit(name, { module: deciding?.name ?? "deciding" })),
    ],
    modules: [backendService({ serverHosting: hosting }), ...(deciding ? [deciding] : [])],
    yes,
    interactive,
    files,
  });
  if (prepare !== undefined) world.context.release.prepare = prepare;
  world.source.seed({
    tags: Object.fromEntries(all.map((name) => [`${name}@0.1.0`, `c-${name}`])),
    files: Object.fromEntries(all.map((name) => [`${name}@0.1.0:${SHIP_YML}`, "on: dispatch"])),
  });
  return { ...world, hosting: hosting.fake, files };
};
