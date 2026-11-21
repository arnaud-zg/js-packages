import fs from "node:fs";
import path from "node:path";
import type { ConsumerRepository } from "shiplane/testing";
import { afterEach, describe, expect, it } from "vitest";

import { exampleRepository, installedRepository, REPOSITORY_ROOT } from "../examples";

// This repository's own config, as a shiplane.yml: the same flow, the notes templates by name.
const OWN_YAML = `flow:
  sourceControl: git
  codeHost: github
  ciPipeline: github-actions
  versioning:
    use: changesets
    with:
      line: whatsChanged
      thanks: none
modules:
  - use: published-package
    with:
      packageRegistry: npm
`;

const read = (file: string) => fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");

let repositories: ConsumerRepository[] = [];
afterEach(() => {
  repositories.forEach((repository) => repository.remove());
  repositories = [];
});

/** What `shiplane plugins --json` prints in a repository, and the code it exits with. */
const pluginsJson = (repository: ConsumerRepository) => {
  repositories.push(repository);
  const run = repository.shiplane(["plugins", "--json"]);
  return {
    status: run.status,
    json: run.status === 0 ? (JSON.parse(run.output) as unknown) : run.output,
  };
};

/** examples/repository, its shiplane.config.ts swapped for these files. */
const example = (config: Record<string, string>) => {
  const repository = exampleRepository("packages/shiplane/examples/repository", { files: config });
  if ("shiplane.yml" in config) {
    fs.rmSync(path.join(repository.root, "shiplane.config.ts"));
    repository.commitAndPush("config in YAML");
  }
  return repository;
};

const OWN_FILES = {
  "package.json": JSON.stringify({ name: "own", private: true, workspaces: ["packages/*"] }),
  "packages/tool/package.json": JSON.stringify({ name: "@acme/tool", version: "1.0.0" }),
  "packages/tool/shiplane.unit.yml": "module: published-package\n",
};

describe("a shiplane.yml composes what its shiplane.config.ts composes", () => {
  it("given examples/repository in TypeScript and in YAML, when plugins --json runs on each, then both print the same", () => {
    const fromTs = pluginsJson(example({}));
    const fromYaml = pluginsJson(
      example({ "shiplane.yml": read("packages/shiplane/examples/shiplane.yml") }),
    );

    expect(fromTs.json).toMatchObject({ flow: { sourceControl: "git", versioning: "commits" } });
    expect(fromYaml).toEqual(fromTs);
  });

  it("given this repository's own config in TypeScript and in YAML, when plugins --json runs on each, then both print the same", () => {
    const fromTs = pluginsJson(
      installedRepository({ ...OWN_FILES, "shiplane.config.ts": read("shiplane.config.ts") }),
    );
    const fromYaml = pluginsJson(installedRepository({ ...OWN_FILES, "shiplane.yml": OWN_YAML }));

    expect(fromTs.json).toMatchObject({ modules: [{ kind: "published-package", apps: ["tool"] }] });
    expect(fromYaml).toEqual(fromTs);
  });
});
