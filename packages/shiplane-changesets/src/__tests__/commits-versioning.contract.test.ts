import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RecordingShell, versioningContract } from "shiplane/testing";
import { afterAll } from "vitest";

import { commitsVersioning } from "../commits-versioning.adapter";

const WORKSPACE = { name: "@acme/api", folder: "apps/api" };

const made: string[] = [];
afterAll(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

// A history with no commits since the version: only what the contract writes is pending.
versioningContract("commits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-commits-contract-"));
  made.push(root);
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  fs.mkdirSync(path.join(root, ".changeset"));
  fs.mkdirSync(path.join(root, WORKSPACE.folder), { recursive: true });
  fs.writeFileSync(
    path.join(root, WORKSPACE.folder, "package.json"),
    JSON.stringify({ name: WORKSPACE.name, version: "1.0.0" }),
  );
  const port = commitsVersioning().create({ root, shell: new RecordingShell() });
  return Promise.resolve({ port, workspace: WORKSPACE });
});
