import fs from "fs";
import os from "os";
import path from "path";
import { dump } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCatalogWorkspaceFile } from "../catalogWorkspace.adapter";
import { aWorkspaceYaml } from "./builders";

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "expo-pnpm-catalog-workspace-test-"));
  filePath = path.join(tmpDir, "pnpm-workspace.yaml");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("reading and saving pnpm-workspace.yaml on disk", () => {
  describe("given the yaml contains comments alongside package entries", () => {
    it("when a version is updated and saved, then comments survive", () => {
      fs.writeFileSync(
        filePath,
        ["catalogs:", "  expo:", "    # managed", '    expo-camera: "~17.0.8"'].join("\n"),
      );
      const file = createCatalogWorkspaceFile(filePath);

      file.save(file.load().writeVersion("expo-camera", "~17.0.10"));

      const updated = fs.readFileSync(filePath, "utf-8");
      expect(updated).toContain("# managed");
      expect(updated).toContain('"~17.0.10"');
    });
  });

  describe("given a version is updated in memory but not saved", () => {
    it("when not saved, then the file on disk is unchanged", () => {
      fs.writeFileSync(filePath, dump(aWorkspaceYaml().build()));
      const original = fs.readFileSync(filePath, "utf-8");

      createCatalogWorkspaceFile(filePath).load().writeVersion("expo-camera", "~17.0.99");

      expect(fs.readFileSync(filePath, "utf-8")).toBe(original);
    });
  });

  describe("given the file has the wrong shape", () => {
    it("when loaded, then the error names its path", () => {
      fs.writeFileSync(filePath, "catalogs: [expo]\n");

      expect(() => createCatalogWorkspaceFile(filePath).load()).toThrow(filePath);
    });
  });
});
