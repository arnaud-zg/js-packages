import { describe, expect, it } from "vitest";

import { TEST_FLOW } from "../../testing/flow";
import { deployRunTitle, deployState, deployVia, needsPath, shipsFrom, webShip } from "../deploys";

describe("shipping the web apps", () => {
  it("given api@0.0.2 deployed to staging, when its run is named, then the runs list says which version went where", () => {
    expect(deployRunTitle("api@0.0.2", "staging")).toBe("Deploy api@0.0.2 to staging");
  });

  it("given a tagged version never deployed, when shipping to staging, then it deploys", () => {
    expect(
      webShip({ flow: TEST_FLOW, environment: "staging", run: "none", onPrevious: false }),
    ).toBe("deploy");
  });

  it("given its deploy waiting on the approval gate, when resumed, then it is deploying, not deployed twice", () => {
    expect(
      webShip({ flow: TEST_FLOW, environment: "staging", run: "running", onPrevious: false }),
    ).toBe("deploying");
  });

  it("given its deploy finished, when resumed, then it is shipped", () => {
    expect(
      webShip({ flow: TEST_FLOW, environment: "staging", run: "done", onPrevious: true }),
    ).toBe("shipped");
  });

  it("given a version staging never got, when shipping to prod, then it waits for staging first", () => {
    expect(webShip({ flow: TEST_FLOW, environment: "prod", run: "none", onPrevious: false })).toBe(
      "not-on-previous",
    );
  });

  it("given a version staging has, when shipping to prod, then it deploys", () => {
    expect(webShip({ flow: TEST_FLOW, environment: "prod", run: "none", onPrevious: true })).toBe(
      "deploy",
    );
  });

  it("given a deployment that succeeded, when read, then the version is deployed", () => {
    expect(deployState(["SUCCESS"])).toBe("done");
  });

  it("given a later deploy to the same environment superseded it, when read, then it still counts as deployed", () => {
    expect(deployState(["INACTIVE"])).toBe("done");
  });

  it("given a deploy waiting on the approval gate, when read, then it is running", () => {
    expect(deployState(["WAITING"])).toBe("running");
  });

  it("given two failed attempts then a success, when read, then the version is deployed", () => {
    expect(deployState(["FAILURE", "FAILURE", "SUCCESS"])).toBe("done");
  });

  it("given only failed attempts, when read, then nothing is deployed and it is offered again", () => {
    expect(deployState(["FAILURE", "ERROR"])).toBe("none");
  });
});

describe("how a release deploys", () => {
  const API = { app: "api" as const, tag: "api@0.0.3", kind: "deploy" as const };
  const BUILD = { app: "expo" as const, tag: "expo@0.1.116", kind: "build" as const };

  it("given --via local, when deploying, then it runs from this machine without asking", () => {
    expect(deployVia({ via: "local", yes: false })).toBe("local");
  });

  it("given --yes and no --via, when deploying, then the CI pipeline runs it, behind its gate", () => {
    expect(deployVia({ via: undefined, yes: true })).toBe("ci");
  });

  it("given neither, when deploying, then the person is asked", () => {
    expect(deployVia({ via: undefined, yes: false })).toBeNull();
  });

  it("given only an Store build ships, when deploying, then no path is asked: Store builds it either way", () => {
    expect(needsPath([BUILD])).toBe(false);
  });

  it("given a web app ships, when deploying, then the path is asked", () => {
    expect(needsPath([BUILD, API])).toBe(true);
  });

  it("given main moved past the tag, when deploying from this machine, then it refuses: it would ship code no release named", () => {
    expect(shipsFrom("local", { sinceTagOnlyVersionFiles: false })).toBe(false);
  });

  it("given main moved past the tag, when the CI pipeline deploys, then it ships the tag itself", () => {
    expect(shipsFrom("ci", { sinceTagOnlyVersionFiles: false })).toBe(true);
  });

  it("given main still holds the tagged code, when deploying from this machine, then it ships", () => {
    expect(shipsFrom("local", { sinceTagOnlyVersionFiles: true })).toBe(true);
  });
});
