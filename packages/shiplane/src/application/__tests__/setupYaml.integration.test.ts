import { describe, expect, it } from "vitest";

import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { detecting, memoryRepository } from "../../testing/memoryRepository";
import { setup } from "../setup";
import { addToYamlConfig } from "../setupYaml";

const cloud = () =>
  detecting(serverHostingFake(), "cloud", "cloud.toml", (folder) => ({ service: folder.name }));

const manifest = (name: string) =>
  JSON.stringify({ name, version: "0.1.0", scripts: { build: "tsc" } });

/** A repository whose git, GitHub, Actions and Changesets are all proven, one app on Cloud. */
const PROVEN = {
  "package.json": JSON.stringify({ name: "acme", private: true }),
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  ".git/HEAD": "ref: refs/heads/main\n",
  ".github/workflows/ci.yml": "on: push\n",
  ".changeset/config.json": "{}\n",
  "apps/api/package.json": manifest("@acme/api"),
  "apps/api/cloud.toml": 'app = "acme-api"\n',
};

const given = (files: Record<string, string>) => {
  const repo = memoryRepository(files, [cloud()]);
  repo.shell.seed("git remote get-url origin", { stdout: "git@github.com:acme/mono.git\n" });
  return repo;
};

const YAML = `# Ours: keep this line.
flow:
  sourceControl: git
  codeHost: github
  ciPipeline: github-actions
  versioning: changesets
modules:
  - internal-tool
`;

describe("Feature: setting up with a YAML config", () => {
  it("given a new repository, when setup runs with --format yaml, then it writes shiplane.yml and no shiplane.config.ts", async () => {
    const { context, prompter, files } = given(PROVEN);
    prompter.answer(true, true);

    expect(await setup(context, { yes: false, format: "yaml" })).toBe(true);

    expect(files.exists("shiplane.config.ts")).toBe(false);
    expect(files.read("shiplane.yml"))
      .toBe(`# yaml-language-server: $schema=node_modules/.cache/shiplane/shiplane.schema.json
# How this repository releases. Your editor completes every key from the schema above.
flow:
  sourceControl: git
  codeHost: github
  ciPipeline: github-actions
  versioning: changesets
# What gets released, in this order. The first app is the repository's Latest release.
modules:
  - use: backend-service
    with:
      serverHosting: cloud
`);
  });

  it("given a shiplane.yml, when setup runs again, then it keeps shiplane.yml and writes no TS config", async () => {
    const { context, prompter, files } = given({ ...PROVEN, "shiplane.yml": YAML });
    prompter.answer(true, true);

    expect(await setup(context, { yes: false })).toBe(true);

    expect(files.exists("shiplane.config.ts")).toBe(false);
    expect(files.exists("apps/api/shiplane.unit.yml")).toBe(true);
  });

  it("given a shiplane.yml with comments, when a module is added to it, then it joins the list and the comments stay", () => {
    const added = addToYamlConfig(YAML, {
      factory: "webApp",
      port: "staticHosting",
      adapter: "pagesStaticHosting",
      name: "site",
      from: "@shiplane/pages",
    });

    expect(added).toBe(`${YAML}  - use: web-app
    with:
      name: site
      staticHosting: pages
`);
  });

  it("given a shiplane.yml with no modules list, when a module is added to it, then it says it cannot", () => {
    expect(
      addToYamlConfig("flow: {}\n", {
        factory: "webApp",
        port: "staticHosting",
        adapter: "x",
        from: "@shiplane/x",
      }),
    ).toBeNull();
  });

  it("given a shiplane.config.ts, when setup runs with --format yaml, then the config in place keeps its format", async () => {
    const { context, files, prompter } = given({
      ...PROVEN,
      "shiplane.config.ts": "export default {};\n",
    });
    prompter.answer(true, true);

    await setup(context, { yes: false, format: "yaml" });

    expect(files.exists("shiplane.yml")).toBe(false);
  });
});
