import type { PlannedChangeset } from "shiplane/plugin";
import type { Workspace } from "shiplane/testing";
import { flyServerHosting } from "@shiplane/fly";
import { backendService, mobileApp } from "shiplane/plugin";
import {
  changesetText,
  createWorkspace,
  openReleasePr,
  planFrom,
  prepareRelease,
  promote,
  readStatus,
  shipTo,
  testContext,
  testUnit,
} from "shiplane/testing";
import { afterEach, describe, expect, it } from "vitest";

import { easMobileDistribution } from "../eas-mobile-distribution.adapter";

const EXPO_OPTIONS = {
  versionFile: "app-version.json",
  update: { preview: "eas:update:preview", production: "eas:update:production:gated" },
};

const API_OPTIONS = {
  app: "acme-api-preview",
};

interface Build {
  id: string;
  status: string;
  buildProfile: string;
  isForIosSimulator: boolean;
  appVersion: string;
  appBuildVersion: string;
  gitCommitHash: string;
  createdAt: string;
  fingerprint: { hash: string } | null;
}

const build = (platform: string, profile: string, overrides: Partial<Build> = {}): Build => ({
  id: `${platform}-${profile}-1`,
  status: "FINISHED",
  buildProfile: profile,
  isForIosSimulator: false,
  appVersion: "0.1.115",
  appBuildVersion: "158",
  gitCommitHash: "built-from",
  createdAt: "2026-10-11T00:42:23.771Z",
  fingerprint: { hash: "fp-shipped" },
  ...overrides,
});

interface Submission {
  id: string;
  platform: "IOS" | "ANDROID";
  status: string;
  createdAt: string;
  submittedBuild: { id: string };
}

interface Update {
  group: string;
  gitCommitHash: string;
  /** Only while a rollout holds it back from part of the channel, as EAS lists it. */
  rolloutPercentage?: number;
  /** When it was published; the test clock reads 2026-10-12T09:00Z. */
  createdAt?: string;
}

let workspace: Workspace | undefined;
afterEach(() => workspace?.remove());

/** A repository on disk for the version files, over in-memory git and GitHub and a recording eas. */
const setUp = ({
  local = "fp-shipped",
  expoOptions = EXPO_OPTIONS,
  builds = {},
  versions = { preview: "0.1.115", production: "0.1.114" },
  updates = {},
  platformBuilds = {},
  submissions = {},
}: {
  local?: string;
  /** One platform's preview builds, newest first, in place of `builds.preview`. */
  platformBuilds?: Partial<Record<"ios" | "android", Build[]>>;
  /** Each platform's submissions, newest first, as `eas submit:list` prints them. */
  submissions?: Partial<Record<"ios" | "android", Submission[]>>;
  expoOptions?: Record<string, unknown>;
  builds?: Partial<Record<"preview" | "production", Build[]>>;
  versions?: { preview: string; production: string };
  /** Each channel's update groups, newest first. */
  updates?: Partial<Record<"preview" | "production", Update[]>>;
} = {}) => {
  workspace = createWorkspace({
    "apps/expo/app-version.json": JSON.stringify({
      preview: { version: versions.preview },
      production: { version: versions.production },
    }),
    "apps/api/public/app-version.preview.json": JSON.stringify({
      latest_version: "0.1.115",
      min_supported_version: "0.1.54",
    }),
    "apps/api/public/app-version.production.json": JSON.stringify({
      latest_version: "0.1.114",
      min_supported_version: "0.1.54",
    }),
  });
  const world = testContext({
    root: workspace.root,
    units: [
      testUnit("expo", { version: "0.1.115", module: "mobile-app", options: expoOptions }),
      testUnit("api", { version: "0.0.3", module: "backend-service", options: API_OPTIONS }),
    ],
    modules: [
      mobileApp({ mobileDistribution: easMobileDistribution() }),
      backendService({ serverHosting: flyServerHosting() }),
    ],
  });
  (["ios", "android"] as const).forEach((platform) => {
    world.shell.seed(`pnpm exec eas fingerprint:generate --platform ${platform}`, {
      stdout: `notice\n${JSON.stringify({ hash: local, sources: [] })}`,
    });
    world.shell.seed(`pnpm exec eas build:list --platform ${platform}`, {
      stdout: JSON.stringify([
        ...(platformBuilds[platform] ?? builds.preview ?? [build(platform, "preview")]),
        ...(builds.production ?? [build(platform, "production", { appVersion: "0.1.114" })]),
      ]),
    });
  });
  Object.entries(submissions).forEach(([platform, list]) =>
    world.shell.seed(`pnpm exec eas submit:list --platform ${platform}`, {
      stdout: JSON.stringify(list),
    }),
  );
  world.shell.seed("pnpm exec eas fingerprint:compare", {
    stdout: JSON.stringify({
      fingerprint1: {
        hash: "fp-shipped",
        sources: [{ type: "file", filePath: "ios/Podfile.lock", hash: "a" }],
      },
      fingerprint2: {
        hash: local,
        sources: [{ type: "file", filePath: "ios/Podfile.lock", hash: "b" }],
      },
    }),
  });
  Object.entries(updates).forEach(([channel, groups]) => {
    world.shell.seed(`pnpm exec eas update:list --branch ${channel}`, {
      stdout: JSON.stringify({
        currentPage: groups.map(({ group, rolloutPercentage }) => ({ group, rolloutPercentage })),
      }),
    });
    groups.forEach(({ group, gitCommitHash, createdAt = "2026-10-10T09:00:00.000Z" }) =>
      world.shell.seed(`pnpm exec eas update:view ${group}`, {
        stdout: JSON.stringify([{ gitCommitHash, createdAt }]),
      }),
    );
  });
  world.shell.seed("pnpm exec eas update:list", { stdout: JSON.stringify({ currentPage: [] }) });
  world.source.seed({
    position: { branch: "main", head: "head-1", originMain: "head-1" },
    // The ship workflow runs from the tag or from main, so both hold it.
    files: {
      "expo@0.1.115:.github/workflows/ship.yml": "on: workflow_dispatch",
      "main:.github/workflows/ship.yml": "on: workflow_dispatch",
    },
  });
  return { ...world, workspace };
};

