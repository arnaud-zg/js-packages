import { describe, expect, it } from "vitest";

import {
  channelFor,
  channelProblem,
  channels,
  nextNumber,
  sharedNumbers,
  testReleases,
  testTag,
  testVersion,
} from "../testChannel";

describe("the channel a branch's test release publishes on", () => {
  it("given no setting, when any branch is read, then it publishes a snapshot", () => {
    expect(channelFor("main")).toBe("snapshot");
    expect(channelFor("feat/x")).toBe("snapshot");
  });

  it("given a branch listed by name, when read, then it takes that channel", () => {
    expect(channelFor("main", testReleases.nightly)).toBe("nightly");
  });

  it("given a branch matching a pattern, when read, then it takes the pattern's channel", () => {
    expect(channelFor("release/1.2", testReleases.gitflow)).toBe("beta");
  });

  it("given a branch matching a pattern and its exact name, when read, then the exact name wins", () => {
    expect(channelFor("release/1.2", { "release/*": "beta", "release/1.2": "rc" })).toBe("rc");
  });

  it("given a branch matching two patterns, when read, then the longest pattern wins", () => {
    expect(channelFor("release/next/1", { "release/*": "beta", "release/next/*": "alpha" })).toBe(
      "alpha",
    );
  });

  it("given a branch no key names, when read, then it publishes a snapshot", () => {
    expect(channelFor("feat/x", testReleases.prerelease)).toBe("snapshot");
  });

  it("given a pattern's dot, when read, then it is a dot, not any character", () => {
    expect(channelFor("v1x0", { "v1.0": "rc" })).toBe("snapshot");
  });
});

describe("the presets", () => {
  it("given each preset, when read, then it is the map its documentation describes", () => {
    expect(testReleases).toEqual({
      nightly: { main: "nightly" },
      prerelease: { main: "nightly", next: "alpha", beta: "beta", "release/*": "rc" },
      gitflow: { develop: "nightly", "release/*": "beta", "hotfix/*": "rc" },
    });
  });

  it("given every channel a preset or the channels list names, when checked, then each is a valid name", () => {
    const names = [
      ...Object.values(channels),
      ...Object.values(testReleases).flatMap((map) => Object.values(map)),
    ];

    expect(names.map(channelProblem)).toEqual(names.map(() => null));
  });
});

describe("a channel's name", () => {
  it("given latest, when checked, then it is refused: it belongs to the real release", () => {
    expect(channelProblem("latest")).toContain("real release");
  });

  it("given a name npm reads as a version, an uppercase or an empty one, when checked, then each is refused", () => {
    expect(["v2", "x", "Beta", "", "1beta", "be ta"].map(channelProblem)).not.toContain(null);
  });

  it("given a word of your own, when checked, then it is a channel", () => {
    expect(channelProblem("canary")).toBeNull();
  });
});

describe("the next number on a channel", () => {
  it("given nothing published on it, when numbered, then it starts at 0", () => {
    expect(nextNumber({ published: ["0.5.2"], next: "0.6.0", channel: "beta" })).toBe(0);
  });

  it("given numbers with a gap, when numbered, then it follows the highest", () => {
    const published = ["0.6.0-beta.0", "0.6.0-beta.3", "0.6.0-beta.10"];

    expect(nextNumber({ published, next: "0.6.0", channel: "beta" })).toBe(11);
  });

  it("given numbers on another base or channel, when numbered, then they do not count", () => {
    const published = ["0.5.0-beta.7", "0.6.0-alpha.4", "0.6.0-beta.0.1", "0.6.0-beta.1"];

    expect(nextNumber({ published, next: "0.6.0", channel: "beta" })).toBe(2);
  });
});

describe("the numbers of packages released together", () => {
  const FIXED = [["shiplane", "@shiplane/changesets", "@shiplane/git"]];

  it("given a fixed group whose packages took different numbers, when numbered, then all share the highest", () => {
    const numbered = sharedNumbers(
      [
        { name: "shiplane", number: 3 },
        { name: "@shiplane/changesets", number: 2 },
        { name: "@shiplane/git", number: 0 },
      ],
      FIXED,
    );

    expect(numbered.map(({ number }) => number)).toEqual([3, 3, 3]);
  });

  it("given packages in no fixed group, when numbered, then each keeps its own", () => {
    const numbered = sharedNumbers(
      [
        { name: "kit", number: 4 },
        { name: "app", number: 0 },
      ],
      [],
    );

    expect(numbered.map(({ number }) => number)).toEqual([4, 0]);
  });
});

describe("a test release's version and npm tag", () => {
  const at = { next: "0.6.0", branch: "main", sha: "329aafb00e1", n: 3 };

  it("given a snapshot, when versioned, then it is <next>-<branch>.<short sha> under the one snapshot tag", () => {
    expect(testVersion({ ...at, channel: "snapshot" })).toBe("0.6.0-main.329aafb");
    expect(testTag("snapshot")).toBe("snapshot");
  });

  it("given a numbered channel, when versioned, then it is <next>-<channel>.<n> under the channel's tag", () => {
    expect(testVersion({ ...at, channel: "beta" })).toBe("0.6.0-beta.3");
    expect(testTag("beta")).toBe("beta");
  });
});
