import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { CatalogEntry } from "../../../ports/catalog.port";
import { ciPipelineFake } from "../../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { codeHostFake } from "../../../adapters/code-host/__fakes__/code-host.fake";
import { serverHostingFake } from "../../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { sourceControlFake } from "../../../adapters/source-control/__fakes__/source-control.fake";
import { versioningFake } from "../../../adapters/versioning/__fakes__/versioning.fake";
import { catalog as ownCatalog } from "../../../modules/catalog";
import { ConfigError } from "../../../ports/config.port";
import { adapterEntry, featureEntry } from "../catalog";
import { yamlDeclaration } from "../yamlDeclaration";

const CATALOG: readonly CatalogEntry[] = [
  ...ownCatalog,
  adapterEntry({
    name: "git",
    port: "sourceControl",
    description: "",
    options: z.object({ main: z.string().optional() }),
    make: () => sourceControlFake(),
  }),
  adapterEntry({
    name: "github",
    port: "codeHost",
    description: "",
    options: z.object({}),
    make: () => codeHostFake(),
  }),
  adapterEntry({
    name: "actions",
    port: "ciPipeline",
    description: "",
    options: z.object({}),
    make: () => ciPipelineFake(),
  }),
  adapterEntry({
    name: "commits",
    port: "versioning",
    description: "",
    options: z.object({}),
    make: () => versioningFake(),
  }),
  adapterEntry({
    name: "fly",
    port: "serverHosting",
    description: "",
    options: z.object({}),
    make: () => serverHostingFake(),
  }),
  featureEntry({
    name: "notes",
    description: "",
    options: z.object({}),
    slots: { codeHost: { port: "codeHost" } },
    make: (_options, slots) => ({
      type: "feature",
      name: "notes",
      adapters: [slots.codeHost].flatMap((adapter) => (adapter ? [adapter] : [])),
      afterShip: () => Promise.resolve([]),
    }),
  }),
];

const FLOW = {
  sourceControl: "git",
  codeHost: "github",
  ciPipeline: "actions",
  versioning: "commits",
};

const problem = (document: unknown) => {
  try {
    yamlDeclaration(document, CATALOG);
  } catch (error) {
    if (error instanceof ConfigError)
      return { message: error.message, path: error.path, hint: error.hint };
    throw error;
  }
  return null;
};

describe("a shiplane.yml made into a release declaration", () => {
  it("given each slot as a short name or as use and with, when it is declared, then both make the adapter the catalog names", () => {
    const declared = yamlDeclaration(
      {
        flow: { ...FLOW, sourceControl: { use: "git", with: { main: "develop" } } },
        modules: ["internal-tool"],
      },
      CATALOG,
    );

    expect(declared).toMatchObject({
      flow: { type: "flow", sourceControl: { name: "fake" }, approval: "none" },
      modules: [{ type: "module", name: "internal-tool" }],
    });
  });

  it("given a feature that leaves its code host out, when it is declared, then it takes the flow's", () => {
    const declared = yamlDeclaration({ flow: FLOW, modules: [], features: ["notes"] }, CATALOG);

    expect(declared.features).toEqual([
      expect.objectContaining({ adapters: [expect.objectContaining({ name: "fake" })] }),
    ]);
  });

  it("given a module without the adapter it ships with, when it is declared, then it says which slot to fill", () => {
    expect(problem({ flow: FLOW, modules: ["backend-service"] })).toEqual({
      message: "backend-service needs serverHosting: the serverHosting adapter it ships with",
      path: ["modules", 0, "with"],
      hint: "such as with: { serverHosting: <name> }",
    });
  });

  it("given an option of the wrong type, when it is declared, then the problem points at that option", () => {
    expect(
      problem({ flow: { ...FLOW, sourceControl: { use: "git", with: { main: 3 } } } }),
    ).toMatchObject({
      path: ["flow", "sourceControl", "with", "main"],
      message: expect.stringContaining("main:"),
    });
  });

  it("given a slot holding something besides a name or use with with, when it is declared, then it shows both shapes", () => {
    expect(problem({ flow: { ...FLOW, codeHost: { name: "github" } } })).toMatchObject({
      message: "codeHost is a name, or use: with with:",
      path: ["flow", "codeHost"],
    });
  });

  it("given no flow, when it is declared, then it shows a flow to write", () => {
    expect(problem({ modules: [] })).toMatchObject({
      message: "flow is missing: an adapter per port the release runs on",
    });
  });

  it("given a testRelease preset no one wrote, when it is declared, then it lists the presets", () => {
    expect(problem({ flow: FLOW, testRelease: "weekly" })).toMatchObject({
      message: 'no testRelease preset named "weekly"',
      hint: expect.stringContaining("gitflow"),
    });
  });
});
