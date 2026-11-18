import { describe, expect, it } from "vitest";

import { memoryRepository } from "../../testing/memoryRepository";
import { newAdapter } from "../newAdapter";

// shiplane adapter new <name>, over a repository held in memory: nothing on disk is written.

const CONFIG =
  'import { defineRelease } from "shiplane";\n\nexport default defineRelease({\n  modules: [],\n});\n';

const given = (files: Record<string, string> = { "shiplane.config.ts": CONFIG }) =>
  memoryRepository(files, []);

describe("Feature: writing my own server hosting adapter", () => {
  it("given a set-up repository, when the person scaffolds an adapter, then its file, its contract test and a module shipping with it are written", async () => {
    const { context, files, output } = given();

    expect(await newAdapter(context, "my-host")).toBe(true);

    expect(files.read("release/adapters/my-host.ts"))
      .toBe(`import { defineServerHosting, z } from "shiplane";

/** Hosts a server on my-host. Replace the command with the one that deploys it. */
export const myHostServerHosting = () =>
  defineServerHosting({
    name: "my-host",
    settings: z.object({
      service: z.string().describe("What to deploy"),
    }),
    describe: ({ options }) => \`\${options.service} on my-host\`,
    jobs: ({ tag, options }) => [
      {
        label: \`deploy \${tag} to \${options.service}\`,
        local: [{ command: "echo", args: ["deploy", options.service] }],
      },
    ],
  });
`);
    expect(files.read("release/adapters/my-host.test.ts"))
      .toBe(`import { serverHostingContract, serverHostingFake } from "shiplane/testing";

import { myHostServerHosting } from "./my-host";

// The contract every server host passes, run on this adapter and on the Fake tests use in its place.
serverHostingContract([
  { adapter: myHostServerHosting(), settings: { service: "web-preview" } },
  { adapter: serverHostingFake(), settings: { service: "web-preview" } },
]);
`);
    const config = files.read("shiplane.config.ts") ?? "";
    expect(config).toContain(
      'backendService({ name: "my-host", serverHosting: myHostServerHosting() })',
    );
    expect(config).toContain('import { myHostServerHosting } from "./release/adapters/my-host";');
    expect(output.lines).toEqual([
      "◇  Wrote release/adapters/my-host.ts, its contract test, and a my-host module in shiplane.config.ts",
      "└  Next: point an app at it with module: my-host",
    ]);
  });

  it.each(["My-Host", "1host", "my_host", "-host", "my host", ""])(
    "given the name %j, when the person scaffolds an adapter, then it is refused and nothing is written",
    async (name) => {
      const { context, files, output } = given();

      expect(await newAdapter(context, name)).toBe(false);

      expect(output.lines).toEqual([
        "✗  an adapter name is lowercase words joined by dashes, like my-host",
      ]);
      expect(files.changes).toEqual([]);
    },
  );

  it("given an adapter by that name already, when the person scaffolds it again, then it is refused and their file is left as it was", async () => {
    const { context, files, output } = given({
      "shiplane.config.ts": CONFIG,
      "release/adapters/my-host.ts": "// mine\n",
    });

    expect(await newAdapter(context, "my-host")).toBe(false);

    expect(output.lines).toEqual(["✗  release/adapters/my-host.ts already exists"]);
    expect(files.changes).toEqual([]);
  });

  it("given no config, when the person scaffolds an adapter, then they are told to run setup first and nothing is written", async () => {
    const { context, files, output } = given({});

    expect(await newAdapter(context, "host2")).toBe(false);

    expect(output.lines).toEqual([
      "✗  shiplane.config.ts has no modules list to add it to: run shiplane setup first",
    ]);
    expect(files.changes).toEqual([]);
  });
});
