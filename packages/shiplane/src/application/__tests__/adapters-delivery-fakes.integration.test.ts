import { describe, expect, it } from "vitest";

import type { DecideContext, Requirement } from "../../ports/delivery.port";
import { RecordingShell } from "../../adapters/shell/__fakes__/shell.fake";
import {
  mobileDistributionMemory,
  packageRegistryMemory,
  serverHostingMemory,
  staticHostingMemory,
} from "../../memory";
import { TEST_FLOW } from "../../testing/flow";
import { testUnit } from "../../testing/releaseContext";

const CONTEXT = { root: "/repo", shell: new RecordingShell() };
// The fakes decide from what they were seeded, never from the release around them.
const DECIDE = {} as DecideContext;
const NEED: Requirement = {
  label: "hostctl",
  check: { command: "hostctl", args: ["version"] },
};

const inputFor = (options: Record<string, unknown>, version = "1.0.0") => ({
  unit: testUnit("app", { version }),
  tag: `app@${version}`,
  environment: "preview" as const,
  flow: TEST_FLOW,
  options,
  commit: "abc1234",
  defaultBranch: "main",
});

describe("rehearsing a delivery in memory while a custom adapter is written", () => {
  it("given an in-memory server host, when a tag ships, then one recorded job echoes the deploy and the host remembers what it shipped", () => {
    const adapter = serverHostingMemory();
    const port = adapter.create(CONTEXT);
    adapter.fake.seed({ requirements: [NEED] });

    const jobs = port.jobs(inputFor({ service: "api" }));

    expect({
      name: adapter.name,
      capability: adapter.capability,
      minutes: adapter.typicalMinutes,
      describe: port.describe(inputFor({ service: "api" })),
      jobs,
      received: adapter.fake.received,
      needs: adapter.requirements?.(testUnit("app")),
    }).toEqual({
      name: "fake",
      capability: "server-hosting",
      minutes: 1,
      describe: "api (fake)",
      jobs: [
        {
          label: "deploy app@1.0.0 to api (fake)",
          local: [{ command: "echo", args: ["deploy", "api", "app@1.0.0"] }],
          ci: { ref: "app@1.0.0" },
          record: true,
        },
      ],
      received: [{ tag: "app@1.0.0", environment: "preview", service: "api" }],
      needs: [NEED],
    });
  });

  it("given an in-memory static host, when a tag ships, then one recorded job echoes the upload of that site", () => {
    const adapter = staticHostingMemory();
    const port = adapter.create(CONTEXT);
    adapter.fake.seed({ requirements: [NEED] });

    expect({
      name: adapter.name,
      capability: adapter.capability,
      minutes: adapter.typicalMinutes,
      describe: port.describe(inputFor({ site: "admin" })),
      jobs: port.jobs(inputFor({ site: "admin" })),
      received: adapter.fake.received,
      needs: adapter.requirements?.(testUnit("app")),
    }).toEqual({
      name: "fake",
      capability: "static-hosting",
      minutes: 1,
      describe: "admin (fake, preview)",
      jobs: [
        {
          label: "build app@1.0.0 and upload it to admin (fake)",
          local: [{ command: "echo", args: ["upload", "admin", "app@1.0.0"] }],
          ci: { ref: "app@1.0.0" },
          record: true,
        },
      ],
      received: [{ tag: "app@1.0.0", environment: "preview", site: "admin" }],
      needs: [NEED],
    });
  });

  it("given a mobile app live at one version, when that version and a newer one are released, then only the newer one ships an over-the-air update", async () => {
    const adapter = mobileDistributionMemory();
    const port = adapter.create(CONTEXT);
    adapter.fake.seed({
      live: { preview: "1.0.0" },
      health: { "app@1.0.0": { ok: true, summary: "0 crashes" } },
      requirements: [NEED],
    });

    const same = await port.decide(DECIDE, inputFor({ app: "mobile" }));
    const newer = await port.decide(DECIDE, inputFor({ app: "mobile" }, "1.1.0"));

    expect(same).toEqual({ action: "none", status: "app 1.0.0 is on preview" });
    expect(newer).toEqual({
      action: "ship",
      kind: "update",
      jobs: [
        {
          label: "publish app@1.1.0 to mobile on preview (fake)",
          local: [{ command: "echo", args: ["update", "mobile", "app@1.1.0"] }],
          ci: { ref: "app@1.1.0" },
        },
      ],
    });
    expect({
      live: [
        await port.live?.(DECIDE, inputFor({ app: "mobile" })),
        await port.live?.(DECIDE, inputFor({ app: "mobile" }, "2.0.0")),
      ],
      health: [
        await port.health?.(DECIDE, inputFor({ app: "mobile" })),
        await port.health?.(DECIDE, inputFor({ app: "mobile" }, "2.0.0")),
      ],
      inspect: await port.inspect?.(DECIDE, inputFor({ app: "mobile" })),
      describe: port.describe(inputFor({ app: "mobile" })),
      decidedBy: adapter.decidedBy,
      minutes: adapter.typicalMinutes,
      capability: adapter.capability,
      needs: adapter.requirements?.(testUnit("app")),
    }).toEqual({
      live: [true, false],
      health: [{ ok: true, summary: "0 crashes" }, null],
      inspect: { live: "1.0.0" },
      describe: "mobile on preview (fake)",
      decidedBy: {
        platform: "the fake platform",
        choice: "update or nothing",
        check: "shiplane status",
      },
      minutes: 1,
      capability: "mobile-distribution",
      needs: [NEED],
    });
    expect(adapter.fake.received.map(({ stage, tag }) => `${stage} ${tag}`)).toEqual([
      "decide app@1.0.0",
      "decide app@1.1.0",
      "jobs app@1.1.0",
      "health app@1.0.0",
      "health app@2.0.0",
      "inspect app@1.0.0",
    ]);
  });

  it("given a mobile app never shipped, when its status is checked, then nothing is live", async () => {
    const port = mobileDistributionMemory().create(CONTEXT);

    expect(await port.inspect?.(DECIDE, inputFor({ app: "mobile" }))).toEqual({ live: null });
  });

  it("given a package published at one version, when that version and a newer one are released, then only the newer one publishes, under its dist-tag", async () => {
    const adapter = packageRegistryMemory();
    const port = adapter.create(CONTEXT);
    adapter.fake.seed({ published: ["@acme/app@1.0.0"], requirements: [NEED] });
    const options = adapter.settings.parse({});

    const same = await port.decide(DECIDE, inputFor(options));
    const newer = await port.decide(DECIDE, inputFor({ tag: "next" }, "1.1.0"));

    expect(same).toEqual({ action: "none", status: "@acme/app@1.0.0 is published" });
    expect(newer).toEqual({
      action: "ship",
      kind: "publish",
      jobs: [
        {
          label: "publish @acme/app@1.1.0 under next (fake)",
          local: [{ command: "echo", args: ["publish", "@acme/app", "1.1.0"] }],
          needsBuild: true,
        },
      ],
    });
    expect({
      describe: port.describe(inputFor(options)),
      name: port.publishedName?.(inputFor(options)),
      live: [
        await port.live(DECIDE, inputFor(options)),
        await port.live(DECIDE, inputFor(options, "3.0.0")),
      ],
      received: adapter.fake.received.map(({ stage, tag }) => `${stage} ${tag}`),
      needs: adapter.requirements?.(testUnit("app")),
      capability: adapter.capability,
      minutes: adapter.typicalMinutes,
    }).toEqual({
      describe: "@acme/app (fake, latest)",
      name: "@acme/app",
      live: [true, false],
      received: ["decide app@1.0.0", "decide app@1.1.0", "jobs app@1.1.0"],
      needs: [NEED],
      capability: "package-registry",
      minutes: 1,
    });
  });

  it("given a registry where nothing is published, when a release checks it, then nothing is live and no tool is required", async () => {
    const adapter = packageRegistryMemory();
    adapter.fake.seed({});

    expect(adapter.requirements?.(testUnit("app"))).toEqual([]);
    await expect(adapter.fake.live(DECIDE, inputFor({}))).resolves.toBe(false);
  });
});
