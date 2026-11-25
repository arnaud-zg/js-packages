import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import type { ChoiceGroup } from "../../ports/terminal.port";
import { treePrompt } from "../../adapters/terminal/tree-prompt";

const KEYS = {
  up: "\u001B[A",
  down: "\u001B[B",
  right: "\u001B[C",
  left: "\u001B[D",
  space: " ",
  enter: "\r",
  ctrlC: "\u0003",
};

// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");

const unit = (value: string, kind = "first release") => ({
  value,
  label: value,
  kind,
  hint: kind,
  disabled: kind === "with nothing to release",
});

const numbered = (count: number) => Array.from({ length: count }, (_, at) => unit(`lib-${at}`));

const GROUPS: ChoiceGroup<string>[] = [
  {
    label: "apps/",
    open: true,
    choices: [unit("shop", "with changesets"), unit("blog", "with nothing to release")],
  },
  { label: "packages/", open: false, choices: numbered(6) },
];

/** A question asked on a terminal of that size, answered key by key. */
const ask = (
  groups = GROUPS,
  {
    columns = 100,
    rows = 40,
    initial,
  }: { columns?: number; rows?: number; initial?: string[] } = {},
) => {
  const writes: string[] = [];
  const modes: boolean[] = [];
  const input = Object.assign(new PassThrough(), {
    setRawMode(mode: boolean) {
      modes.push(mode);
      return this;
    },
  });
  const output = Object.assign(new PassThrough(), {
    columns,
    rows,
    write: (text: string) => Boolean(writes.push(text)),
  });
  const answer = treePrompt(
    {
      message: "What do you want to release?",
      groups,
      initial:
        initial ??
        groups.flatMap(({ choices }) =>
          choices.filter(({ disabled }) => !disabled).map(({ value }) => value),
        ),
    },
    { input: input as never, output: output as never },
  );
  const last = () =>
    plain(writes.at(-1) === "\u001B[?25h" ? (writes.at(-2) ?? "") : (writes.at(-1) ?? ""));
  return {
    answer,
    input,
    output,
    modes,
    writes,
    /** Every line of the last redraw. */
    screen: () => last().replace("\r", "").trimEnd().split("\n"),
    type: async (...keys: (keyof typeof KEYS | "a" | "x")[]) => {
      for (const key of keys) input.write(key in KEYS ? KEYS[key as keyof typeof KEYS] : key);
      await new Promise((done) => setImmediate(done));
    },
  };
};

const line = (screen: string[], text: string) => screen.find((shown) => shown.includes(text));

describe("Feature: picking from a tree of folders", () => {
  it("given an open and a closed folder, when asked, then each says how many are selected and why, with the keys", () => {
    const { screen } = ask();

    expect(line(screen(), "apps/")).toContain(
      "▾ ◼ apps/  1/1 selected · 1 with changesets, 1 with nothing to release",
    );
    expect(line(screen(), "packages/")).toContain("▸ ◼ packages/  6/6 selected · 6 first release");
    expect(line(screen(), "of 8")).toContain(
      "7 of 8 selected · 1 with changesets, 6 first release",
    );
    expect(line(screen(), "lib-0")).toBeUndefined();
    expect(line(screen(), "space select")).toContain("→/← open or close a folder");
  });

  it("given everything ticked, when a folder is unticked as a whole, then only the rest is released", async () => {
    const { answer, type, screen } = ask();

    await type("down", "down", "down", "space");
    expect(line(screen(), "packages/")).toContain("◻ packages/  0/6 selected");
    await type("enter");

    expect(await answer).toEqual(["shop"]);
    expect(screen()).toEqual(["◇  What do you want to release?", "│  apps/ shop"]);
  });

  it("given a folder opened, when one of its units is unticked, then the folder is partly selected", async () => {
    const { answer, type, screen } = ask();

    await type("up", "right", "down", "space");
    expect(line(screen(), "packages/")).toContain("◧ packages/  5/6 selected");
    await type("enter");

    expect(await answer).toEqual(["shop", "lib-1", "lib-2", "lib-3", "lib-4", "lib-5"]);
  });

  it("given a partly selected folder, when it is selected, then all of it is", async () => {
    const { answer, type } = ask(GROUPS, { initial: ["lib-3"] });

    await type("up", "space", "enter");

    expect(await answer).toEqual(["lib-0", "lib-1", "lib-2", "lib-3", "lib-4", "lib-5"]);
  });

  it("given the cursor on a unit, when its folder is closed, then the cursor is on the folder", async () => {
    const { type, screen } = ask();

    await type("up", "right", "down", "down", "left");

    expect(line(screen(), "❯")).toContain("▸ ◼ packages/");
    expect(line(screen(), "lib-0")).toBeUndefined();
  });

  it("given a greyed unit, when space is pressed on it, then it stays out", async () => {
    const { answer, type } = ask(GROUPS, { initial: [] });

    await type("down", "down", "space", "x", "enter");

    expect(await answer).toEqual([]);
  });

  it("given a twice, when pressed, then nothing is selected, then all that can be", async () => {
    const { type, screen } = ask();

    await type("a");
    expect(line(screen(), "of 8")).toBe("│  0 of 8 selected");
    await type("a");
    expect(line(screen(), "of 8")).toContain("7 of 8 selected");
  });

  it("given nothing selected, when confirmed, then the answer is none, and says so", async () => {
    const { answer, type, screen } = ask();

    await type("a", "enter");

    expect(await answer).toEqual([]);
    expect(screen().at(-1)).toBe("│  nothing");
  });

  it("given many units of a folder, when confirmed, then the answer counts them", async () => {
    const { answer, type, screen } = ask();

    await type("enter");

    expect(await answer).toHaveLength(7);
    expect(screen().at(-1)).toBe("│  packages/ 6 first release");
  });

  it("given ctrl-c, when pressed, then it is cancelled and the terminal is given back", async () => {
    const { answer, type, modes, writes, input, output } = ask();

    await type("ctrlC");

    expect(await answer).toBeNull();
    expect(modes).toEqual([true, false]);
    expect(writes.at(-1)).toBe("\u001B[?25h");
    expect(input.listenerCount("keypress") + output.listenerCount("resize")).toBe(0);
    expect(plain(writes.at(-2) ?? "")).toContain("cancelled");
  });

  it.each([
    { columns: 80, rows: 24 },
    { columns: 40, rows: 15 },
  ])(
    "given a terminal of $columns by $rows and 60 units, when moving through them, then no line or redraw is larger than it",
    async ({ columns, rows }) => {
      const { type, screen } = ask([{ label: "packages/", open: true, choices: numbered(60) }], {
        columns,
        rows,
      });

      await type(...Array.from({ length: 30 }, () => "down" as const));

      expect(screen().length).toBeLessThan(rows);
      expect(Math.max(...screen().map(({ length }) => length))).toBeLessThan(columns);
      expect(line(screen(), "❯")).toContain("lib-29");
      expect(screen().filter((shown) => shown.includes("more"))).toHaveLength(2);
    },
  );

  it("given the terminal resized, when it redraws, then it fits the new width", () => {
    const { output, screen } = ask();

    output.columns = 30;
    output.emit("resize");

    expect(Math.max(...screen().map(({ length }) => length))).toBeLessThan(30);
  });
});
