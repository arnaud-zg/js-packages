import { describe, expect, it } from "vitest";

import { PackageJsonSchema, parseOrThrow, WorkspaceYamlSchema } from "../schemas";

describe("validating pnpm-workspace.yaml", () => {
  describe("given a catalog version is written as a bare number", () => {
    it("when parsed, then the version is read as a string", () => {
      const parsed = parseOrThrow({
        schema: WorkspaceYamlSchema,
        value: { catalog: { react: 19 } },
        source: "pnpm-workspace.yaml",
      });

      expect(parsed.catalog?.react).toBe("19");
    });
  });

  describe("given catalogs is not a map of catalogs", () => {
    it("when parsed, then it throws an error naming the file and the bad field", () => {
      const parse = () =>
        parseOrThrow({
          schema: WorkspaceYamlSchema,
          value: { catalogs: ["expo"] },
          source: "/repo/pnpm-workspace.yaml",
        });

      expect(parse).toThrow(/\/repo\/pnpm-workspace\.yaml is malformed/);
      expect(parse).toThrow(/catalogs/);
    });
  });
});

describe("validating package.json", () => {
  describe("given fields the tool does not read", () => {
    it("when parsed, then they are kept", () => {
      const parsed = parseOrThrow({
        schema: PackageJsonSchema,
        value: { name: "@/app", scripts: { start: "expo start" } },
        source: "package.json",
      });

      expect(parsed.scripts).toEqual({ start: "expo start" });
    });
  });

  describe("given dependencies is not a map of versions", () => {
    it("when parsed, then it throws an error naming the file and the bad field", () => {
      const parse = () =>
        parseOrThrow({
          schema: PackageJsonSchema,
          value: { dependencies: 5 },
          source: "/repo/apps/expo/package.json",
        });

      expect(parse).toThrow(/\/repo\/apps\/expo\/package\.json is malformed/);
      expect(parse).toThrow(/dependencies/);
    });
  });
});
