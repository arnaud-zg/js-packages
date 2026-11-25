import { RecordingShell, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { easMobileDistribution } from "../eas-mobile-distribution.adapter";

const eas = easMobileDistribution();

type Folder = Parameters<NonNullable<typeof eas.detect>>[0];

const folder = (files: Record<string, string>): Folder => ({
  dir: "apps/expo",
  name: "expo",
  files: Object.keys(files),
  has: (file) => file in files,
  read: (file) => files[file] ?? null,
});

const withScripts = (scripts: Record<string, string>) =>
  folder({ "eas.json": "{}", "package.json": JSON.stringify({ scripts }) });

describe("setting up an Expo app to ship with EAS", () => {
  it("given an app with no eas.json, when shiplane init scans it, then EAS is not offered", () => {
    expect(eas.detect?.(folder({ "package.json": "{}" }))).toBeNull();
  });

  it("given eas.json and the usual update scripts, when shiplane init scans the app, then EAS is offered with the plain production script picked over the gated one", () => {
    const found = eas.detect?.(
      withScripts({
        "eas:update:preview": "eas update --channel preview",
        "eas:update:production:gated": "node gate.js && eas update --channel production",
        "eas:update:production": "eas update --channel production",
      }),
    );

    expect(found).toEqual({
      certainty: "found",
      reason: "eas.json",
      environments: ["preview", "production"],
      options: { update: { preview: "eas:update:preview", production: "eas:update:production" } },
    });
  });

  it("given only a gated production update script, when shiplane init scans the app, then the gated script publishes production updates", () => {
    const found = eas.detect?.(
      withScripts({
        "eas:update:preview": "eas update",
        "eas:update:production:gated": "eas update",
      }),
    );

    expect(found?.options).toEqual({
      update: { preview: "eas:update:preview", production: "eas:update:production:gated" },
    });
  });

  it("given update scripts under custom names, when shiplane init scans the app, then the scripts naming update and the environment publish the updates", () => {
    const found = eas.detect?.(
      withScripts({
        "build:preview": "eas build",
        "ota-update-preview": "eas update",
        "release-production": "eas build",
        "update-production": "eas update",
      }),
    );

    expect(found?.options).toEqual({
      update: { preview: "ota-update-preview", production: "update-production" },
    });
  });

  it("given an update script for preview only, when shiplane init scans the app, then it asks which script publishes an update", () => {
    const scanned = withScripts({ "eas:update:preview": "eas update" });
    const found = eas.detect?.(scanned);

    expect(found?.options).toEqual({});
    expect(eas.questions?.(scanned, found?.options ?? {}, "acme/app")).toEqual([
      { key: "update", message: "Package script that publishes an update?", initial: "eas:update" },
    ]);
  });

  it("given eas.json and no package.json, when shiplane init scans the app, then EAS is offered with no update script set", () => {
    expect(eas.detect?.(folder({ "eas.json": "{}" }))).toEqual({
      certainty: "found",
      reason: "eas.json",
      options: {},
    });
  });

  it("given both update scripts were found, when shiplane init sets the app up, then it asks nothing more", () => {
    const scanned = withScripts({ "eas:update:preview": "x", "eas:update:production": "y" });

    expect(eas.questions?.(scanned, eas.detect?.(scanned)?.options ?? {}, "acme/app")).toEqual([]);
  });
});

describe("checking an Expo app is ready to ship with EAS", () => {
  const unit = testUnit("expo", {
    module: "mobile-app",
    dir: "apps/expo",
    options: { versionFile: "binary-version.json", update: "eas:update" },
  });

  it("given an app in its own folder, when shiplane checks it can ship, then it runs eas whoami there and offers eas login as the fix, and a runner signs in with EXPO_TOKEN", () => {
    expect(eas.requirements?.(unit)).toEqual([
      {
        label: "eas",
        check: { command: "pnpm", args: ["exec", "eas", "whoami"], cwd: "apps/expo" },
        fix: { command: "pnpm", args: ["exec", "eas", "login"], cwd: "apps/expo" },
        secrets: ["EXPO_TOKEN"],
      },
    ]);
  });

  it("given a custom version file, when a release bumps the app's version, then it writes that file in the app's folder", () => {
    const port = eas.create({ root: "/repo", shell: new RecordingShell() });

    expect(port.versionFiles?.(unit, [unit])).toEqual(["apps/expo/binary-version.json"]);
  });
});

describe("an app whose repository names its environments otherwise", () => {
  const flow = { path: ["beta", "store"], users: "store" } as const;
  const jobsOn = (environment: string) =>
    eas.create({ root: "/repo", shell: new RecordingShell() }).jobs({
      unit: testUnit("expo", { module: "mobile-app" }),
      tag: "expo@1.0.0",
      environment,
      flow,
      commit: "abc1234",
      defaultBranch: "main",
      options: { versionFile: "app-version.json", update: `update-${environment}` },
    });

  it.each([
    ["beta", "expo@1.0.0"],
    ["store", "main"],
  ])(
    "given %s, when its jobs are built, then EAS gets that profile and CI ships %s",
    (environment, ref) => {
      const [build, update] = jobsOn(environment);

      expect(build?.local[0]?.args.join(" ")).toContain(`--profile ${environment}`);
      expect(update?.local[0]?.env).toEqual({ APP_VARIANT: environment });
      expect(update?.ci).toEqual({ ref });
    },
  );
});
