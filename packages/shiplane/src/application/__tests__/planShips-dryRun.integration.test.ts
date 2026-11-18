import { describe, expect, it } from "vitest";

import type { Feature } from "../../modules/module";
import { planShips } from "../planShips";
import { decidingModule, shipWorld } from "./shipWorld";

// `--dry-run`: every command a ship would run, both ways, then what the features would do.

/** A feature that follows up on each unit it is told shipped, and keeps what it was told. */
const notes = (told: string[]): Feature => ({
  type: "feature",
  name: "notes",
  adapters: [],
  afterShip: (_context, shipped) => {
    told.push(...shipped.map(({ tag, environment }) => `${tag} on ${environment}`));
    return Promise.resolve(
      shipped.map(({ tag }) => ({ label: `comment on ${tag}`, run: () => Promise.resolve() })),
    );
  },
});

describe("Feature: previewing with --dry-run every command a ship would run", () => {
  it("given api tagged, when a ship is previewed, then it shows where api lands and the commands of both ways, the deploy record included, and runs nothing", async () => {
    // given
    const { context, output, shell, ci } = shipWorld(["api"]);

    // when
    await planShips(context, "preview");

    // then
    expect(output.lines).toEqual(
      expect.arrayContaining([
        "  Plan  ·  preview  · nothing runs",
        "  api@0.1.0 → acme-api (fake)",
        "    this machine",
        "      echo deploy acme-api api@0.1.0",
        "      then record api@0.1.0 on preview in GitHub Deployments",
        "    GitHub Actions",
        "      gh workflow run ship.yml --ref api@0.1.0 -f units=api -f environment=preview",
      ]),
    );
    expect(output.lines.at(-1)).toBe("");
    expect(shell.calls).toEqual([]);
    expect(ci.received).toEqual([]);
  });

  it("given web not tagged yet, when a ship to production is previewed, then web says to release it first", async () => {
    // given
    const { context, output, source } = shipWorld(["api", "web"]);
    source.seed({ tags: { "api@0.1.0": "c-api" } });

    // when
    await planShips(context, "production");

    // then
    expect(output.lines).toContain(
      "  web@0.1.0 → acme-web (fake)  (not tagged yet: release first)",
    );
    expect(output.lines).toContain("  api@0.1.0 → acme-api (fake)");
    expect(output.lines).toContain("  Plan  ·  production  · nothing runs");
  });

  it("given a CI pipeline with no command line for its dispatch, when a ship is previewed, then it says in words what it would dispatch", async () => {
    // given
    const { context, output, ci } = shipWorld(["api"]);
    ci.dispatchLine = undefined as unknown as typeof ci.dispatchLine;

    // when
    await planShips(context, "preview");

    // then
    expect(output.lines).toContain(
      "      dispatch ship.yml on api@0.1.0 with units=api, environment=preview",
    );
  });

  it("given a store upload that only runs on this machine and records nothing, when a ship is previewed, then only the upload command is shown", async () => {
    // given
    const deciding = decidingModule(() => ({ action: "none", status: "" }), {
      ship: () => ({
        where: "the store",
        jobs: [{ label: "upload", local: [{ command: "upload", args: ["a"] }] }],
      }),
    });
    const { context, output } = shipWorld([], { deciding, decided: ["a"] });

    // when
    await planShips(context, "preview");

    // then
    expect(output.lines).toContain("  a@0.1.0 → the store");
    expect(output.lines).toContain("      upload a");
    expect(output.text).not.toContain("then record");
    expect(output.text).not.toContain("GitHub Actions");
  });

  it("given a feature that follows up on ships, when a ship is previewed, then it lists the follow-ups of the tagged apps only", async () => {
    // given
    const told: string[] = [];
    const tool = decidingModule(() => ({ action: "none", status: "" }), {
      name: "tool",
      releaseOnly: true,
    });
    const { context, output, source } = shipWorld(["api", "web"], {
      deciding: tool,
      decided: ["cli"],
    });
    context.release.features = [notes(told)];
    source.seed({ tags: { "api@0.1.0": "c-api", "cli@0.1.0": "c-cli" } });

    // when
    await planShips(context, "preview");

    // then
    expect(told).toEqual(["api@0.1.0 on preview"]);
    expect(output.lines).toContain("  Then  once shipped");
    expect(output.lines).toContain("    comment on api@0.1.0");
  });

  it("given a feature with nothing to follow up, when a ship is previewed, then no follow-up section is shown", async () => {
    // given
    const { context, output } = shipWorld(["api"]);
    context.release.features = [
      { type: "feature", name: "quiet", adapters: [], afterShip: () => Promise.resolve([]) },
    ];

    // when
    await planShips(context, "preview");

    // then
    expect(output.text).not.toContain("Then");
  });
});
