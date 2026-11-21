import fs from "node:fs";
import path from "node:path";
import type { ConsumerRepository } from "shiplane/testing";
import { format, resolveConfig } from "prettier";
import { afterEach, describe, expect, it } from "vitest";

import { configReference } from "../configReference";
import { installedRepository, REPOSITORY_ROOT } from "../examples";

// The schema SchemaStore serves for every shiplane.yml: shiplane's own catalog and every
// first-party plugin's, and the reference page rendered from it. After a catalog changes,
// `SHIPLANE_WRITE_SCHEMA=1 pnpm --filter shiplane-integration test` writes both again.
const PUBLISHED = path.join(REPOSITORY_ROOT, "packages/shiplane/shiplane.schema.json");
const REFERENCE = path.join(REPOSITORY_ROOT, "docs/shiplane/reference-yaml.md");
const WRITE = process.env.SHIPLANE_WRITE_SCHEMA === "1";

let repository: ConsumerRepository | undefined;
afterEach(() => repository?.remove());

describe("the schema published for shiplane.yml", () => {
  it("given every first-party plugin installed, when shiplane schema runs, then it writes the schema the package publishes", () => {
    repository = installedRepository({
      "package.json": JSON.stringify({ name: "acme", private: true }),
    });

    const run = repository.shiplane(["schema"]);
    const written = repository.read("node_modules/.cache/shiplane/shiplane.schema.json");
    if (WRITE) fs.writeFileSync(PUBLISHED, written);

    expect(run.status).toBe(0);
    expect(written).toBe(fs.readFileSync(PUBLISHED, "utf8"));
  });

  it("given the published schema, when its reference page is rendered, then it is the page the docs hold", async () => {
    const page = await format(configReference(JSON.parse(fs.readFileSync(PUBLISHED, "utf8"))), {
      ...(await resolveConfig(REFERENCE)),
      filepath: REFERENCE,
    });
    if (WRITE) fs.writeFileSync(REFERENCE, page);

    expect(page).toBe(fs.readFileSync(REFERENCE, "utf8"));
  });
});