const EXPO_MINOR: PlannedChangeset = {
  id: "apple-vision-cut-out",
  summary: "An iPhone on iOS 17 cuts the plant out, with Apple Vision.",
  releases: [{ name: "@acme/expo", type: "minor" }],
};

const easCalls = (shell: ReturnType<typeof setUp>["shell"], verb: string) =>
  shell.calls.filter(({ args }) => args.includes(verb));

describe("what a release PR versions for the mobile app", () => {
  it("given an expo changeset and the native layer the last build carries, when the release PR is prepared, then it ships over the air and writes no version file", async () => {
    const { context, versioning, prompter, host, workspace: ws } = setUp();
    versioning.seed({
      pending: [
        { id: EXPO_MINOR.id, text: changesetText({ "@acme/expo": "minor" }, EXPO_MINOR.summary) },
      ],
      plan: planFrom([EXPO_MINOR], { "@acme/expo": "0.1.115" }),
    });
    prompter.answer("update", "minor");

    await openReleasePr(context, await prepareRelease(context, new Set(["expo"])));

    expect(versioning.applied[0]?.added).toEqual([]);
    expect(host.received[0]?.type === "pr" && host.received[0].body).toContain(
      "Over-the-air update",
    );
    expect(JSON.parse(ws.read("apps/expo/app-version.json")).preview.version).toBe("0.1.115");
  });

  it("given native code changed and no expo changeset, when the release PR is prepared, then it adds a native changeset, moves the preview version and leaves api alone", async () => {
    const { context, versioning, prompter, workspace: ws } = setUp({ local: "fp-new" });
    versioning.seed({
      pending: [],
      plan: planFrom([], { "@acme/expo": "0.1.115", "@acme/api": "0.0.3" }),
    });
    prompter.answer("build", "patch");

    const prepared = await prepareRelease(context, new Set(["expo"]));
    await openReleasePr(context, prepared);

    expect(prepared.bumps.map(({ app }) => app)).toEqual(["expo"]);
    expect(versioning.applied[0]?.added).toEqual([
      {
        id: "native-0.1.116",
        releases: [{ name: "@acme/expo", type: "patch" }],
        summary: "Native code changed: ios/Podfile.lock.",
      },
    ]);
    expect(versioning.written).toEqual([]);
    expect(JSON.parse(ws.read("apps/expo/app-version.json")).preview.version).toBe("0.1.116");
    expect(JSON.parse(ws.read("apps/api/public/app-version.preview.json")).latest_version).toBe(
      "0.1.115",
    );
  });

  it("given the same native layer as the last build, when the release PR is prepared, then it asks what expo ships with the update suggested and why", async () => {
    const { context, versioning, prompter } = setUp();
    versioning.seed({
      pending: [
        { id: EXPO_MINOR.id, text: changesetText({ "@acme/expo": "minor" }, EXPO_MINOR.summary) },
      ],
      plan: planFrom([EXPO_MINOR], { "@acme/expo": "0.1.115" }),
    });
    prompter.answer("update");

    await prepareRelease(context, new Set(["expo"]));

    expect(prompter.initials["What should expo ship to preview?"]).toBe("update");
    expect(prompter.choices["What should expo ship to preview?"]).toEqual([
      {
        value: "update",
        label: "Over-the-air update (suggested)",
        hint: "same native layer and version as the last build",
      },
      {
        value: "build",
        label: "New build, iOS and Android",
        hint: "not needed: a new binary anyway, under its own version",
      },
    ]);
  });

  it("given an update would do, when the person forces a build, then expo gets a new binary version and the build ships on merge", async () => {
    const { context, versioning, prompter, host, workspace: ws } = setUp();
    versioning.seed({
      pending: [
        { id: EXPO_MINOR.id, text: changesetText({ "@acme/expo": "minor" }, EXPO_MINOR.summary) },
      ],
      plan: planFrom([EXPO_MINOR], { "@acme/expo": "0.1.115", "@acme/api": "0.0.3" }),
    });
    prompter.answer("build", "minor");

    await openReleasePr(context, await prepareRelease(context, new Set(["expo"])));

    expect(JSON.parse(ws.read("apps/expo/app-version.json")).preview.version).toBe("0.2.0");
    expect(host.received[0]?.type === "pr" && host.received[0].body).toContain(
      "Build iOS and Android, submitted when done",
    );
  });

  it("given a forced version, when the release PR opens, then expo decides again and carries the forced version", async () => {
    const { context, versioning, prompter, host, workspace: ws } = setUp();
    versioning.seed({
      pending: [
        { id: EXPO_MINOR.id, text: changesetText({ "@acme/expo": "minor" }, EXPO_MINOR.summary) },
      ],
      plan: planFrom([EXPO_MINOR], { "@acme/expo": "0.1.115", "@acme/api": "0.0.3" }),
    });
    prompter.answer("build", "major", "Drops the old navigation", "build");

    await openReleasePr(context, await prepareRelease(context, new Set(["expo"])));

    expect(JSON.parse(ws.read("apps/expo/app-version.json")).preview.version).toBe("1.0.0");
    expect(host.received[0]?.type === "pr" && host.received[0].title).toContain("1.0.0");
  });

  it("given native code changed, when asked what expo ships, then the build is suggested and the update is offered greyed with why", async () => {
    const { context, versioning, prompter } = setUp({ local: "fp-new" });
    versioning.seed({
      pending: [],
      plan: planFrom([], { "@acme/expo": "0.1.115", "@acme/api": "0.0.3" }),
    });
    prompter.answer("build");

    await prepareRelease(context, new Set(["expo"]));

    expect(prompter.initials["What should expo ship to preview?"]).toBe("build");
    expect(prompter.choices["What should expo ship to preview?"]).toEqual([
      {
        value: "build",
        label: "New build, iOS and Android (suggested)",
        hint: "native code changed since the last build",
      },
      {
        value: "update",
        label: "Over-the-air update",
        hint: "not safe: installed binaries lack this native layer",
        disabled: true,
      },
    ]);
  });

  it("given a preview build of this version still running, when the release PR is prepared, then nothing is written and it says to wait", async () => {
    const running = (platform: string) => [
      build(platform, "preview", {
        status: "IN_PROGRESS",
        appVersion: "0.1.115",
        id: `${platform}-run`,
      }),
      build(platform, "preview"),
    ];
    const { context, versioning, output } = setUp({
      builds: { preview: [...running("ios")] },
    });
    versioning.seed({
      pending: [
        { id: EXPO_MINOR.id, text: changesetText({ "@acme/expo": "minor" }, EXPO_MINOR.summary) },
      ],
      plan: planFrom([EXPO_MINOR], { "@acme/expo": "0.1.115" }),
    });

    expect(
      await openReleasePr(context, await prepareRelease(context, new Set(["expo"]))),
    ).toBeNull();
    expect(versioning.applied).toEqual([]);
    expect(output.text).toContain("a preview build is still running");
  });
});

