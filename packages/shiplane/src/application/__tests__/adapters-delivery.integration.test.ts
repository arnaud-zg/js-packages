import { describe, expect, it } from "vitest";
import { z } from "zod";

import { RecordingShell } from "../../adapters/shell/__fakes__/shell.fake";
import {
  defineMobileDistribution,
  definePackageRegistry,
  defineServerHosting,
  defineStaticHosting,
  shellServerHosting,
} from "../../index";
import { testUnit } from "../../testing/releaseContext";

const CONTEXT = { root: "/repo", shell: new RecordingShell() };

const inputFor = (options: Record<string, unknown>) => ({
  unit: testUnit("api"),
  tag: "api@1.2.0",
  environment: "production" as const,
  options,
  commit: "abc1234",
  defaultBranch: "main",
});

describe("shipping a server with a deploy command of one's own", () => {
  it("given a deploy command, when a tag ships, then the release names the command as where it lands and runs it once, recording the deploy", () => {
    const port = shellServerHosting().create(CONTEXT);

    const jobs = port.jobs(inputFor({ deploy: ["npx", "my-tool", "deploy"] }));

    expect(port.describe(inputFor({ deploy: ["flyctl", "deploy"] }))).toBe("flyctl deploy");
    expect(jobs).toEqual([
      {
        label: "ship api@1.2.0: npx my-tool deploy",
        local: [{ command: "npx", args: ["my-tool", "deploy"] }],
        ci: { ref: "api@1.2.0" },
        record: true,
      },
    ]);
  });

  it("given an app's unit file, when its settings are checked, then a deploy command is required, once or per environment, and a url is optional", () => {
    const { settings, name, capability } = shellServerHosting();

    expect({ name, capability }).toEqual({ name: "shell", capability: "server-hosting" });
    expect(settings.safeParse({ deploy: [] }).success).toBe(false);
    expect(settings.safeParse({}).success).toBe(false);
    expect(
      settings.safeParse({
        deploy: { preview: ["pnpm", "deploy:preview"], production: ["pnpm", "deploy"] },
        url: "https://api.example.com",
      }).success,
    ).toBe(true);
  });
});

describe("writing a delivery adapter of one's own", () => {
  const authored = {
    name: "custom",
    settings: z.object({ site: z.string() }),
    typicalMinutes: 3,
    decidedBy: { platform: "the store", choice: "update", check: "status" },
    detect: () => null,
    questions: () => [],
    requirements: () => [],
    describe: () => "custom",
    jobs: () => [],
  };

  it("given an author's static host with every part, when shiplane loads it, then each part is kept and the release sees a static host", () => {
    const env = () => ({ names: () => Promise.resolve([]) });

    const adapter = defineStaticHosting({ ...authored, env } as never);
    const port = adapter.create(CONTEXT);

    expect(adapter).toMatchObject({
      name: "custom",
      capability: "static-hosting",
      settings: authored.settings,
      typicalMinutes: 3,
      decidedBy: authored.decidedBy,
      detect: authored.detect,
      questions: authored.questions,
      requirements: authored.requirements,
      env,
    });
    expect(port).toMatchObject({
      capability: "static-hosting",
      describe: authored.describe,
      jobs: authored.jobs,
    });
    expect(port).not.toHaveProperty("name");
    expect(port).not.toHaveProperty("settings");
  });

  const deciding = {
    decide: () => Promise.resolve({ action: "none" as const, status: "live" }),
    live: () => Promise.resolve(true),
  };

  it("given an author's adapter for each kind of delivery and no env reader, when shiplane loads them, then each is the kind it was defined as and none offers env", () => {
    expect("env" in defineServerHosting(authored)).toBe(false);

    const kinds = [
      defineServerHosting(authored),
      defineStaticHosting(authored),
      defineMobileDistribution({ ...authored, ...deciding }),
      definePackageRegistry({ ...authored, ...deciding, publishedName: () => "x" }),
    ].map((adapter) => [adapter.capability, adapter.create(CONTEXT).capability]);

    expect(kinds).toEqual([
      ["server-hosting", "server-hosting"],
      ["static-hosting", "static-hosting"],
      ["mobile-distribution", "mobile-distribution"],
      ["package-registry", "package-registry"],
    ]);
  });
});
