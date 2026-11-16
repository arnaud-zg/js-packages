import { dump } from "js-yaml";
import { describe, expect, it } from "vitest";

import { CatalogWorkspace } from "../catalogWorkspace";
import { aWorkspaceYaml } from "./builders";

function workspaceOf(data: object): CatalogWorkspace {
  return CatalogWorkspace.fromText({ text: dump(data) });
}

describe("reading and updating catalog versions", () => {
  describe("given the workspace has both a root catalog and named catalogs", () => {
    it("when read, then all versions from every catalog section are available", () => {
      const workspace = workspaceOf(aWorkspaceYaml().build());

      expect(workspace.getAllCatalogVersions()).toEqual({
        "some-lib": "^3.0.0",
        "expo-camera": "~17.0.10",
        "@expo/vector-icons": "^15.0.3",
      });
    });

    it("when a package uses catalog:expo, then its concrete version is resolved", () => {
      const workspace = workspaceOf(aWorkspaceYaml().build());

      const resolved = workspace.resolveDeps({
        "expo-camera": "catalog:expo",
        "@expo/vector-icons": "catalog:expo",
      });

      expect(resolved["expo-camera"]).toBe("~17.0.10");
      expect(resolved["@expo/vector-icons"]).toBe("^15.0.3");
    });

    it("when a package uses the root catalog, then its concrete version is resolved", () => {
      const workspace = workspaceOf(aWorkspaceYaml().build());

      const resolved = workspace.resolveDeps({ "some-lib": "catalog:" });

      expect(resolved["some-lib"]).toBe("^3.0.0");
    });
  });

  describe("given the workspace has no catalog section", () => {
    it("when read, then no versions are available", () => {
      const workspace = workspaceOf({ packages: ["apps/*"] });

      expect(workspace.getAllCatalogVersions()).toEqual({});
    });
  });

  describe("given the yaml contains comments alongside package entries", () => {
    it("when a version is updated, then the text keeps the comments", () => {
      const text = [
        "catalogs:",
        "  expo:",
        "    # managed by expo-pnpm-catalog",
        '    expo-camera: "~17.0.8"',
      ].join("\n");

      const updated = CatalogWorkspace.fromText({ text })
        .writeVersion("expo-camera", "~17.0.10")
        .toText();

      expect(updated).toContain("# managed by expo-pnpm-catalog");
      expect(updated).toContain('"~17.0.10"');
      expect(updated).not.toContain('"~17.0.8"');
    });
  });

  describe("given a workspace is read and nothing changes", () => {
    it("when turned back into text, then the text is identical", () => {
      const text = "packages:\n  - apps/*\n# keep me\ncatalog:\n  some-lib: ^3.0.0\n";

      expect(CatalogWorkspace.fromText({ text }).toText()).toBe(text);
    });
  });

  describe("given the yaml is a bare value instead of a map", () => {
    it("when read, then it throws an error naming the file", () => {
      expect(() => CatalogWorkspace.fromText({ text: "null\n" })).toThrow(
        /pnpm-workspace\.yaml is malformed/,
      );
    });
  });

  describe("given the yaml has the wrong shape", () => {
    it("when read, then it throws an error naming the file", () => {
      expect(() =>
        CatalogWorkspace.fromText({
          text: "packages: apps/*\n",
          source: "/repo/pnpm-workspace.yaml",
        }),
      ).toThrow(/\/repo\/pnpm-workspace\.yaml is malformed/);
    });
  });
});

describe("deriving workspace directories from packages globs", () => {
  describe("given pnpm-workspace.yaml declares packages globs", () => {
    it("when read, then the top-level directory of each glob is returned", () => {
      const workspace = workspaceOf({ packages: ["apps/*", "packages/*", "tooling/*"] });

      expect(workspace.getWorkspaceDirs()).toEqual(
        expect.arrayContaining(["apps", "packages", "tooling"]),
      );
    });
  });

  describe("given pnpm-workspace.yaml declares no packages globs", () => {
    it("when read, then the default workspace directories are returned", () => {
      const workspace = workspaceOf({ catalog: {} });

      expect(workspace.getWorkspaceDirs()).toEqual(["apps", "packages", "tooling"]);
    });
  });
});
