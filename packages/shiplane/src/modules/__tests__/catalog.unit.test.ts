import { describe, expect, it } from "vitest";

import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { catalog } from "../catalog";

const entry = (name: string) => {
  const found = catalog.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no ${name} in the catalog`);
  return found;
};

const flowless = { flow: null };

describe("shiplane's own catalog", () => {
  it("given every module a config writes by hand, when the catalog lists them, then each one is there by its kind", () => {
    expect(catalog.filter(({ kind }) => kind === "module").map(({ name }) => name)).toEqual([
      "backend-service",
      "web-app",
      "mobile-app",
      "published-package",
      "internal-tool",
      "agent-plugin",
    ]);
  });

  it("given a backend service named in with, when the catalog makes it, then it ships with the adapter its slot holds", () => {
    const module = entry("backend-service").make(
      { name: "api-eu" },
      { serverHosting: serverHostingFake() },
      flowless,
    );

    expect(module).toMatchObject({ type: "module", name: "api-eu", kind: "backend-service" });
  });

  it("given a slot holding an adapter of another delivery, when the catalog makes the module, then it says which delivery the slot needs", () => {
    const make = () =>
      entry("backend-service").make({}, { serverHosting: staticHostingFake() }, flowless);

    expect(make).toThrow("its adapter does not do server-hosting");
  });

  it("given an option of the wrong type, when the catalog makes the module, then it refuses before making anything", () => {
    const make = () => entry("internal-tool").make({ name: 3 }, {}, flowless);

    expect(make).toThrow(/name/);
  });

  it("given the built-in shell adapter, when the catalog makes it, then it fills server hosting", () => {
    const shell = entry("shell");

    expect(shell.port).toBe("serverHosting");
    expect(shell.make({}, {}, flowless)).toMatchObject({
      name: "shell",
      capability: "server-hosting",
    });
  });
});
