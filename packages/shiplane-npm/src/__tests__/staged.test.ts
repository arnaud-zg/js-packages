import { publishedPackage } from "shiplane/plugin";
import { shipTo, TEST_FLOW, testContext, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { catalog } from "../catalog";
import { npmPackageRegistry } from "../npm-package-registry.adapter";

const kitWith = (options: Record<string, unknown> = {}) =>
  testUnit("kit", {
    dir: "packages/kit",
    packageName: "kit",
    version: "0.2.0",
    module: "published-package",
    options,
  });

const LIST = "npx --yes npm@^11.15.0 stage list";
const STAGE = "npx --yes npm@^11.15.0 stage publish";

const setUp = (options: Record<string, unknown> = {}) => {
  const world = testContext({
    units: [kitWith(options)],
    modules: [publishedPackage({ packageRegistry: npmPackageRegistry({ staged: true }) })],
  });
  world.source.seed({ tags: { "kit@0.2.0": "head-1" } });
  world.shell.seed("npm view", { status: 1, stderr: "npm error code E404" });
  const ran = () => world.shell.calls.map(({ command, args }) => [command, ...args].join(" "));
  return { ...world, ran };
};

describe("staging a package on npm", () => {
  it("given a version npm does not have, when it ships, then pnpm packs it, npm stages the tarball and the tarball is removed", async () => {
    const { context, shell, prompter, ran } = setUp();
    shell.seed(LIST, { stdout: "[]" });
    prompter.answer(true);

    expect(await shipTo(context, "preview", {})).toBe(true);

    expect(ran().slice(-4)).toEqual([
      "pnpm run --if-present prepublishOnly",
      "pnpm pack --out .shiplane-stage.tgz",
      `${STAGE} ./.shiplane-stage.tgz --access public --tag latest`,
      "rm -f .shiplane-stage.tgz",
    ]);
  });

  it("given the version waits for approval, when it ships again, then nothing is uploaded and it says to approve it", async () => {
    const { context, shell, output, ran } = setUp();
    shell.seed(LIST, { stdout: JSON.stringify([{ version: "0.2.0" }]) });

    expect(await shipTo(context, "preview", {})).toBe(true);

    expect(ran().some((line) => line.startsWith(STAGE))).toBe(false);
    expect(output.text).toContain("staged on npm: approve it on npmjs.com");
  });

  it.each([
    ["another version waits", { stdout: JSON.stringify([{ version: "0.1.0" }]) }],
    ["npm cannot list, as with an OIDC token", { status: 1 }],
    ["npm answers no JSON", { stdout: "npm notice" }],
  ])("given %s, when it ships, then the version is staged", async (_, reply) => {
    const { context, shell, prompter, ran } = setUp();
    shell.seed(LIST, reply);
    prompter.answer(true);

    expect(await shipTo(context, "preview", {})).toBe(true);

    expect(ran().some((line) => line.startsWith(STAGE))).toBe(true);
  });

  it("given staging fails under another name, when it ships, then the ship fails, the tarball is removed and the name put back", async () => {
    const { context, shell, prompter, ran } = setUp({ publishAs: "@acme/kit" });
    shell.seed(LIST, { stdout: "[]" });
    shell.seed(STAGE, { status: 1 });
    prompter.answer(true);

    expect(await shipTo(context, "preview", {})).toBe(false);

    expect(ran()).toContain("npm pkg set name=@acme/kit");
    expect(ran().slice(-2)).toEqual(["rm -f .shiplane-stage.tgz", "npm pkg set name=kit"]);
  });

  it("given a test release, when its jobs are built, then it publishes at once", () => {
    const { context, shell } = setUp();
    const jobs = npmPackageRegistry({ staged: true })
      .create({ root: context.release.root, shell })
      .jobs({
        flow: TEST_FLOW,
        unit: kitWith(),
        tag: "kit@0.2.0",
        environment: "preview",
        commit: "head-1",
        defaultBranch: "main",
        options: { access: "public", tag: "latest" },
        distTag: "beta",
      });

    expect(jobs.map(({ local }) => local[0]?.args[0])).toEqual(["publish"]);
  });
});

describe("what staging asks of a runner", () => {
  it("given staged, when its requirements are read, then the runner may mint an OIDC token", () => {
    expect(npmPackageRegistry({ staged: true }).requirements?.(kitWith())).toMatchObject([
      { permissions: { "id-token": "write" } },
    ]);
  });

  it("given no option, when its requirements are read, then it asks no permission", () => {
    expect(npmPackageRegistry().requirements?.(kitWith())[0]?.permissions).toBeUndefined();
  });

  it("given a shiplane.yml naming staged, when its adapter is made, then it keeps the option", () => {
    const [entry] = catalog;

    expect(entry?.make({ staged: true }, {})).toMatchObject({ options: { staged: true } });
  });
});
