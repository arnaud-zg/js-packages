import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RecordingShell } from "shiplane/testing";
import { afterEach, describe, expect, it } from "vitest";

import { changesetsVersioning } from "../changesets-versioning.adapter";

let root: string | undefined;
afterEach(() => root && fs.rmSync(root, { recursive: true, force: true }));

const setUp = () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "release-changesets-"));
  fs.mkdirSync(path.join(root, ".changeset"));
  const shell = new RecordingShell().seed("gh auth token", { stdout: "gho_signed_in\n" });
  return { shell, port: changesetsVersioning().create({ root, shell }) };
};

const versionCall = (shell: RecordingShell) =>
  shell.calls.find(({ args }) => args.includes("version"));

describe("changesets versioning a release", () => {
  it("given no GITHUB_TOKEN and gh signed in, when versions are applied, then changesets gets gh's token", async () => {
    const { shell, port } = setUp();

    await port.apply([], []);

    expect(versionCall(shell)?.env).toEqual({ GITHUB_TOKEN: "gho_signed_in" });
  });

  it("given GITHUB_TOKEN already set, when versions are applied, then it is left as it is", async () => {
    const { shell, port } = setUp();
    shell.seedEnv({ GITHUB_TOKEN: "ghp_own" });

    await port.apply([], []);

    expect(versionCall(shell)?.env).toBeUndefined();
    expect(shell.calls.some(({ command }) => command === "gh")).toBe(false);
  });
});

describe("changesets versioning's fixed groups", () => {
  const writeJson = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(root ?? "", file)), { recursive: true });
    fs.writeFileSync(path.join(root ?? "", file), JSON.stringify(value));
  };
  const workspace = (fixed: string[][]) => {
    const made = setUp();
    writeJson("package.json", { name: "acme", private: true });
    fs.writeFileSync(path.join(root ?? "", "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    ["kit", "kit-git", "app"].forEach((name) =>
      writeJson(`packages/${name}/package.json`, {
        name: name === "kit" ? "kit" : `@kit/${name.replace("kit-", "")}`,
        version: "1.0.0",
      }),
    );
    writeJson(".changeset/config.json", { fixed });
    return made;
  };

  it("given a fixed group with a pattern, when read, then it names each package the pattern matches", async () => {
    const { port } = workspace([["kit", "@kit/*"]]);

    const groups = (await port.fixedGroups?.()) ?? [];

    expect(groups.map((group) => [...group].sort())).toEqual([["@kit/app", "@kit/git", "kit"]]);
  });

  it("given no changesets config, when read, then nothing is fixed", async () => {
    const { port } = setUp();

    await expect(port.fixedGroups?.()).resolves.toEqual([]);
  });
});
