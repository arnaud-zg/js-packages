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

describe("recognising an app EAS ships", () => {
  it("given no eas.json, when init looks at the folder, then EAS is not offered", () => {
    expect(eas.detect?.(folder({ "package.json": "{}" }))).toBeNull();
  });

  it("given eas.json and the usual update scripts, when init looks at the folder, then it is found with the plain script picked over the gated one", () => {
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
      options: { update: { preview: "eas:update:preview", production: "eas:update:production" } },
    });
  });

  it("given only a gated production script, when init looks at the folder, then the gated one is picked", () => {
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

  it("given update scripts under other names, when init looks at the folder, then the ones naming update and the environment are picked", () => {
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

  it("given an update script for preview only, when init looks at the folder, then no update script is set and init asks for one", () => {
    const scanned = withScripts({ "eas:update:preview": "eas update" });
    const found = eas.detect?.(scanned);

    expect(found?.options).toEqual({});
    expect(eas.questions?.(scanned, found?.options ?? {}, "acme/app")).toEqual([
      { key: "update", message: "Package script that publishes an update?", initial: "eas:update" },
    ]);
  });

  it("given eas.json and no package.json, when init looks at the folder, then it is found with nothing to set", () => {
    expect(eas.detect?.(folder({ "eas.json": "{}" }))).toEqual({
      certainty: "found",
      reason: "eas.json",
      options: {},
    });
  });

  it("given the update scripts were found, when init asks its questions, then nothing is asked", () => {
    const scanned = withScripts({ "eas:update:preview": "x", "eas:update:production": "y" });

    expect(eas.questions?.(scanned, eas.detect?.(scanned)?.options ?? {}, "acme/app")).toEqual([]);
  });
});

describe("what EAS needs before it ships an app", () => {
  const unit = testUnit("expo", {
    module: "mobile-app",
    dir: "apps/expo",
    options: { versionFile: "binary-version.json", update: "eas:update" },
  });

  it("given an app in its folder, when its requirements are listed, then eas whoami checks the login there and eas login fixes it", () => {
    expect(eas.requirements?.(unit)).toEqual([
      {
        label: "eas",
        check: { command: "pnpm", args: ["exec", "eas", "whoami"], cwd: "apps/expo" },
        fix: { command: "pnpm", args: ["exec", "eas", "login"], cwd: "apps/expo" },
      },
    ]);
  });

  it("given a version file option, when the version files are listed, then it is the one in the app's folder", () => {
    const port = eas.create({ root: "/repo", shell: new RecordingShell() });

    expect(port.versionFiles?.(unit, [unit])).toEqual(["apps/expo/binary-version.json"]);
  });
});
