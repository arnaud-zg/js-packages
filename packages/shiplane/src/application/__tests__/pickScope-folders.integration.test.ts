import { describe, expect, it } from "vitest";

import { changesetText, testContext, testUnit } from "../../testing/releaseContext";
import { pickScope } from "../pickScope";

const QUESTION = "What do you want to release to preview? Greyed units have nothing to release.";

/** shop with a changeset, blog with nothing new, then packages at their first release. */
const world = (packages: number, options: { yes?: boolean; interactive?: boolean } = {}) => {
  const names = Array.from({ length: packages }, (_, at) => `lib-${at}`);
  const made = testContext({
    units: [
      testUnit("blog"),
      testUnit("shop"),
      ...names.map((name) => testUnit(name, { dir: `packages/${name}` })),
    ],
    ...options,
  });
  made.versioning.seed({
    pending: [{ id: "a", text: changesetText({ "@acme/shop": "patch" }, "Faster.") }],
  });
  made.source.seed({
    versionCommits: Object.fromEntries(
      names.map((name) => [`packages/${name}@0.1.0`, { sha: name, subject: "feat: add" }]),
    ),
  });
  return made;
};

describe("Feature: a long list of units is asked by folder", () => {
  it("given 15 units, when asked, then the list is flat as before", async () => {
    const { context, prompter } = world(13);
    prompter.answer(["shop"]);

    const picked = await pickScope(context, "preview");

    expect(prompter.choices[QUESTION]).toHaveLength(15);
    expect(picked && [...picked.scope]).toEqual(["shop"]);
  });

  it("given 16 units, when asked, then they come by parent folder, only first releases closed, the pending ones first", async () => {
    const { context, prompter } = world(14);
    prompter.answer(["shop"]);

    const picked = await pickScope(context, "preview");

    const groups = prompter.groups[QUESTION] ?? [];
    expect(groups.map(({ label, open, choices }) => [label, open, choices.length])).toEqual([
      ["apps/", true, 2],
      ["packages/", false, 14],
    ]);
    expect(groups[0]?.choices).toEqual([
      {
        value: "shop",
        label: "shop",
        kind: "with changesets",
        hint: "1 changeset",
        disabled: false,
      },
      {
        value: "blog",
        label: "blog",
        kind: "with nothing to release",
        hint: "nothing new",
        disabled: true,
      },
    ]);
    expect(groups[1]?.choices[0]?.kind).toBe("first release");
    expect(prompter.initials[QUESTION]).toHaveLength(15);
    expect(picked && [...picked.scope]).toEqual(["shop"]);
  });

  it("given 16 units and the question cancelled, when asked, then nothing is picked", async () => {
    const { context, prompter } = world(14);
    prompter.answer(null);

    expect(await pickScope(context, "preview")).toBeNull();
  });

  it.each([{ yes: true }, { interactive: false }])(
    "given 16 units and %o, when asked, then nothing is asked and everything pending is picked",
    async (options) => {
      const { context, prompter } = world(14, options);

      expect((await pickScope(context, "preview"))?.scope.size).toBe(15);
      expect(prompter.asked).toEqual([]);
    },
  );
});
