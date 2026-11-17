import { describe, expect, it } from "vitest";

import { choosesPath, forcedPath, routeChoice, shipRuns } from "../shipRoute";

const onCi = { ci: { ref: "api@1.0.0" } };
const hereOnly = {};

describe("which way a unit ships", () => {
  it("given a web deploy, when routed, then the person may choose its path", () => {
    expect(choosesPath({ kind: "deploy", jobs: [hereOnly] })).toBe(true);
  });

  it("given a build a workflow can start, when routed, then the person may choose its path", () => {
    expect(choosesPath({ kind: "build", jobs: [onCi] })).toBe(true);
  });

  it("given a build only this machine can start, when routed, then it runs on its own platform", () => {
    expect(choosesPath({ kind: "build", jobs: [onCi, hereOnly] })).toBe(false);
  });

  it("given a package to publish, when routed, then nobody chooses a path", () => {
    expect(choosesPath({ kind: "publish", jobs: [onCi] })).toBe(false);
  });

  it("given a run on a CI runner, when forcing a path, then this runner ships whatever --via says", () => {
    expect(forcedPath({ ci: true, via: "ci" })).toBe("local");
  });

  it("given a run on a laptop, when forcing a path, then --via decides", () => {
    expect(forcedPath({ ci: false, via: "ci" })).toBe("ci");
    expect(forcedPath({ ci: false, via: undefined })).toBeUndefined();
  });

  it("given both paths open, when choosing a route, then the person is asked", () => {
    expect(routeChoice({ ci: null, local: null })).toEqual({ route: "ask" });
  });

  it("given GitHub blocked, when choosing a route, then it ships from this machine and says why", () => {
    expect(routeChoice({ ci: "no ship.yml", local: null })).toEqual({
      route: "local",
      blocked: "no ship.yml",
    });
  });

  it("given this machine blocked, when choosing a route, then it ships through GitHub and says why", () => {
    expect(routeChoice({ ci: null, local: "main moved past it" })).toEqual({
      route: "ci",
      blocked: "main moved past it",
    });
  });

  it("given both paths blocked, when choosing a route, then nothing can ship it", () => {
    expect(routeChoice({ ci: "no ship.yml", local: "main moved past it" })).toEqual({
      route: "stuck",
    });
  });
});

describe("the ship workflow's runs", () => {
  it("given two tags on one commit, when grouped, then one run ships both from the first tag", () => {
    expect(
      shipRuns([
        { unit: "api", ref: "api@1.0.0", commit: "abc" },
        { unit: "web", ref: "web@2.0.0", commit: "abc" },
      ]),
    ).toEqual([{ ref: "api@1.0.0", units: ["api", "web"] }]);
  });

  it("given tags on two commits, when grouped, then each commit gets its own run", () => {
    expect(
      shipRuns([
        { unit: "api", ref: "api@1.0.0", commit: "abc" },
        { unit: "web", ref: "web@2.0.0", commit: "def" },
      ]),
    ).toEqual([
      { ref: "api@1.0.0", units: ["api"] },
      { ref: "web@2.0.0", units: ["web"] },
    ]);
  });

  it("given a unit with two jobs on main, when grouped, then main runs once and names it once", () => {
    expect(
      shipRuns([
        { unit: "app", ref: "main", commit: null },
        { unit: "app", ref: "main", commit: null },
      ]),
    ).toEqual([{ ref: "main", units: ["app"] }]);
  });
});
