import type { ReleaseUnit } from "../../domain/unit";
import { MemoryFiles } from "../../adapters/files/__fakes__/memory-files.fake";
import { packageRegistryFake } from "../../adapters/package-registry/__fakes__/package-registry.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { publishedPackage } from "../../modules/published-package/published-package.module";
import { webApp } from "../../modules/web-app/web-app.module";
import { testContext, testUnit } from "../../testing/releaseContext";

export const BRANCH = "feat/Login_page";
export const HEAD = "abc1234def";
export const TAG = "snapshot";
/** What the pending changesets give lib: a test version builds on it. */
export const LIB_NEXT = "1.3.0";
export const LIB_VERSION = "1.3.0-feat-login-page.abc1234";

export const manifest = (fields: Record<string, unknown>) => `${JSON.stringify(fields, null, 2)}\n`;

export const LIB_MANIFEST = manifest({ name: "@acme/lib", version: "1.2.0", private: false });

export const lib = testUnit("lib", {
  dir: "packages/lib",
  packageName: "@acme/lib",
  version: "1.2.0",
  module: "published-package",
});

export const kit = testUnit("kit", {
  dir: "packages/kit",
  packageName: "@acme/ui-kit",
  version: "0.4.0",
  module: "published-package",
});

export const web = testUnit("web", { module: "web-app", options: { site: "web-site" } });

/** A pending release of a package at its next version, as changesets plan it. */
export interface Pending {
  name: string;
  newVersion: string;
}

/**
 * A repository on a feature branch with an npm package and a web app, both pending in changesets,
 * every port a Fake: the registry records the dist-tag each publish is given, the shell records
 * what each command saw in the package's manifest when it ran.
 */
export const branchWorld = ({
  units = [lib, web],
  pending = [
    { name: "@acme/lib", newVersion: LIB_NEXT },
    { name: "@acme/web", newVersion: "0.2.0" },
  ],
  files = { "packages/lib/package.json": LIB_MANIFEST },
  yes = true,
  interactive = false,
}: {
  units?: ReleaseUnit[];
  pending?: Pending[];
  files?: Record<string, string>;
  yes?: boolean;
  interactive?: boolean;
} = {}) => {
  const registry = packageRegistryFake();
  const distTags: (string | undefined)[] = [];
  const jobs = registry.fake.jobs;
  registry.fake.jobs = (input) => {
    distTags.push(input.distTag);
    return jobs(input);
  };
  const memory = new MemoryFiles(files);
  const world = testContext({
    units,
    modules: [
      publishedPackage({ packageRegistry: registry }),
      webApp({ staticHosting: staticHostingFake() }),
    ],
    files: memory,
    yes,
    interactive,
  });
  world.source.seed({ position: { branch: BRANCH, head: HEAD, originMain: "main-tip" } });
  world.versioning.seed({
    plan: () => ({
      changesets: [],
      releases: pending.map(({ name, newVersion }) => ({
        name,
        type: "minor" as const,
        oldVersion: "0.0.0",
        newVersion,
        changesets: [],
      })),
    }),
  });
  // What each publish command saw in the manifests, as it ran.
  const manifestsAtRun: Record<string, string | null>[] = [];
  const attach = world.shell.attach;
  world.shell.attach = (command, args, options) => {
    manifestsAtRun.push(
      Object.fromEntries(
        units.map(({ dir }) => [
          dir,
          memory.read(dir === "." ? "package.json" : `${dir}/package.json`),
        ]),
      ),
    );
    return attach(command, args, options);
  };
  return { ...world, registry, distTags, files: memory, manifestsAtRun };
};
