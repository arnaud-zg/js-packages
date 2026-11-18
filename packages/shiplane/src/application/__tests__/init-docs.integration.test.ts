import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AnyDeliveryAdapter } from "../../modules/suggest";
import { defineServerHosting } from "../../adapters/defineDelivery";
import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { memoryRepository } from "../../testing/memoryRepository";
import { docsFor } from "../docsFor";

// shiplane docs <module or adapter>, over a release composed in memory from the adapters given.

const tuned = defineServerHosting({
  name: "tuned",
  settings: z.object({
    region: z.string().default("cdg").describe("Where it runs"),
    sizes: z.array(z.number()).default([1, 2]).describe("Machine sizes"),
    a: z.string().optional().describe("A short key"),
  }),
  describe: () => "",
  jobs: () => [],
});

const CONFIG = "export default defineRelease({ modules: [] });\n";

/** A release composing a module per adapter given; `offered` are those setup offers on its own. */
const given = (composed: AnyDeliveryAdapter[], offered: AnyDeliveryAdapter[] = []) => {
  const repo = memoryRepository({ "shiplane.config.ts": CONFIG }, composed);
  return { ...repo, context: { ...repo.context, adapters: offered } };
};

describe("Feature: reading which keys a module or adapter takes", () => {
  it("given a module name, when the person reads its docs, then each key shows its description and whether it is required", async () => {
    const { context, output } = given([serverHostingFake()]);

    expect(await docsFor(context, "backend-service")).toBe(true);

    expect(output.lines).toEqual([
      "",
      "  module: backend-service  with fake",
      "",
      `  ${"service".padEnd(10)}The service it deploys`,
      `  ${" ".repeat(10)}required`,
      `  ${"url".padEnd(10)}Where it answers, for other apps to read`,
      `  ${" ".repeat(10)}optional`,
      "",
    ]);
  });

  it("given an adapter setup offers, when the person reads its docs, then each default is shown as they would write it", async () => {
    const { context, output } = given([], [tuned]);

    expect(await docsFor(context, "tuned")).toBe(true);

    expect(output.lines).toEqual([
      "",
      "  tuned  adapter",
      "",
      `  ${"region".padEnd(10)}Where it runs`,
      `  ${" ".repeat(10)}default: cdg`,
      `  ${"sizes".padEnd(10)}Machine sizes`,
      `  ${" ".repeat(10)}default: [1,2]`,
      `  ${"a".padEnd(10)}A short key`,
      `  ${" ".repeat(10)}optional`,
      "",
    ]);
  });

  it("given an adapter only their config uses, when the person reads its docs, then its keys are still shown", async () => {
    const { context, output } = given([
      {
        ...serverHostingFake(),
        name: "fly",
        settings: z.object({ "machine-size-name": z.string() }),
      },
    ]);

    expect(await docsFor(context, "fly")).toBe(true);

    expect(output.lines[1]).toBe("  fly  adapter");
    expect(output.lines[3]).toBe(`  ${"machine-size-name".padEnd(19)}`);
  });

  it("given a name nothing knows, when the person asks for its docs, then every module and adapter they could ask for is listed once", async () => {
    const { context, output } = given([serverHostingFake()], [tuned, serverHostingFake()]);

    expect(await docsFor(context, "nope")).toBe(false);

    expect(output.lines).toEqual(['✗  no module or adapter "nope": backend-service, tuned, fake']);
  });
});
