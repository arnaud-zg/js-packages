import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createWorkspace } from "../../testing/workspace";
import { coreDir, installedVersion } from "../installed";

const PACKAGE = path.resolve(import.meta.dirname, "../../..");
const OWN = JSON.parse(fs.readFileSync(path.join(PACKAGE, "package.json"), "utf8")) as {
  version: string;
};

describe("knowing which shiplane runs", () => {
  it("given shiplane's own code, when its version is read, then it is the one its package.json says", () => {
    expect(installedVersion()).toBe(OWN.version);
  });

  it("given a folder deep inside shiplane, when its package is found, then it is shiplane's folder", () => {
    expect(coreDir(path.join(PACKAGE, "src", "cli"))).toBe(PACKAGE);
  });

  it("given folders whose package.json is another package's, when shiplane is looked for, then they are passed over", () => {
    const workspace = createWorkspace({
      "node_modules/shiplane/package.json": JSON.stringify({ name: "shiplane", version: "9.9.9" }),
      "node_modules/shiplane/dist/package.json": JSON.stringify({ name: "other" }),
    });
    try {
      const dist = path.join(workspace.root, "node_modules/shiplane/dist");

      expect(coreDir(dist)).toBe(path.join(workspace.root, "node_modules/shiplane"));
      expect(installedVersion(dist)).toBe("9.9.9");
    } finally {
      workspace.remove();
    }
  });

  it("given a folder outside any shiplane, when shiplane is looked for, then it says where it looked", () => {
    expect(() => coreDir("/")).toThrow("shiplane not found above /");
  });
});
