import { describe, expect, it } from "vitest";

import { branchRelease } from "../branchRelease";
import { doctorCi } from "../doctorCi";
import { shipTo } from "../ship";
import { shipPackages } from "../shipPackages";
import {
  BRANCH,
  branchWorld,
  HEAD,
  kit,
  lib,
  LIB_MANIFEST,
  manifest,
  web,
} from "./releaseBranchWorld";

const ASK = "Where should 1.3.0-beta.0 publish from?";
const FILE = "ci/ship.yml";

const world = (options: { interactive?: boolean; offers?: string; pushed?: string } = {}) => {
  const made = branchWorld({ yes: false, interactive: options.interactive ?? true });
  made.source.seed({ files: { [`${BRANCH}:${FILE}`]: options.offers ?? "beta latest" } });
  Object.assign(made.source, { pushedHead: () => Promise.resolve(options.pushed ?? HEAD) });
  return made;
};

const beta = { onDefault: "publish", channel: "beta" } as const;

describe("Feature: choosing where a test release publishes from", () => {
  it("given no via, when the person picks CI, then the workflow runs on the branch and nothing publishes here", async () => {
    const { context, prompter, ci, shell } = world();
    prompter.answer("ci");

    expect(await branchRelease(context, beta)).toBe(true);

    expect(prompter.asked).toEqual([ASK]);
    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: BRANCH,
        inputs: { units: "lib", environment: "beta" },
      },
    ]);
    expect(shell.calls).toEqual([]);
  });

  it("given no via, when the person picks this machine, then it publishes here", async () => {
    const { context, prompter, ci, distTags } = world();
    prompter.answer("local");

    expect(await branchRelease(context, beta)).toBe(true);

    expect(ci.received).toEqual([]);
    expect(distTags).toEqual(["beta"]);
  });

  it("given the person cancels, when asked, then nothing runs", async () => {
    const { context, prompter, ci, distTags } = world();
    prompter.answer(null);

    expect(await branchRelease(context, beta)).toBe(true);

    expect(ci.received).toEqual([]);
    expect(distTags).toEqual([]);
  });

  it.each(["ci", "local"] as const)(
    "given via %s in the config, when it runs, then nothing is asked",
    async (via) => {
      const { context, prompter, ci } = world();

      await branchRelease({ ...context, release: { ...context.release, via } }, beta);

      expect(prompter.asked).toEqual([]);
      expect(ci.received).toHaveLength(via === "ci" ? 1 : 0);
    },
  );

  it.each([
    ["the workflow lacks the channel", { offers: "staging" }, "ship.yml does not offer beta"],
    ["the branch is not pushed", { pushed: "older" }, "is not pushed as it is here"],
  ])("given %s, when it runs, then it says so and publishes here", async (_, options, said) => {
    const { context, output, distTags } = world(options);

    expect(await branchRelease(context, beta)).toBe(true);

    expect(output.text).toContain(said);
    expect(distTags).toEqual(["beta"]);
  });

  it("given --via ci and CI cannot, when it runs, then nothing publishes", async () => {
    const { context, distTags } = world({ offers: "staging" });

    expect(await branchRelease(context, { ...beta, via: "ci" })).toBe(false);

    expect(distTags).toEqual([]);
  });

  it("given nobody to ask, when it runs, then it publishes from this machine", async () => {
    const { context, distTags } = world({ interactive: false });

    expect(await branchRelease(context, beta)).toBe(true);

    expect(distTags).toEqual(["beta"]);
  });
});

describe("Feature: naming the packages a test release publishes", () => {
  const two = () =>
    branchWorld({
      units: [lib, kit, web],
      pending: [
        { name: "@acme/lib", newVersion: "1.3.0" },
        { name: "@acme/ui-kit", newVersion: "0.5.0" },
      ],
      files: {
        "packages/lib/package.json": LIB_MANIFEST,
        "packages/kit/package.json": manifest({ name: "@acme/ui-kit", version: "0.4.0" }),
      },
    });

  it("given one named, when it runs, then only that one publishes", async () => {
    const { context, shell } = two();

    await branchRelease(context, { ...beta, units: ["kit"] });

    expect(shell.calls.map(({ args }) => args.join(" "))).toEqual([
      "publish @acme/ui-kit 0.5.0-beta.0",
    ]);
  });

  it.each(["web", "nope"])(
    "given %s, not a package, when it runs, then it refuses",
    async (name) => {
      const { context, output } = two();

      expect(await branchRelease(context, { ...beta, units: [name] })).toBe(false);

      expect(output.text).toContain(`Not a package: ${name}`);
    },
  );
});

describe("Feature: publishing released packages", () => {
  const released = () => {
    const made = world();
    made.source.seed({
      tags: { "lib@1.2.0": "head" },
      files: { [`main:${FILE}`]: "latest" },
    });
    return made;
  };

  it("given the person picks CI, when the release ships, then one run publishes to live from main", async () => {
    const { context, prompter, ci, shell } = released();
    prompter.answer("ci", true);

    expect(await shipTo(context, "staging", { scope: new Set(["lib"]) })).toBe(true);

    expect(ci.received).toMatchObject([
      { ref: "main", inputs: { units: "lib", environment: "latest" } },
    ]);
    expect(shell.calls).toEqual([]);
  });

  it("given a runner, when live ships, then packages publish, apps do not, and nothing is dispatched", async () => {
    const { context, ci, shell } = released();

    const done = await shipPackages({ ...context, options: { yes: true, ci: true } }, []);

    expect(done).toBe(true);
    expect(ci.received).toEqual([]);
    expect(shell.calls.map(({ args }) => args.join(" "))).toContain("publish @acme/lib 1.2.0");
  });

  it("given an app named, when live ships, then it refuses", async () => {
    const { context, output } = released();

    expect(await shipPackages(context, ["web"])).toBe(false);

    expect(output.text).toContain("Not a package: web");
  });

  it.each([
    ["latest", [], true],
    ["nightly", [], true],
    ["Not A Channel", [], false],
    ["beta", ["web"], false],
  ])(
    "given doctor --ci for %s with units %j, when it checks, then it passes: %s",
    async (channel, units, ok) => {
      const { context } = released();
      const setup = {
        ...context,
        root: "/repo",
        adapters: [],
        load: () => Promise.resolve(context.release),
      };

      expect(await doctorCi(setup, { units, channel })).toBe(ok);
    },
  );
});
