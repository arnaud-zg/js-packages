import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeFiles } from "../../adapters/files/node-files.adapter";
import { packageJsonManifest } from "../../adapters/manifest/package-json-manifest.adapter";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "shiplane-adapters-disk-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("reading and writing the repository's files", () => {
  it("given a file written in a folder that does not exist yet, when it is read back, then it is there with its text", () => {
    const files = nodeFiles(root);

    files.write("apps/api/shiplane.unit.yml", "module: server\n");

    expect(files.exists("apps/api/shiplane.unit.yml")).toBe(true);
    expect(files.read("apps/api/shiplane.unit.yml")).toBe("module: server\n");
    expect(fs.readFileSync(path.join(root, "apps/api/shiplane.unit.yml"), "utf8")).toBe(
      "module: server\n",
    );
  });

  it("given a file that is not there, when it is read, then nothing comes back and nothing throws", () => {
    const files = nodeFiles(root);

    expect(files.exists("missing.md")).toBe(false);
    expect(files.read("missing.md")).toBeNull();
    expect(files.list("missing")).toEqual([]);
    expect(files.folders("missing")).toEqual([]);
  });

  it("given a file removed, when it is looked for, then it is gone, and removing it again does not throw", () => {
    const files = nodeFiles(root);
    files.write("notes.md", "notes\n");

    files.remove("notes.md");
    files.remove("notes.md");

    expect(files.exists("notes.md")).toBe(false);
    expect(files.read("notes.md")).toBeNull();
  });

  it("given a folder holding files and folders, when it is listed, then every entry is named but only folders count as folders", () => {
    const files = nodeFiles(root);
    files.write("apps/README.md", "apps\n");
    files.write("apps/api/package.json", "{}");
    files.write("apps/web/package.json", "{}");

    expect([...files.list("apps")].sort()).toEqual(["README.md", "api", "web"]);
    expect([...files.folders("apps")].sort()).toEqual(["api", "web"]);
  });
});

describe("finding a package's version to release in its package.json", () => {
  const writeManifest = (dir: string, manifest: unknown) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, "package.json"), JSON.stringify(manifest));
  };

  it("given a package with a name and a version, when its manifest is read, then both come back", () => {
    writeManifest("packages/core", { name: "@acme/core", version: "1.2.3" });

    expect(packageJsonManifest.read(root, "packages/core")).toMatchObject({
      name: "@acme/core",
      version: "1.2.3",
    });
  });

  it("given a folder without a package.json, when it is read, then there is no package to release", () => {
    fs.mkdirSync(path.join(root, "packages/empty"), { recursive: true });

    expect(packageJsonManifest.read(root, "packages/empty")).toBeNull();
  });

  it("given a manifest without a version, when it is read, then it is not a package to release", () => {
    writeManifest("packages/private", { name: "@acme/private" });

    expect(packageJsonManifest.read(root, "packages/private")).toBeNull();
  });
});