describe("shipping the mobile app to preview", () => {
  it("given the tagged version moved past the last build, when shipped, then EAS builds and submits it in the cloud without asking how", async () => {
    const {
      context,
      shell,
      source,
      prompter,
      workspace: ws,
    } = setUp({
      builds: { preview: [build("ios", "preview", { appVersion: "0.1.114" })] },
    });
    source.seed({ tags: { "expo@0.1.115": "head-1" } });
    prompter.answer(true);

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    expect(easCalls(shell, "build")).toEqual([
      {
        command: "pnpm",
        args: [
          "exec",
          "eas",
          "build",
          "--profile",
          "preview",
          "--platform",
          "all",
          "--auto-submit",
          "--no-wait",
        ],
        cwd: `${ws.root}/apps/expo`,
        env: { EXPO_ATLAS: "false", APP_VARIANT: "preview" },
      },
    ]);
    expect(prompter.asked).not.toContain("How should expo@0.1.115 ship to preview?");
  });

  it("given the same native layer and its tag on main, when shipped through GitHub Actions, then the ship workflow publishes the update from its tag", async () => {
    const { context, ci, source, prompter } = setUp();
    source.seed({
      tags: { "expo@0.1.115": "head-1" },
      diffs: { "head-1..built-from": ["apps/expo/package.json"] },
    });
    prompter.answer("ci", true);

    await shipTo(context, "preview", { scope: new Set(["expo"]) });

    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: "expo@0.1.115",
        inputs: { units: "expo", environment: "preview" },
      },
    ]);
  });

  describe("after other apps released on top of it", () => {
    const releasedOnTop = (
      updates: Update[] = [],
      expoOptions: Record<string, unknown> = EXPO_OPTIONS,
    ) => {
      const world = setUp({ updates: { preview: updates }, expoOptions });
      world.versioning.seed({
        dependencies: { "@acme/expo": ["@acme/app"], "@acme/app": [], "@acme/landing": [] },
        folders: {
          "@acme/expo": "apps/expo",
          "@acme/app": "packages/app",
          "@acme/landing": "apps/landing",
        },
      });
      world.source.seed({
        tags: { "expo@0.1.115": "tag-expo" },
        diffs: {
          "tag-expo..head-1": ["apps/landing/package.json", "apps/landing/CHANGELOG.md"],
          "tag-expo..pushed-later": ["apps/landing/package.json"],
          "tag-expo..built-from": ["apps/expo/package.json"],
        },
      });
      return world;
    };

    it("given only another app's release commit since the mobile tag, when shipped, then the update goes out", async () => {
      const { context, ci, prompter } = releasedOnTop();
      prompter.answer("ci", true);

      expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

      expect(ci.received).toEqual([
        {
          type: "dispatch",
          workflow: "ship.yml",
          ref: "expo@0.1.115",
          inputs: { units: "expo", environment: "preview" },
        },
      ]);
    });

    it("given the update went out from a later commit that only touched another app, when resumed, then mobile is on preview", async () => {
      const { context, host, ci, output } = releasedOnTop([
        { group: "group-pre", gitCommitHash: "pushed-later" },
      ]);

      await shipTo(context, "preview", { scope: new Set(["expo"]) });

      expect(host.received).toEqual([]);
      expect(ci.received).toEqual([]);
      expect(output.text).toContain("expo 0.1.115 is on preview");
    });

    const appMovedOn = (world: ReturnType<typeof releasedOnTop>) =>
      world.source.seed({
        diffs: {
          "tag-expo..head-1": ["apps/landing/package.json", "packages/app/src/home.tsx"],
          "tag-expo..built-from": ["apps/expo/package.json"],
        },
      });

    it("given the app's own code also changed since its tag, when shipped, then the tag ships through GitHub Actions, never this machine's checkout", async () => {
      const world = releasedOnTop();
      appMovedOn(world);
      const { context, ci, prompter, output } = world;
      prompter.answer(true);

      expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

      expect(prompter.asked).not.toContain("How should expo@0.1.115 ship to preview?");
      expect(output.text).toContain(
        "main moved past it (packages/app/src/home.tsx changed since): ships through GitHub Actions",
      );
      expect(ci.received).toEqual([
        {
          type: "dispatch",
          workflow: "ship.yml",
          ref: "expo@0.1.115",
          inputs: { units: "expo", environment: "preview" },
        },
      ]);
    });

    it("given the app's own code changed since its tag and no ship workflow, when shipped, then it refuses and names only that code", async () => {
      const world = releasedOnTop();
      world.source.seed({ files: {} });
      appMovedOn(world);
      const { context, host, ci, output } = world;

      expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(false);

      expect(host.received).toEqual([]);
      expect(ci.received).toEqual([]);
      expect(output.text).toContain("packages/app/src/home.tsx");
      expect(output.text).not.toContain("apps/landing/package.json");
    });
  });

  it("given a build of this version still running, when shipped, then nothing more starts", async () => {
    const { context, shell, source, output } = setUp({
      builds: {
        preview: [
          build("ios", "preview", { status: "IN_QUEUE", id: "ios-run" }),
          build("ios", "preview"),
        ],
      },
    });
    source.seed({ tags: { "expo@0.1.115": "head-1" } });

    await shipTo(context, "preview", { scope: new Set(["expo"]) });

    expect(easCalls(shell, "build")).toEqual([]);
    expect(output.text).toContain("building on EAS, submitted when done");
  });
});

