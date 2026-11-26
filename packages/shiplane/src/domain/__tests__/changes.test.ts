import { describe, expect, it } from "vitest";

import type { StatusPlan } from "../changes";
import { SAMPLE_UNITS } from "../../testing/sample";
import { appBumps, changesetApps, packageBumps, splitChangesets } from "../changes";

// The four changesets that came with #1676, #1677, #1680 and #1681.
const LAST_WEEK: StatusPlan = {
  changesets: [
    {
      id: "android-builds-again",
      summary: "The Android app builds again.",
      releases: [
        { name: "@acme/expo", type: "patch" },
        { name: "@acme/image-crop", type: "patch" },
      ],
    },
    {
      id: "apple-vision-cut-out",
      summary: "An iPhone on iOS 17 crops the photo with Apple Vision.",
      releases: [
        { name: "@acme/expo", type: "minor" },
        { name: "react-native-subject-finder", type: "minor" },
      ],
    },
    {
      id: "search-empty-state",
      summary: "A search with no result shows an empty page, not an error.",
      releases: [
        { name: "@acme/api", type: "patch" },
        { name: "@acme/contracts", type: "patch" },
      ],
    },
  ],
  releases: [
    {
      name: "@acme/expo",
      type: "minor",
      oldVersion: "0.1.114",
      newVersion: "0.2.0",
      changesets: ["android-builds-again", "apple-vision-cut-out"],
    },
    {
      name: "@acme/api",
      type: "patch",
      oldVersion: "0.0.1",
      newVersion: "0.0.2",
      changesets: ["search-empty-state"],
    },
    {
      name: "@acme/admin",
      type: "patch",
      oldVersion: "0.1.0",
      newVersion: "0.1.1",
      changesets: [],
    },
    {
      name: "@acme/contracts",
      type: "patch",
      oldVersion: "0.1.0",
      newVersion: "0.1.1",
      changesets: ["search-empty-state"],
    },
    {
      name: "@acme/image-crop",
      type: "patch",
      oldVersion: "0.1.0",
      newVersion: "0.1.1",
      changesets: ["android-builds-again"],
    },
  ],
};

const WORKSPACE_DEPENDENCIES = {
  "@acme/admin": ["@acme/contracts", "@acme/ui"],
  "@acme/api": ["@acme/contracts"],
  "@acme/expo": ["@acme/shared", "@acme/image-crop"],
};

const bumps = appBumps(LAST_WEEK, WORKSPACE_DEPENDENCIES, SAMPLE_UNITS);

describe("what each app ships", () => {
  it("given changesets naming expo, when planned, then expo moves to its new version with the notes written for it", () => {
    expect(bumps.find(({ app }) => app === "expo")).toEqual({
      app: "expo",
      from: "0.1.114",
      to: "0.2.0",
      notes: [
        "The Android app builds again.",
        "An iPhone on iOS 17 crops the photo with Apple Vision.",
      ],
      movedWith: [],
    });
  });

  it("given admin moved only because a package it uses moved, when planned, then it says which package", () => {
    expect(bumps.find(({ app }) => app === "admin")).toMatchObject({
      to: "0.1.1",
      notes: [],
      movedWith: ["@acme/contracts"],
    });
  });

  it("given no changeset reaches landing, when planned, then landing is not part of the release", () => {
    expect(bumps.map(({ app }) => app)).toEqual(["expo", "api", "admin"]);
  });

  it("given internal packages moved, when planned, then they are counted apart from the apps", () => {
    expect(packageBumps(LAST_WEEK, SAMPLE_UNITS)).toBe(2);
  });

  // changeset status lists a package it leaves at its version with the bump type "none".
  const UNMOVED: StatusPlan = {
    ...LAST_WEEK,
    releases: [
      ...LAST_WEEK.releases,
      {
        name: "@acme/landing",
        type: "none",
        oldVersion: "0.4.0",
        newVersion: "0.4.0",
        changesets: [],
      },
      {
        name: "@acme/tokens",
        type: "none",
        oldVersion: "0.1.0",
        newVersion: "0.1.0",
        changesets: [],
      },
    ],
  };

  it("given status lists landing with no bump, when planned, then landing is not part of the release", () => {
    expect(appBumps(UNMOVED, WORKSPACE_DEPENDENCIES, SAMPLE_UNITS).map(({ app }) => app)).toEqual([
      "expo",
      "api",
      "admin",
    ]);
  });

  it("given status lists a package with no bump, when planned, then it is not counted as bumped", () => {
    expect(packageBumps(UNMOVED, SAMPLE_UNITS)).toBe(2);
  });
});

describe("picking what ships", () => {
  const SHARED = {
    id: "product-names-everywhere",
    summary: "A product's full name shows in the app and in the admin.",
    releases: [
      { name: "@acme/expo", type: "patch" as const },
      { name: "@acme/admin", type: "patch" as const },
      { name: "@acme/contracts", type: "patch" as const },
    ],
  };

  it("given every app picked, when split, then every changeset ships and none waits", () => {
    expect(splitChangesets(LAST_WEEK.changesets, [], SAMPLE_UNITS)).toEqual({
      ships: LAST_WEEK.changesets,
      waits: [],
    });
  });

  it("given api held, when split, then its changeset waits whole, packages included, and expo's ship", () => {
    const { ships, waits } = splitChangesets(LAST_WEEK.changesets, ["api"], SAMPLE_UNITS);

    expect(ships.map(({ id }) => id)).toEqual(["android-builds-again", "apple-vision-cut-out"]);
    expect(waits).toEqual([LAST_WEEK.changesets[2]]);
  });

  it("given expo held and admin picked, when a changeset names both, then admin's line ships and expo's waits with the package", () => {
    const { ships, waits } = splitChangesets([SHARED], ["expo"], SAMPLE_UNITS);

    expect(ships).toEqual([{ ...SHARED, releases: [{ name: "@acme/admin", type: "patch" }] }]);
    expect(waits).toEqual([
      {
        ...SHARED,
        releases: [
          { name: "@acme/expo", type: "patch" },
          { name: "@acme/contracts", type: "patch" },
        ],
      },
    ]);
  });
});

describe("a pending changeset", () => {
  it("given a pending changeset, when read, then it names the apps it releases and not the packages", () => {
    const text =
      '---\n"@acme/admin": patch\n"@acme/contracts": minor\n"@acme/api": patch\n---\n\nNotes.\n';

    expect(changesetApps(text, SAMPLE_UNITS)).toEqual(["api", "admin"]);
  });
});
