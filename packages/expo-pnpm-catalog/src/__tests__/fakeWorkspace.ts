// A pnpm workspace in a temp folder, with fake `npx` and `pnpm` first on PATH:
// check and sync run their real commands, which only log what they saw and edit the temp files.
import fs from "fs";
import os from "os";
import path from "path";
import { stripVTControlCharacters } from "util";
import { vi } from "vitest";

import type { CatalogPaths, PackageJson } from "../catalogUtils";

const FAKE_NPX = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2).join(" ");
fs.appendFileSync(
  process.env.FAKE_CLI_LOG,
  JSON.stringify({
    command: "npx " + args,
    cwd: process.cwd(),
    appVariant: process.env.APP_VARIANT ?? null,
    packageJson: JSON.parse(fs.readFileSync("package.json", "utf-8")),
  }) + "\\n",
);
if (args === "expo-doctor") process.exit(Number(process.env.FAKE_DOCTOR_EXIT ?? "0"));
if (args === "expo install --fix") {
  const fixes = JSON.parse(process.env.FAKE_EXPO_FIX ?? "{}");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(fixes)) {
      if (!pkg[section] || !(name in pkg[section])) continue;
      if (version === null) delete pkg[section][name];
      else pkg[section][name] = version;
    }
  }
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\\n");
}
`;

const FAKE_PNPM = `#!/usr/bin/env node
const fs = require("fs");
fs.appendFileSync(
  process.env.FAKE_CLI_LOG,
  JSON.stringify({ command: "pnpm " + process.argv.slice(2).join(" "), cwd: process.cwd() }) + "\\n",
);
`;

export const WORKSPACE_YAML = `packages:
  - apps/*
  - packages/*
catalog:
  some-lib: ^3.0.0
catalogs:
  expo:
    # pinned by the Expo SDK
    expo-camera: ~17.0.10
    "@expo/vector-icons": ^15.0.3
    react-native-safe-area-context: ~5.6.0
`;

export const APP_PACKAGE_JSON: PackageJson = {
  name: "@/app",
  dependencies: {
    "expo-camera": "catalog:expo",
    react: "19.2.0-rc.1-x",
    ghost: "catalog:nope",
  },
  devDependencies: {
    "@expo/vector-icons": "catalog:expo",
  },
};

export const UI_PACKAGE_JSON: PackageJson = {
  name: "@/ui",
  dependencies: {
    "some-lib": "catalog:",
    "expo-camera": "catalog:expo",
    "react-native-safe-area-context": "catalog:expo",
    // Neither counts: one is pinned outside the catalogs, the other is in no catalog.
    "@expo/vector-icons": "15.0.0",
    "left-pad": "catalog:",
  },
};

export type CliCall = {
  command: string;
  cwd: string;
  appVariant?: string | null;
  packageJson?: PackageJson;
};

export type FakeWorkspace = {
  rootDir: string;
  appDir: string;
  paths: CatalogPaths;
  /** The console lines printed so far, without colours. */
  output: string[];
  /** The spinner lines written to stderr so far, without colours. */
  spinners: string[];
  calls: () => CliCall[];
  readAppPackageJson: () => string;
  readWorkspaceYaml: () => string;
  /** What `npx expo install --fix` sets each package to; null removes it. */
  expoFixes: (fixes: Record<string, string | null>) => void;
  doctorExitCode: (code: number) => void;
  cleanup: () => void;
};

export type FakeWorkspaceSetup = {
  workspaceYaml?: string;
  appPackageJson?: PackageJson;
  /** Expo app folder, relative to the root; "." puts the app at the root. */
  appFolder?: string;
  siblings?: Record<string, PackageJson>;
};

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

export function createFakeWorkspace({
  workspaceYaml = WORKSPACE_YAML,
  appPackageJson = APP_PACKAGE_JSON,
  appFolder = path.join("apps", "expo"),
  siblings = { "packages/ui": UI_PACKAGE_JSON },
}: FakeWorkspaceSetup = {}): FakeWorkspace {
  const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-pnpm-catalog-")));
  const rootDir = path.join(sandbox, "workspace");
  const binDir = path.join(sandbox, "bin");
  const logPath = path.join(sandbox, "cli.log");
  const appDir = path.join(rootDir, appFolder);
  const paths: CatalogPaths = {
    rootDir,
    appDir,
    workspaceYamlPath: path.join(rootDir, "pnpm-workspace.yaml"),
    packageJsonPath: path.join(appDir, "package.json"),
  };

  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(rootDir, { recursive: true });
  writeExecutable(path.join(binDir, "npx"), FAKE_NPX);
  writeExecutable(path.join(binDir, "pnpm"), FAKE_PNPM);
  fs.writeFileSync(paths.workspaceYamlPath, workspaceYaml);
  writeJson(paths.packageJsonPath, appPackageJson);
  for (const [folder, pkg] of Object.entries(siblings)) {
    writeJson(path.join(rootDir, folder, "package.json"), pkg);
  }

  vi.stubEnv("PATH", `${binDir}${path.delimiter}${process.env.PATH ?? ""}`);
  vi.stubEnv("FAKE_CLI_LOG", logPath);
  vi.stubEnv("FAKE_EXPO_FIX", "{}");
  vi.stubEnv("FAKE_DOCTOR_EXIT", "0");

  const output: string[] = [];
  const spinners: string[] = [];
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    output.push(stripVTControlCharacters(args.map(String).join(" ")));
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    spinners.push(stripVTControlCharacters(String(chunk)).trimEnd());
    return true;
  });

  return {
    rootDir,
    appDir,
    paths,
    output,
    spinners,
    calls: () =>
      fs.existsSync(logPath)
        ? fs
            .readFileSync(logPath, "utf-8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as CliCall)
        : [],
    readAppPackageJson: () => fs.readFileSync(paths.packageJsonPath, "utf-8"),
    readWorkspaceYaml: () => fs.readFileSync(paths.workspaceYamlPath, "utf-8"),
    expoFixes: (fixes) => vi.stubEnv("FAKE_EXPO_FIX", JSON.stringify(fixes)),
    doctorExitCode: (code) => vi.stubEnv("FAKE_DOCTOR_EXIT", String(code)),
    cleanup: () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      fs.rmSync(sandbox, { recursive: true, force: true });
    },
  };
}