describe("promoting the mobile app to production", () => {
  it("given preview validated a new native layer, when production ships, then a PR moves production's version first and the build follows its merge", async () => {
    const {
      context,
      host,
      source,
      shell,
      prompter,
      workspace: ws,
    } = setUp({
      local: "fp-new",
      builds: {
        production: [
          build("ios", "production", { appVersion: "0.1.114", fingerprint: { hash: "fp-old" } }),
        ],
      },
    });
    source.seed({ tags: { "expo@0.1.115": "tag-expo" }, diffs: { "tag-expo..head-1": [] } });
    host.seed({ prStates: { 1800: ["MERGED"] } });
    prompter.answer("production", true, true);

    await shipTo(context, "production", { scope: new Set(["expo"]) });

    expect(host.received[0]).toMatchObject({
      type: "pr",
      head: "chore/promote-expo-0.1.115",
      title: "chore(release): production builds expo 0.1.115",
    });
    expect(JSON.parse(ws.read("apps/expo/app-version.json")).production.version).toBe("0.1.115");
    expect(easCalls(shell, "build")[0]?.args).toContain("production");
  });

  it("given production runs the version in both stores, when production ships, then it is shipped and nothing touches api", async () => {
    const { context, host, ci, source, versioning, prompter, output } = setUp({
      versions: { preview: "0.1.115", production: "0.1.115" },
      builds: {
        production: [
          build("ios", "production", { appVersion: "0.1.115", gitCommitHash: "tag-expo" }),
        ],
      },
    });
    source.seed({ tags: { "expo@0.1.115": "tag-expo" } });
    prompter.answer("production");

    await shipTo(context, "production", { scope: new Set(["expo"]) });

    expect(host.received).toEqual([]);
    expect(ci.received).toEqual([]);
    expect(versioning.written).toEqual([]);
    expect(output.text).toContain("expo 0.1.115 is live");
  });
});

describe("promoting the mobile app after main moved on", () => {
  const promotable = () => {
    const world = setUp({
      versions: { preview: "0.1.115", production: "0.1.115" },
      builds: { production: [build("ios", "production", { appVersion: "0.1.115" })] },
    });
    world.versioning.seed({
      dependencies: { "@acme/expo": ["@acme/app"], "@acme/app": [], "@acme/api": [] },
      folders: {
        "@acme/expo": "apps/expo",
        "@acme/app": "packages/app",
        "@acme/api": "apps/api",
      },
    });
    return world;
  };

  it("given only the API changed since the mobile release, when production ships, then the update preview validated goes out", async () => {
    const { context, ci, source, prompter } = promotable();
    source.seed({
      tags: { "expo@0.1.115": "tag-expo" },
      diffs: {
        "tag-expo..head-1": ["apps/api/src/main.ts", "docs/ci.md"],
        "tag-expo..built-from": ["packages/app/src/home.tsx"],
      },
    });
    prompter.answer("production", "ci", true);

    expect(await shipTo(context, "production", { scope: new Set(["expo"]) })).toBe(true);

    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: "main",
        inputs: { units: "expo", environment: "production" },
      },
    ]);
  });

  it("given a unit that ships main and its tag is the tip of main, when production ships through GitHub Actions, then it is still dispatched on main", async () => {
    const { context, ci, source, prompter } = promotable();
    source.seed({
      tags: { "expo@0.1.115": "head-1" },
      diffs: { "head-1..built-from": ["packages/app/src/home.tsx"] },
    });
    prompter.answer("production", "ci", true);

    expect(await shipTo(context, "production", { scope: new Set(["expo"]) })).toBe(true);

    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: "main",
        inputs: { units: "expo", environment: "production" },
      },
    ]);
  });

  it("given the app's own code changed since its release, when production ships, then it refuses and names what preview never ran", async () => {
    const { context, host, ci, source, prompter, output } = promotable();
    source.seed({
      tags: { "expo@0.1.115": "tag-expo" },
      diffs: {
        "tag-expo..head-1": ["apps/api/src/main.ts", "packages/app/src/home.tsx"],
        "tag-expo..built-from": ["packages/app/src/home.tsx"],
      },
    });
    prompter.answer("production");

    expect(await shipTo(context, "production", { scope: new Set(["expo"]) })).toBe(false);

    expect(host.received).toEqual([]);
    expect(ci.received).toEqual([]);
    expect(output.text).toContain("packages/app/src/home.tsx");
    expect(output.text).not.toContain("apps/api/src/main.ts");
  });
});

