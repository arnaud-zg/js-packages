import type { CatalogEntry } from "shiplane/plugin";
import { catalog as changesets } from "@shiplane/changesets";
import { catalog as cloudflarePages } from "@shiplane/cloudflare-pages";
import { catalog as eas } from "@shiplane/eas";
import { catalog as fly } from "@shiplane/fly";
import { catalog as git } from "@shiplane/git";
import { catalog as github } from "@shiplane/github";
import { catalog as npm } from "@shiplane/npm";
import { releaseFlow } from "shiplane";
import { ciPipelineFake, codeHostFake, sourceControlFake, versioningFake } from "shiplane/testing";
import { describe, expect, it } from "vitest";

const PLUGINS: Record<string, readonly CatalogEntry[]> = {
  changesets,
  "cloudflare-pages": cloudflarePages,
  eas,
  fly,
  git,
  github,
  npm,
};

const flowless = { flow: null };
const adapters = Object.values(PLUGINS)
  .flat()
  .filter(({ kind }) => kind === "adapter");

describe("every first-party plugin's catalog", () => {
  it("given each plugin, when its catalog is read, then it names each adapter on the port it fills", () => {
    const named = Object.fromEntries(
      Object.entries(PLUGINS).map(([plugin, entries]) => [
        plugin,
        entries.map(({ kind, name, port }) => `${kind} ${name}${port ? ` → ${port}` : ""}`),
      ]),
    );

    expect(named).toEqual({
      changesets: ["adapter changesets → versioning", "adapter commits → versioning"],
      "cloudflare-pages": ["adapter cloudflare-pages → staticHosting"],
      eas: ["adapter eas → mobileDistribution"],
      fly: ["adapter fly → serverHosting"],
      git: ["adapter git → sourceControl"],
      github: [
        "adapter github → codeHost",
        "adapter github-actions → ciPipeline",
        "feature release-comments",
      ],
      npm: ["adapter npm → packageRegistry"],
    });
  });

  it.each(adapters.map((entry) => [entry.name, entry] as const))(
    "given the %s entry and no options, when it is made, then it makes the adapter its factory makes",
    (name, entry) => {
      expect(entry.make({}, {}, flowless)).toMatchObject({ name });
    },
  );

  it("given an option of the wrong type, when the git entry is made, then it refuses, naming the option", () => {
    const entry = git[0];

    expect(() => entry?.make({ main: 3 }, {}, flowless)).toThrow(/main/);
  });

  it("given release comments with no slot filled, when the entry is made, then it comments through the flow's code host", () => {
    const flow = releaseFlow({
      sourceControl: sourceControlFake(),
      codeHost: codeHostFake(),
      ciPipeline: ciPipelineFake(),
      versioning: versioningFake(),
    });
    const entry = github.find(({ name }) => name === "release-comments");

    const feature = entry?.make({ apps: ["api"] }, {}, { flow });

    expect(feature).toMatchObject({
      type: "feature",
      name: "release-comments",
      adapters: [flow.codeHost, flow.sourceControl],
    });
  });

  it("given release comments with no slot filled and no flow, when the entry is made, then it says what it needs", () => {
    const entry = github.find(({ name }) => name === "release-comments");

    expect(() => entry?.make({}, {}, flowless)).toThrow("needs a codeHost and a sourceControl");
  });
});
