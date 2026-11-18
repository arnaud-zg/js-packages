import { describe, expect, it } from "vitest";

import type { Requirement } from "../../ports/delivery.port";
import type { Release } from "../config/loadRelease";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { memoryRepository } from "../../testing/memoryRepository";
import { doctor } from "../doctor";

// shiplane doctor over a release composed in memory. The shell is a recording Fake: every check and
// every fix is answered from what a test seeds, and nothing runs on this machine.

const CONFIG = "export default defineRelease({ modules: [] });\n";
const SCHEMA = "node_modules/.cache/shiplane/schema.json";

const REPO = {
  "shiplane.config.ts": CONFIG,
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  "apps/api/package.json": JSON.stringify({ name: "@acme/api", version: "1.0.0" }),
  "apps/api/shiplane.unit.yml": "module: backend-service\nservice: api\n",
};

const given = ({
  files = REPO,
  interactive = true,
  requirements = [],
  renames,
}: {
  files?: Record<string, string>;
  interactive?: boolean;
  requirements?: Requirement[];
  renames?: Release["renames"];
} = {}) => {
  const repo = memoryRepository(files, [serverHostingFake(), staticHostingFake()], { interactive });
  const load = repo.context.load;
  const context = {
    ...repo.context,
    load: async (): Promise<Release> => ({
      ...(await load()),
      ...(renames ? { renames } : {}),
      features: [
        {
          type: "feature" as const,
          name: "checks",
          adapters: [],
          requirements: () => requirements,
          afterShip: () => Promise.resolve([]),
        },
      ],
    }),
  };
  return { ...repo, context };
};

const need = (label: string, check: string, fix?: Requirement["fix"]): Requirement => {
  const [command = "", ...args] = check.split(" ");
  return { label, check: { command, args }, ...(fix ? { fix } : {}) };
};

describe("Feature: checking the release is ready to ship", () => {
  it("given a healthy release, when the person runs doctor, then it shows the ship order, warns of a module no app uses and passes", async () => {
    const { context, output, files } = given();

    expect(await doctor(context)).toBe(true);

    expect(output.lines).toEqual([
      "",
      "◆  shiplane doctor",
      "│  Order  1 api · Latest",
      "│  ! web-app  no app names it: module: web-app in a shiplane.unit.yml",
      "└  Next: shiplane status",
    ]);
    expect(files.read(SCHEMA)).toContain('"backend-service"');
  });

  it("given no app to ship, when the person runs doctor, then no ship order is shown", async () => {
    const { context, output } = given({ files: { "shiplane.config.ts": CONFIG } });

    await doctor(context);

    expect(output.text).not.toContain("Order");
  });

  it("given files under an old name, when the person runs doctor, then each rename is suggested and it still passes", async () => {
    const { context, output } = given({
      renames: [{ from: "release.config.ts", to: "shiplane.config.ts" }],
    });

    expect(await doctor(context)).toBe(true);

    expect(output.lines).toContain(
      "│  ! rename release.config.ts to shiplane.config.ts: the old name still works for now",
    );
  });

  it("given a release with config problems, when the person runs doctor, then each shows its file, line and hint, no tool is checked and it fails", async () => {
    const { context, output, shell } = given();
    const load = context.load;
    const broken = {
      ...context,
      load: async () => ({
        ...(await load()),
        problems: [
          { file: "apps/api/shiplane.unit.yml", line: 3, message: "unknown key", hint: "see docs" },
          { file: "shiplane.config.ts", message: "no flow" },
        ],
      }),
    };

    expect(await doctor(broken)).toBe(false);

    expect(output.lines).toEqual([
      "",
      "◆  shiplane doctor",
      "✗  apps/api/shiplane.unit.yml:3  unknown key",
      "   see docs",
      "✗  shiplane.config.ts  no flow",
    ]);
    expect(shell.calls).toEqual([]);
  });

  it("given the same tool needed twice and installed, when the person runs doctor, then it is checked once from the repository root and shown passing", async () => {
    const { context, output, shell } = given({
      requirements: [need("git", "git --version"), need("git", "git --version")],
    });

    expect(await doctor(context)).toBe(true);

    expect(output.lines.filter((line) => line.includes("git"))).toEqual(["│  ✓ git"]);
    expect(shell.calls).toEqual([
      { command: "git", args: ["--version"], cwd: "/memory/acme", env: undefined },
    ]);
  });

  it("given missing tools and sign-ins, when the person runs doctor, then each says what fixes it, only the fixes they accept run, and it fails", async () => {
    const { context, output, prompter, shell } = given({
      requirements: [
        need("GitHub sign-in", "gh auth status", { command: "gh", args: ["auth", "login"] }),
        need("EAS CLI", "eas --version", { command: "eas", args: ["login"] }),
        need("Docker", "docker info"),
        need("Fly sign-in", "flyctl auth whoami", {
          command: "flyctl",
          args: ["auth", "login"],
          cwd: "apps/api",
          env: { FLY_ORG: "acme" },
        }),
      ],
    });
    shell
      .seed("gh auth status", { status: 1 })
      .seed("eas --version", { status: 127 })
      .seed("docker info", { status: 1 })
      .seed("flyctl auth whoami", { status: 2 });
    prompter.answer(false, true);

    expect(await doctor(context)).toBe(false);

    expect(output.lines).toContain("│  ✗ GitHub sign-in  fix: gh auth login");
    expect(output.lines).toContain("│  ✗ EAS CLI  not installed: eas");
    expect(output.lines).toContain("│  ✗ Docker  not available here");
    expect(output.lines).toContain("│  ✗ Fly sign-in  fix: FLY_ORG=acme flyctl auth login");
    expect(prompter.asked).toEqual([
      "Run gh auth login now?",
      "Run FLY_ORG=acme flyctl auth login now?",
    ]);
    expect(shell.calls.filter(({ args }) => args.includes("login"))).toEqual([
      {
        command: "flyctl",
        args: ["auth", "login"],
        cwd: "/memory/acme/apps/api",
        env: { FLY_ORG: "acme" },
      },
    ]);
    expect(output.lines.at(-1)).toBe("└  Next: shiplane doctor");
  });

  it("given a failing sign-in and no terminal, when doctor runs, then the fix is not offered", async () => {
    const { context, prompter, shell } = given({
      interactive: false,
      requirements: [
        need("GitHub sign-in", "gh auth status", { command: "gh", args: ["auth", "login"] }),
      ],
    });
    shell.seed("gh auth status", { status: 1 });

    expect(await doctor(context)).toBe(false);

    expect(prompter.asked).toEqual([]);
    expect(shell.calls).toHaveLength(1);
  });

  it("given a missing tool whose fix needs that tool, when the person runs doctor, then the fix is not offered", async () => {
    const { context, prompter, shell } = given({
      requirements: [
        need("GitHub sign-in", "gh auth status", { command: "gh", args: ["auth", "login"] }),
      ],
    });
    shell.seed("gh auth status", { status: 127 });

    expect(await doctor(context)).toBe(false);

    expect(prompter.asked).toEqual([]);
  });
});