describe("promoting with preview's health", () => {
  const launches = { installs: 0, failedInstalls: 0, uniqueUsers: 0, crashRatePercent: 0 };
  const previewRan = (
    totals: Record<"ios" | "android", Partial<typeof launches>>,
    updatedFrom = "tag-expo",
  ) => {
    const world = setUp({
      updates: { preview: [{ group: "group-pre", gitCommitHash: updatedFrom }] },
    });
    world.shell.seed("pnpm exec eas update:insights group-pre", {
      stdout: JSON.stringify({
        groupId: "group-pre",
        platforms: (["ios", "android"] as const).map((platform) => ({
          platform,
          totals: { ...launches, ...totals[platform] },
        })),
      }),
    });
    world.source.seed({ tags: { "expo@0.1.115": "tag-expo" } });
    return world;
  };

  it("given the preview update crashed once, when promoting, then it shows preview's launches, asks before going on and stops when refused", async () => {
    const { context, prompter, output } = previewRan({
      ios: { installs: 3 },
      android: { installs: 12, failedInstalls: 1 },
    });
    prompter.answer(["expo"], false);

    expect(await promote(context, undefined)).toBe(true);

    expect(output.text).toContain("Android 12 launches, 1 crash");
    expect(prompter.asked.at(-1)).toContain("Promote anyway?");
    expect(prompter.asked).not.toContain('Type "production" to start:');
  });

  it("given the preview update ran with no crash, when promoting, then it shows its launches and goes on to production", async () => {
    const { context, prompter, output } = previewRan({
      ios: { installs: 3 },
      android: { installs: 12 },
    });
    prompter.answer(["expo"], "no");

    await promote(context, undefined);

    expect(output.text).toContain("iOS 3 launches, 0 crashes");
    expect(prompter.asked).toContain('Type "production" to start:');
    expect(prompter.asked.some((question) => question.includes("Promote anyway?"))).toBe(false);
  });

  it("given preview got this release as a build, not an update, when promoting, then no health is shown and it goes on", async () => {
    const { context, source, prompter, output } = previewRan({ ios: {}, android: {} }, "older");
    source.seed({
      tags: { "expo@0.1.115": "tag-expo" },
      diffs: { "tag-expo..older": ["apps/expo/src/older.ts"] },
    });
    prompter.answer(["expo"], "no");

    await promote(context, undefined);

    expect(output.text).not.toContain("launches");
    expect(prompter.asked).toContain('Type "production" to start:');
  });
});

describe("guiding a production rollout", () => {
  const ROLLOUT = "How far should expo@0.1.115 go on production?";
  const onProduction = ({
    rolloutPercentage,
    createdAt,
    launches = { ios: [120, 0], android: [340, 0] },
  }: {
    rolloutPercentage?: number;
    createdAt?: string;
    launches?: Record<"ios" | "android", [number, number]>;
  } = {}) => {
    const world = setUp({
      versions: { preview: "0.1.115", production: "0.1.115" },
      builds: { production: [build("ios", "production", { appVersion: "0.1.115" })] },
      updates: {
        production: [
          { group: "group-115", gitCommitHash: "tag-expo", rolloutPercentage, createdAt },
        ],
      },
    });
    world.shell.seed("pnpm exec eas update:insights group-115", {
      stdout: JSON.stringify({
        platforms: (["ios", "android"] as const).map((platform) => ({
          platform,
          totals: { installs: launches[platform][0], failedInstalls: launches[platform][1] },
        })),
      }),
    });
    world.source.seed({ tags: { "expo@0.1.115": "tag-expo" } });
    return world;
  };

  it("given 10% of people ran it for two days without a crash, when production ships, then it shows where the rollout stands and suggests widening it to 25%", async () => {
    const { context, shell, prompter, output } = onProduction({ rolloutPercentage: 10 });
    prompter.answer("production", "25", true);

    expect(await shipTo(context, "production", { scope: new Set(["expo"]) })).toBe(true);

    expect(output.text).toContain("10% of people · out for 2 days");
    expect(output.text).toContain("iOS 120 launches, 0 crashes · Android 340 launches, 0 crashes");
    expect(prompter.initials[ROLLOUT]).toBe("25");
    expect(prompter.choices[ROLLOUT]?.map(({ label }) => label)).toEqual([
      "25% of people (suggested)",
      "50% of people",
      "Everyone",
      "Stay at 10%",
      "Roll back",
    ]);
    expect(easCalls(shell, "update:edit").map(({ args }) => args)).toEqual([
      [
        "exec",
        "eas",
        "update:edit",
        "group-115",
        "--rollout-percentage",
        "25",
        "--non-interactive",
      ],
    ]);
  });

  it("given the person picks everyone, when the rollout moves, then the update reaches all of production", async () => {
    const { context, shell, prompter } = onProduction({ rolloutPercentage: 50 });
    prompter.answer("production", "100", true);

    await shipTo(context, "production", { scope: new Set(["expo"]) });

    expect(prompter.initials[ROLLOUT]).toBe("100");
    expect(easCalls(shell, "update:edit")[0]?.args).toContain("100");
  });

  it("given a crash at 10%, when production ships, then it suggests staying and offers rolling back", async () => {
    const { context, shell, prompter } = onProduction({
      rolloutPercentage: 10,
      launches: { ios: [120, 0], android: [340, 2] },
    });
    prompter.answer("production", "roll-back", true);

    await shipTo(context, "production", { scope: new Set(["expo"]) });

    expect(prompter.initials[ROLLOUT]).toBe("stay");
    expect(prompter.choices[ROLLOUT]?.find(({ value }) => value === "stay")?.hint).toBe(
      "2 crashes since it went out: look before widening, or roll back",
    );
    expect(easCalls(shell, "update:revert-update-rollout").map(({ args }) => args)).toEqual([
      ["exec", "eas", "update:revert-update-rollout", "--group", "group-115", "--non-interactive"],
    ]);
  });

  it("given an update out for three hours, when the person stays, then nothing runs and it says where the rollout rests", async () => {
    const { context, shell, prompter, output } = onProduction({
      rolloutPercentage: 10,
      createdAt: "2026-10-12T06:00:00.000Z",
    });
    prompter.answer("production", "stay");

    expect(await shipTo(context, "production", { scope: new Set(["expo"]) })).toBe(true);

    expect(prompter.initials[ROLLOUT]).toBe("stay");
    expect(easCalls(shell, "update:edit")).toEqual([]);
    expect(output.text).toContain("stays at 10% of people");
  });

  it("given --ci from a terminal, when production ships a partial rollout, then it still asks how far it goes", async () => {
    const { context, shell, prompter } = onProduction({ rolloutPercentage: 10 });
    context.options.ci = true;
    prompter.answer("25", true);

    await shipTo(context, "production", { scope: new Set(["expo"]) });

    expect(prompter.initials[ROLLOUT]).toBe("25");
    expect(easCalls(shell, "update:edit")[0]?.args).toContain("25");
  });

  it("given production's update of this release reaches everyone, when production ships, then it is live and nothing is asked", async () => {
    const { context, shell, prompter, output } = onProduction();
    prompter.answer("production");

    await shipTo(context, "production", { scope: new Set(["expo"]) });

    expect(easCalls(shell, "update:edit")).toEqual([]);
    expect(prompter.asked).not.toContain(ROLLOUT);
    expect(output.text).toContain("expo 0.1.115 is live");
  });

  it("given a production update held at 10%, when the status is read as JSON, then it says how far the rollout went", async () => {
    const { context } = onProduction({ rolloutPercentage: 10 });

    const status = await readStatus(context, "production");

    expect(status.units.find(({ unit }) => unit === "expo")?.live).toMatchObject({
      channel: "production",
      rolloutPercentage: 10,
    });
  });
});

