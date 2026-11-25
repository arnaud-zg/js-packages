import { emitKeypressEvents } from "node:readline";
import { styleText } from "node:util";
import type { ReadStream, WriteStream } from "node:tty";
import {
  S_BAR,
  S_BAR_END,
  S_CHECKBOX_INACTIVE,
  S_CHECKBOX_SELECTED,
  S_STEP_ACTIVE,
  S_STEP_CANCEL,
  S_STEP_SUBMIT,
  unicodeOr,
} from "@clack/prompts";

import type { ChoiceGroup } from "../../ports/terminal.port";
import type { Glyphs, Line } from "./tree-picker";
import { drawAnswer, drawTree, press, treeOf, valuesOf } from "./tree-picker";

const GLYPHS: Glyphs = {
  bar: S_BAR,
  end: S_BAR_END,
  active: S_STEP_ACTIVE,
  done: S_STEP_SUBMIT,
  cancelled: S_STEP_CANCEL,
  on: S_CHECKBOX_SELECTED,
  some: unicodeOr("◧", "[-]"),
  off: S_CHECKBOX_INACTIVE,
  opened: unicodeOr("▾", "v"),
  closed: unicodeOr("▸", ">"),
  cursor: unicodeOr("❯", ">"),
};

const HIDE_CURSOR = "\u001B[?25l";
const SHOW_CURSOR = "\u001B[?25h";
const ERASE_BELOW = "\u001B[J";
const up = (count: number) => (count > 0 ? `\u001B[${count}A` : "");

const painted = (line: Line) =>
  line.map(({ text, style }) => (style && text ? styleText(style, text) : text)).join("");

interface Key {
  name?: string;
  ctrl?: boolean;
}

export interface TreeTerminal {
  input: NodeJS.ReadableStream & Pick<ReadStream, "setRawMode">;
  output: Pick<WriteStream, "write" | "columns" | "rows" | "on" | "off">;
}

/**
 * Asks with a tree whose folders open, close and select as a whole. Resolves with the values
 * selected, or null when cancelled.
 */
export const treePrompt = <Value extends string>(
  { message, groups, initial }: { message: string; groups: ChoiceGroup<Value>[]; initial: Value[] },
  { input, output }: TreeTerminal = { input: process.stdin, output: process.stdout },
) =>
  new Promise<Value[] | null>((resolve) => {
    let tree = treeOf(groups, initial);
    let drawn = 0;
    const view = () => ({
      message,
      columns: output.columns || 80,
      rows: output.rows || 24,
      glyphs: GLYPHS,
    });
    const show = (lines: Line[]) => {
      output.write(`${up(drawn)}\r${ERASE_BELOW}${lines.map(painted).join("\n")}\n`);
      drawn = lines.length;
    };
    const draw = () => show(drawTree(tree, view()));
    const finish = (answered: boolean) => {
      input.off("keypress", onKey);
      output.off("resize", draw);
      input.setRawMode(false);
      input.pause();
      show(drawAnswer(tree, view(), !answered));
      output.write(SHOW_CURSOR);
      const values = new Set<string>(valuesOf(tree));
      const choices = groups.flatMap((group) => group.choices.map(({ value }) => value));
      resolve(answered ? choices.filter((value) => values.has(value)) : null);
    };
    const onKey = (_text: string | undefined, { name = "", ctrl = false }: Key) => {
      if (name === "escape" || (ctrl && name === "c")) finish(false);
      else if (name === "return" || name === "enter") finish(true);
      else if (!ctrl) {
        tree = press(tree, name);
        draw();
      }
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKey);
    output.on("resize", draw);
    output.write(HIDE_CURSOR);
    draw();
  });
