import { describe, expect, it } from "vitest";

import { parseSpecifier } from "../parseSpecifier";

describe("parseSpecifier", () => {
  it("given a bare scoped package, when parsed, then its subpath is '.'", () => {
    expect(parseSpecifier("@acme/tokens")).toEqual({
      packageName: "@acme/tokens",
      subpath: ".",
      deepSrcPath: null,
    });
  });

  it("given an unscoped package with a subpath, when parsed, then the subpath is an exports-map key", () => {
    expect(parseSpecifier("utils/math/add")).toEqual({
      packageName: "utils",
      subpath: "./math/add",
      deepSrcPath: null,
    });
  });

  it("given a deep src import, when parsed, then it names the path under src/", () => {
    expect(parseSpecifier("@acme/theme/src/config/colors")).toEqual({
      packageName: "@acme/theme",
      subpath: "./src/config/colors",
      deepSrcPath: "config/colors",
    });
  });

  it("given src/ with nothing after it, when parsed, then it is not a deep src import", () => {
    expect(parseSpecifier("@acme/theme/src/")?.deepSrcPath).toBeNull();
  });

  it("given an absolute or empty specifier, when parsed, then it names no package", () => {
    expect(parseSpecifier("/abs/path")).toBeNull();
    expect(parseSpecifier("")).toBeNull();
  });
});