describe("the mobile app's status", () => {
  it("given the last build carries this native layer, when the status is read as JSON, then each platform says an update ships", async () => {
    const { context } = setUp();

    const status = await readStatus(context, "preview");

    expect(status.units.find(({ unit }) => unit === "expo")?.live).toMatchObject({
      channel: "preview",
      version: "0.1.115",
      action: "update",
      platforms: [
        expect.objectContaining({ platform: "ios", action: "update" }),
        expect.objectContaining({ platform: "android", action: "update" }),
      ],
    });
  });

  const expoChoice = async (world: ReturnType<typeof setUp>) => {
    world.source.seed({ tags: { "expo@0.1.115": "head-1" } });
    const status = await readStatus(world.context, "preview");
    return status.units.find(({ unit }) => unit === "expo");
  };

  it("given expo@0.1.115 tagged and its only preview build of 0.1.115 errored, when the status is read, then expo is not live and offered as a retry", async () => {
    const world = setUp({
      builds: {
        preview: [
          build("ios", "preview", { status: "ERRORED", id: "ios-errored" }),
          build("ios", "preview", { appVersion: "0.1.114" }),
        ],
      },
    });

    expect(await expoChoice(world)).toMatchObject({
      pending: true,
      hint: "0.1.115 tagged, never reached preview: retry",
    });
  });

  it("given a finished preview build of 0.1.115 made from its tag, when the status is read, then expo is live and greyed out", async () => {
    const world = setUp({
      builds: { preview: [build("ios", "preview", { gitCommitHash: "head-1" })] },
    });

    expect(await expoChoice(world)).toMatchObject({ pending: false });
  });

  it("given a preview build of 0.1.115 still running, when the status is read, then no retry is offered", async () => {
    const world = setUp({
      builds: {
        preview: [
          build("ios", "preview", { status: "IN_PROGRESS", id: "ios-run" }),
          build("ios", "preview", { appVersion: "0.1.114" }),
        ],
      },
    });

    expect(await expoChoice(world)).toMatchObject({ pending: false });
  });
});

