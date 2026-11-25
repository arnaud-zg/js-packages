import { describe, expect, it } from "vitest";

import { MemoryFiles } from "../../adapters/files/__fakes__/memory-files.fake";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { moduleFor } from "../../modules/suggest";
import { TEST_FLOW } from "../../testing/flow";
import {
  folderView,
  refreshEditorSchema,
  releasePackage,
  repositoryName,
  SCHEMA_FILE,
  schemaText,
} from "../setupFiles";

// What setup reads from and writes to the repository, on in-memory files: nothing on disk changes.

const cloud = () => ({ ...serverHostingFake(), name: "cloud" });

describe("Feature: setup reading the repository it sets up", () => {
  it("given an app folder with a cloud.toml, when adapters look at it to guess how it ships, then they see its name, its files and what they hold", () => {
    const files = new MemoryFiles({ "apps/api/cloud.toml": "app = 1", "apps/api/src/a.ts": "" });

    const view = folderView(files, "apps/api");

    expect(view.dir).toBe("apps/api");
    expect(view.name).toBe("api");
    expect(view.files).toEqual(expect.arrayContaining(["cloud.toml"]));
    expect(view.has("cloud.toml")).toBe(true);
    expect(view.has("pages.toml")).toBe(false);
    expect(view.read("cloud.toml")).toBe("app = 1");
  });

  it("given a scoped root package or none named, when setup names the repository, then it drops the scope or falls back to the folder, and the config imports the CLI as shiplane", () => {
    const installed = new MemoryFiles({
      "package.json": JSON.stringify({
        name: "@acme/mono",
        devDependencies: { shiplane: "^1.0.0" },
      }),
    });
    const unnamed = new MemoryFiles({ "package.json": "{}" });

    expect(repositoryName(installed, "/x/y")).toBe("mono");
    expect(repositoryName(unnamed, "/x/folder")).toBe("folder");
    expect(releasePackage(installed)).toBe("shiplane");
    expect(releasePackage(new MemoryFiles())).toBe("shiplane");
  });
});

describe("Feature: editor help while filling unit files", () => {
  it("given an editor schema out of date, when setup refreshes it twice, then it is written once and left alone the second time", () => {
    const files = new MemoryFiles();
    const release = {
      appFlow: TEST_FLOW,
      modules: [moduleFor(cloud(), "backend-service")],
    } as Parameters<typeof refreshEditorSchema>[1];

    expect(refreshEditorSchema(files, release)).toBe(true);
    expect(files.read(SCHEMA_FILE)).toBe(schemaText(release.modules, TEST_FLOW.path));
    expect(schemaText(release.modules, TEST_FLOW.path).endsWith("}\n")).toBe(true);
    expect(refreshEditorSchema(files, release)).toBe(false);
    expect(files.changes).toHaveLength(1);
  });
});
