import { describe, expect, it } from "vitest";

import type { Shipment } from "../askPath";
import { testContext, testUnit } from "../../testing/releaseContext";
import { askPaths } from "../askPath";

// How each unit ships, asked over a Fake CI pipeline seeded with this month's minutes. The clock is
// fixed on 12 October 2026.

const shipment = (
  app: string,
  { workflows = [], typicalMinutes }: { workflows?: string[]; typicalMinutes?: number } = {},
): Shipment => ({
  item: { app, tag: `${app}@1.0.0`, kind: "deploy" },
  workflows,
  typicalMinutes,
});

const given = ({ interactive = true }: { interactive?: boolean } = {}) =>
  testContext({ units: [testUnit("api"), testUnit("web")], interactive });

describe("Feature: choosing between GitHub Actions and this machine for each app", () => {
  it("given no Actions minutes to show, when the person picks how apps ship, then each app is asked in order with GitHub Actions recommended", async () => {
    const { context, prompter, output } = given();
    prompter.answer("ci", "local");

    const paths = await askPaths(context, "production", [shipment("api"), shipment("web")]);

    expect(paths).toEqual(["ci", "local"]);
    expect(prompter.asked).toEqual([
      "How should api@1.0.0 ship to production?",
      "How should web@1.0.0 ship to production?",
    ]);
    expect(prompter.initials["How should api@1.0.0 ship to production?"]).toBe("ci");
    expect(prompter.choices["How should api@1.0.0 ship to production?"]).toEqual([
      {
        value: "ci",
        label: "GitHub Actions",
        hint: "its workflow runs on GitHub Actions, from its tag",
      },
      {
        value: "local",
        label: "this machine",
        hint: "the same commands, run here: no Actions minutes",
      },
    ]);
    expect(output.lines).toEqual([]);
  });

  it("given this month's minutes and measured runs, when the person picks how apps ship, then they see what this release spends and what is left", async () => {
    const { context, prompter, output, ci } = given();
    ci.seed({
      minutes: { used: 500, included: 2000, left: 1500 },
      measured: { "api-a.yml": [2], "api-b.yml": [4] },
    });
    prompter.answer("ci", "ci", "ci");

    await askPaths(context, "preview", [
      shipment("api", { workflows: ["api-a.yml", "api-b.yml"], typicalMinutes: 9 }),
      shipment("web", { typicalMinutes: 4 }),
      shipment("docs"),
    ]);

    expect(output.lines[0]).toBe("");
    expect(output.lines[1]).toBe(
      "  GitHub Actions minutes · October 2026   ● enough minutes this month",
    );
    expect(output.lines[2]).toMatch(/^ {2}[█▒░]{30} {2}1,500 of 2,000 left · 25% used$/);
    expect(output.lines[3]).toBe(
      "  This release: about 12 min on GitHub Actions, about 1,488 left after it",
    );
    expect(output.lines[4]).toBe(
      "    api ~3 (its last runs) · web ~4 (typical, no run yet) · docs ~5 (typical, no run yet)",
    );
    expect(output.lines[5]).toMatch(
      /^ {2}At this pace, with this release, about .* used by October 31/,
    );
    expect(output.lines[6]).toBe("");
    expect(output.lines).toHaveLength(7);
    expect(prompter.choices["How should api@1.0.0 ship to preview?"]?.[0]?.hint).toBe(
      "runs on GitHub Actions from its tag, about 3 of 1,500 minutes left",
    );
    expect(prompter.choices["How should web@1.0.0 ship to preview?"]?.[0]?.hint).toBe(
      "runs on GitHub Actions from its tag, about 4 of 1,500 minutes left",
    );
  });

  it("given a release that spends nothing on GitHub Actions, when the person sees the minutes, then no spend is shown", async () => {
    const { context, output, ci } = given();
    ci.seed({ minutes: { used: 0, included: 2000, left: 2000 } });

    await askPaths(context, "preview", []);

    expect(output.lines).toHaveLength(5);
    expect(output.text).not.toContain("This release");
  });

  it("given minutes about to run out, when the person picks how an app ships, then this machine is recommended", async () => {
    const { context, prompter, ci } = given();
    ci.seed({ minutes: { used: 1960, included: 2000, left: 40 } });
    prompter.answer("local");

    expect(await askPaths(context, "production", [shipment("api")])).toEqual(["local"]);

    expect(prompter.initials["How should api@1.0.0 ship to production?"]).toBe("local");
  });

  it("given minutes running short but not out, when the person picks how an app ships, then GitHub Actions stays recommended", async () => {
    const { context, prompter, ci } = given();
    ci.seed({ minutes: { used: 1500, included: 2000, left: 500 } });
    prompter.answer("ci");

    await askPaths(context, "production", [shipment("api")]);

    expect(prompter.initials["How should api@1.0.0 ship to production?"]).toBe("ci");
  });

  it("given no terminal, when a ship needs to know how apps ship, then it shows the --via flags and asks nothing", async () => {
    const { context, prompter, output } = given({ interactive: false });

    expect(await askPaths(context, "production", [shipment("api")])).toBeNull();

    expect(prompter.asked).toEqual([]);
    expect(output.lines).toEqual([
      "✗ Not a terminal: say how to ship.",
      "    shiplane ship --via ci",
      "    shiplane ship --via local",
    ]);
  });

  it("given the person cancels the first question, when apps are left to choose, then the ship stops without asking the rest", async () => {
    const { context, prompter } = given();
    prompter.answer(null);

    expect(await askPaths(context, "production", [shipment("api"), shipment("web")])).toBeNull();

    expect(prompter.asked).toHaveLength(1);
  });
});