describe("retrying a mobile release that never reached preview", () => {
  const TAG = "expo@0.1.115";
  const RETRY = "What should ship?";
  const NO_TRACE = "Did the last attempt to ship 0.1.115 fail before it got this far?";
  const HOW = "How should expo@0.1.115 ship to preview?";
  const OLDER = (platform: string) =>
    build(platform, "preview", { appVersion: "0.1.114", id: `${platform}-114` });
  const IOS_FAILED = build("ios", "preview", {
    status: "ERRORED",
    id: "ios-failed",
    gitCommitHash: "tag-expo",
    createdAt: "2026-10-12T07:00:00.000Z",
  });
  const ANDROID_BUILT = build("android", "preview", {
    id: "android-42",
    appBuildVersion: "42",
    gitCommitHash: "tag-expo",
  });
  const submitted = (platform: "IOS" | "ANDROID", buildId: string, status = "FINISHED") => ({
    id: `${buildId}-submission`,
    platform,
    status,
    createdAt: "2026-10-12T08:00:00.000Z",
    submittedBuild: { id: buildId },
  });

  /** expo@0.1.115 tagged on tag-expo, and main three commits on with the app's own code changed. */
  const movedOn = (options: Parameters<typeof setUp>[0] = {}) => {
    const world = setUp({ local: "fp-new", ...options });
    world.versioning.seed({
      dependencies: { "@acme/expo": ["@acme/app"], "@acme/app": [], "@acme/api": [] },
      folders: { "@acme/expo": "apps/expo", "@acme/app": "packages/app", "@acme/api": "apps/api" },
    });
    world.source.seed({
      tags: { [TAG]: "tag-expo" },
      diffs: { "tag-expo..head-1": ["packages/app/src/home.tsx", "apps/api/src/main.ts"] },
      commits: {
        "tag-expo..head-1": [
          { subject: "feat(app): home", files: ["packages/app/src/home.tsx"] },
          { subject: "fix(api): main", files: ["apps/api/src/main.ts"] },
          { subject: "chore: lint", files: ["package.json"] },
        ],
      },
    });
    world.host.seed({ releasedTags: [TAG] });
    return world;
  };

  /** The iOS build of 0.1.115 failed two hours ago; Android built and submitted it. */
  const iosFailed = () =>
    movedOn({
      platformBuilds: { ios: [IOS_FAILED, OLDER("ios")], android: [ANDROID_BUILT] },
      submissions: { android: [submitted("ANDROID", "android-42")] },
    });

  it("given the iOS build failed and main moved on, when shipped, then it says why, offers the retry preselected and ships the tag through GitHub Actions without asking again", async () => {
    const { context, ci, shell, prompter, output } = iosFailed();
    prompter.answer("retry", "ci");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    expect(output.text).toContain(
      "expo 0.1.115 didn't reach preview: the iOS build failed 2h ago.",
    );
    expect(output.text).toContain("main has 3 commits since its tag (packages/app/src/home.tsx).");
    expect(prompter.initials[RETRY]).toBe("retry");
    expect(prompter.choices[RETRY]?.map(({ label }) => label)).toEqual([
      "Retry 0.1.115 exactly as released",
      "Release the new code instead (pnpm changeset, then shiplane)",
      "Cancel",
    ]);
    expect(output.text).toContain(
      "tag ✓, release notes ✓, Android ✓ build 42, iOS ✗ failed → build iOS, then submit",
    );
    expect(prompter.asked).toEqual([RETRY, HOW]);
    expect(easCalls(shell, "build")).toEqual([]);
    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: TAG,
        inputs: { units: "expo", environment: "preview" },
      },
    ]);
  });

  it("given the iOS build failed and main moved on, when retried from this machine, then only iOS builds, from a worktree at the tag with the env files copied, and the worktree goes", async () => {
    const { context, shell, source, prompter, workspace: ws } = iosFailed();
    source.seed({ ignored: [".env", "apps/expo/.env.local"] });
    prompter.answer("retry", "local");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    const added = source.received.find((event) => event.type === "worktree-add");
    expect(added).toMatchObject({ type: "worktree-add", ref: TAG });
    const dir = added?.type === "worktree-add" ? added.dir : "";
    expect(shell.calls.filter(({ command }) => command === "cp").map(({ args }) => args)).toEqual([
      [`${ws.root}/.env`, `${dir}/.env`],
      [`${ws.root}/apps/expo/.env.local`, `${dir}/apps/expo/.env.local`],
    ]);
    expect(shell.calls).toContainEqual({
      command: "pnpm",
      args: ["install", "--frozen-lockfile"],
      cwd: dir,
      env: undefined,
    });
    expect(easCalls(shell, "build")).toEqual([
      {
        command: "pnpm",
        args: [
          "exec",
          "eas",
          "build",
          "--profile",
          "preview",
          "--platform",
          "ios",
          "--auto-submit",
          "--no-wait",
        ],
        cwd: `${dir}/apps/expo`,
        env: { EXPO_ATLAS: "false", APP_VARIANT: "preview" },
      },
    ]);
    expect(source.received.at(-1)).toEqual({ type: "worktree-remove", dir });
  });

  it("given the build from the worktree fails, when retried from this machine, then the worktree is still removed and the run fails", async () => {
    const { context, shell, source, prompter } = iosFailed();
    shell.seedOnce("pnpm exec eas build --profile", { status: 1 });
    prompter.answer("retry", "local");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(false);

    const added = source.received.find((event) => event.type === "worktree-add");
    expect(added).toBeDefined();
    expect(source.received.at(-1)).toEqual({
      type: "worktree-remove",
      dir: added?.type === "worktree-add" ? added.dir : "",
    });
  });

  it("given the tag and its notes exist and the build failed, when retried, then only the build runs: no tag, no release notes, no comment", async () => {
    const { context, host, source, shell, prompter } = iosFailed();
    prompter.answer("retry", "local");

    await shipTo(context, "preview", { scope: new Set(["expo"]) });

    expect(easCalls(shell, "build")).toHaveLength(1);
    expect(easCalls(shell, "submit")).toEqual([]);
    expect(source.received.filter(({ type }) => type === "tag" || type === "push-tags")).toEqual(
      [],
    );
    expect(host.received.filter(({ type }) => type !== "record")).toEqual([]);
  });

  it("given nothing for the version reached EAS, when shipped, then it asks whether the last attempt failed and a yes builds both platforms from the tag", async () => {
    const { context, ci, prompter, output } = movedOn({
      platformBuilds: { ios: [OLDER("ios")], android: [OLDER("android")] },
    });
    prompter.answer("retry", "ci");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    expect(output.text).toContain("expo 0.1.115 is tagged, but nothing for it reached preview.");
    expect(prompter.initials[NO_TRACE]).toBe("retry");
    expect(prompter.choices[NO_TRACE]?.map(({ label }) => label)).toEqual([
      "Yes, retry 0.1.115 exactly as released",
      "No, release the new code instead (pnpm changeset, then shiplane)",
      "Cancel",
    ]);
    expect(output.text).toContain("→ build iOS and Android, then submit");
    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: TAG,
        inputs: { units: "expo", environment: "preview" },
      },
    ]);
  });

  it("given nothing for the version reached EAS, when the person says the last attempt did not fail, then nothing ships and it names the changeset commands", async () => {
    const { context, ci, shell, prompter, output } = movedOn({
      platformBuilds: { ios: [OLDER("ios")], android: [OLDER("android")] },
    });
    prompter.answer("new-code");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    expect(ci.received).toEqual([]);
    expect(easCalls(shell, "build")).toEqual([]);
    expect(output.text).toContain("pnpm changeset");
    expect(output.text).toContain("pnpm shiplane");
  });

  it("given the build finished but its submission failed, when retried, then only the submit runs, for that build", async () => {
    const { context, shell, prompter, output } = movedOn({
      platformBuilds: {
        ios: [build("ios", "preview", { id: "ios-7", gitCommitHash: "tag-expo" })],
        android: [ANDROID_BUILT],
      },
      submissions: {
        ios: [submitted("IOS", "ios-7", "ERRORED")],
        android: [submitted("ANDROID", "android-42")],
      },
    });
    prompter.answer("retry", "local");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    expect(output.text).toContain("the iOS submission failed 1h ago.");
    expect(easCalls(shell, "build")).toEqual([]);
    expect(easCalls(shell, "submit").map(({ args }) => args)).toEqual([
      [
        "exec",
        "eas",
        "submit",
        "--platform",
        "ios",
        "--id",
        "ios-7",
        "--profile",
        "preview",
        "--non-interactive",
      ],
    ]);
  });

  it("given iOS to build and Android to submit again, when retried through GitHub Actions, then both jobs name the tag and one run ships them", async () => {
    const { context, ci, prompter } = movedOn({
      platformBuilds: {
        ios: [IOS_FAILED, OLDER("ios")],
        android: [ANDROID_BUILT],
      },
      submissions: { android: [submitted("ANDROID", "android-42", "ERRORED")] },
    });
    prompter.answer("retry", "ci");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    expect(ci.received).toEqual([
      {
        type: "dispatch",
        workflow: "ship.yml",
        ref: TAG,
        inputs: { units: "expo", environment: "preview" },
      },
    ]);
  });

  it("given both platforms built from the tag with the same native layer, the iOS submission failed and main got JS-only commits, when shipped, then the retry is offered and only iOS is submitted", async () => {
    const { context, shell, prompter, output } = movedOn({
      local: "fp-shipped",
      platformBuilds: {
        ios: [build("ios", "preview", { id: "ios-7", gitCommitHash: "tag-expo" })],
        android: [ANDROID_BUILT],
      },
      submissions: {
        ios: [submitted("IOS", "ios-7", "ERRORED")],
        android: [submitted("ANDROID", "android-42")],
      },
    });
    prompter.answer("retry", "local");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    expect(output.text).toContain("expo 0.1.115 didn't reach preview: the iOS submission failed");
    expect(output.text).not.toContain("expo 0.1.115 is on preview");
    expect(easCalls(shell, "build")).toEqual([]);
    expect(easCalls(shell, "submit").map(({ args }) => args.slice(3, 7))).toEqual([
      ["--platform", "ios", "--id", "ios-7"],
    ]);
  });

  it("given the tag released an update that went out from it, and main then changed native code, when shipped, then it is on preview and nothing is offered or republished", async () => {
    const { context, shell, source, prompter, output } = movedOn({
      versions: { preview: "0.1.114", production: "0.1.114" },
      platformBuilds: { ios: [OLDER("ios")], android: [OLDER("android")] },
      updates: { preview: [{ group: "group-115", gitCommitHash: "tag-expo" }] },
    });
    source.seed({
      files: {
        "expo@0.1.115:.github/workflows/ship.yml": "on: workflow_dispatch",
        "main:.github/workflows/ship.yml": "on: workflow_dispatch",
        "expo@0.1.115:apps/expo/app-version.json": JSON.stringify({
          preview: { version: "0.1.114" },
          production: { version: "0.1.114" },
        }),
      },
    });

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    expect(prompter.asked).toEqual([]);
    expect(output.text).toContain("expo 0.1.115 is on preview");
    expect(shell.calls.filter(({ args }) => args.includes("eas:update:preview"))).toEqual([]);
  });

  it("given the worktree cannot be made, when retried from this machine, then what was made of it is removed and the run fails", async () => {
    const { context, source, prompter } = iosFailed();
    source.failAt("worktree-add", 1, new Error("no space left"));
    prompter.answer("retry", "local");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(false);

    expect(source.received.at(-1)?.type).toBe("worktree-remove");
  });

  it("given the build fails and the worktree then cannot be removed, when retried from this machine, then the build's failure is reported and the leftover worktree is said", async () => {
    const { context, shell, source, prompter, output } = iosFailed();
    shell.seedOnce("pnpm exec eas build --profile", { status: 1 });
    source.failAt("worktree-remove", 1, new Error("worktree locked"));
    prompter.answer("retry", "local");

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(false);

    expect(output.text).toContain("pnpm exited with 1, nothing after it ran");
    expect(output.text).toContain("could not remove the worktree");
    expect(output.text).toContain("worktree locked");
  });

  it("given the iOS build failed with no terminal, when shipped, then it refuses and says a terminal run offers the retry", async () => {
    const world = iosFailed();
    const { context, ci, shell, output } = world;
    Object.defineProperty(world.prompter, "interactive", { value: false });

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(false);

    expect(output.text).toContain(
      "The last iOS build of 0.1.115 failed 2h ago: run it from a terminal to retry 0.1.115 as released.",
    );
    expect(output.text).toContain("pnpm shiplane ship expo");
    expect(ci.received).toEqual([]);
    expect(easCalls(shell, "build")).toEqual([]);
  });

  it("given the iOS build failed on a CI runner, when shipped, then it refuses and asks nothing", async () => {
    const { context, prompter, output } = iosFailed();
    context.options.ci = true;
    context.options.yes = true;

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(false);

    expect(prompter.asked).toEqual([]);
    expect(output.text).toContain("run it from a terminal to retry 0.1.115 as released");
  });

  it("given a newer version built on preview, when shipped, then main is behind and no retry is offered", async () => {
    const { context, prompter, output } = movedOn({
      platformBuilds: {
        ios: [build("ios", "preview", { appVersion: "0.1.116" })],
        android: [build("android", "preview", { appVersion: "0.1.116" })],
      },
    });

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(false);

    expect(prompter.asked).toEqual([]);
    expect(output.text).toContain("main is behind");
  });

  it("given the runner checked out at the tag, Android built and iOS failed, when it ships, then it builds only iOS from that detached commit", async () => {
    const { context, shell, source } = setUp({
      platformBuilds: { ios: [IOS_FAILED, OLDER("ios")], android: [ANDROID_BUILT] },
      submissions: { android: [submitted("ANDROID", "android-42")] },
    });
    source.seed({
      position: { branch: "HEAD", head: "tag-expo", originMain: "head-1" },
      tags: { [TAG]: "tag-expo" },
    });
    context.options.ci = true;
    context.options.yes = true;

    expect(await shipTo(context, "preview", { scope: new Set(["expo"]) })).toBe(true);

    expect(easCalls(shell, "build").map(({ args }) => args.slice(5, 7))).toEqual([
      ["--platform", "ios"],
    ]);
  });
});
