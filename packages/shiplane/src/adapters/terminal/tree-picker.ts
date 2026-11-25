import type { styleText } from "node:util";

import type { ChoiceGroup, GroupedChoice } from "../../ports/terminal.port";

type Style = Parameters<typeof styleText>[0];

/** A piece of one line and how it looks. */
export interface Span {
  text: string;
  style?: Style;
}

export type Line = Span[];

/** The shapes a tree is drawn with; a terminal without Unicode gets its own. */
export interface Glyphs {
  bar: string;
  end: string;
  active: string;
  done: string;
  cancelled: string;
  on: string;
  some: string;
  off: string;
  opened: string;
  closed: string;
  cursor: string;
}

type Group = ChoiceGroup<string>;
type Choice = GroupedChoice<string>;

type Row = { type: "group"; group: Group } | { type: "choice"; group: Group; choice: Choice };

/** Where a person is in a tree of choices. */
export interface Tree {
  groups: readonly Group[];
  selected: ReadonlySet<string>;
  /** The labels of the groups whose choices show. */
  opened: ReadonlySet<string>;
  cursor: number;
}

export const treeOf = (groups: readonly Group[], initial: readonly string[]): Tree => ({
  groups,
  selected: new Set(initial),
  opened: new Set(groups.filter(({ open }) => open).map(({ label }) => label)),
  cursor: 0,
});

const rowsOf = ({ groups, opened }: Tree): Row[] =>
  groups.flatMap((group): Row[] => [
    { type: "group", group },
    ...(opened.has(group.label)
      ? group.choices.map((choice): Row => ({ type: "choice", group, choice }))
      : []),
  ]);

const selectable = (choices: readonly Choice[]) =>
  choices.filter(({ disabled }) => !disabled).map(({ value }) => value);

const chosen = (tree: Tree, choices: readonly Choice[]) =>
  choices.filter(({ value }) => tree.selected.has(value));

/** Selects every choice that can be, or none of them when they all were already. */
const toggle = (tree: Tree, choices: readonly Choice[]): Tree => {
  const values = selectable(choices);
  const selected = new Set(tree.selected);
  const all = values.every((value) => selected.has(value));
  values.forEach((value) => (all ? selected.delete(value) : selected.add(value)));
  return { ...tree, selected };
};

const open = (tree: Tree, { label }: Group): Tree => ({
  ...tree,
  opened: new Set([...tree.opened, label]),
});

/** Closed, with the cursor on the folder: the choice it was on no longer shows. */
const close = (tree: Tree, { label }: Group): Tree => {
  const next = { ...tree, opened: new Set([...tree.opened].filter((other) => other !== label)) };
  return { ...next, cursor: rowsOf(next).findIndex(({ group }) => group.label === label) };
};

const move = (tree: Tree, by: number): Tree => {
  const { length } = rowsOf(tree);
  return { ...tree, cursor: (tree.cursor + by + length) % length };
};

/** The tree after one key; a key it does not know changes nothing. */
export const press = (tree: Tree, key: string): Tree => {
  const row = rowsOf(tree)[tree.cursor];
  if (!row) return tree;
  switch (key) {
    case "up":
    case "k":
      return move(tree, -1);
    case "down":
    case "j":
      return move(tree, 1);
    case "right":
    case "l":
      return open(tree, row.group);
    case "left":
    case "h":
      return close(tree, row.group);
    case "space":
      return toggle(tree, row.type === "group" ? row.group.choices : [row.choice]);
    case "a":
      return toggle(
        tree,
        tree.groups.flatMap(({ choices }) => choices),
      );
    default:
      return tree;
  }
};

/** The values a tree holds, in the order it lists them. */
export const valuesOf = (tree: Tree) =>
  tree.groups.flatMap(({ choices }) => chosen(tree, choices).map(({ value }) => value));

/** `3 with changesets, 40 first release`, each kind in the order it comes. */
const tally = (choices: readonly Choice[]) =>
  [...new Set(choices.map(({ kind }) => kind))]
    .map((kind) => `${choices.filter((choice) => choice.kind === kind).length} ${kind}`)
    .join(", ");

/** A line kept within a width, so a redraw knows how many rows it took. */
export const clip = (line: Line, width: number): Line => {
  let left = width;
  return line.flatMap((span) => {
    if (left <= 0) return [];
    const text = span.text.length > left ? `${span.text.slice(0, left - 1)}…` : span.text;
    left -= text.length;
    return [{ ...span, text }];
  });
};

/** Text broken between `separator`s to fit a width. */
export const wrap = (text: string, width: number, separator = " "): string[] => {
  const lines: string[] = [];
  for (const part of text.split(separator)) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + separator.length + part.length <= width) {
      lines[lines.length - 1] = `${last}${separator}${part}`;
    } else lines.push(part);
  }
  return lines;
};

const groupLine = (tree: Tree, group: Group, glyphs: Glyphs): Line => {
  const { choices, label } = group;
  const free = selectable(choices).length;
  const count = chosen(tree, choices).length;
  const box = count === 0 ? glyphs.off : count === free ? glyphs.on : glyphs.some;
  return [
    { text: `${tree.opened.has(label) ? glyphs.opened : glyphs.closed} `, style: "dim" },
    { text: box, style: count > 0 ? "green" : "dim" },
    { text: ` ${label}`, style: free > 0 ? "bold" : "dim" },
    { text: `  ${count}/${free} selected · ${tally(choices)}`, style: "dim" },
  ];
};

const choiceLine = (tree: Tree, { value, label, hint, disabled }: Choice, glyphs: Glyphs): Line => {
  const on = tree.selected.has(value);
  return [
    { text: `    ${on ? glyphs.on : glyphs.off}`, style: on ? "green" : "dim" },
    { text: ` ${label}`, style: disabled ? ["strikethrough", "dim"] : undefined },
    ...(hint ? [{ text: ` (${hint})`, style: "dim" as const }] : []),
  ];
};

const BETWEEN = " • ";
const HINTS = [
  "↑/↓ move",
  "→/← open or close a folder",
  "space select",
  "a all or none",
  "enter confirm",
  "esc cancel",
].join(BETWEEN);

export interface View {
  message: string;
  columns: number;
  rows: number;
  glyphs: Glyphs;
}

/** The rows around the cursor that fit, as where they start and end. */
const windowOf = (count: number, cursor: number, height: number) => {
  if (count <= height) return { start: 0, end: count };
  const start = Math.min(Math.max(0, cursor - Math.floor(height / 2)), count - height);
  return { start, end: start + height };
};

/** The question as it is asked, every line within the terminal, the keys that answer it last. */
export const drawTree = (tree: Tree, { message, columns, rows, glyphs }: View): Line[] => {
  const width = columns - 1;
  const bar: Span = { text: `${glyphs.bar}  `, style: "cyan" };
  const question = wrap(message, width - 3).map((text, index): Line => [
    index === 0 ? { text: `${glyphs.active}  `, style: "cyan" } : bar,
    { text },
  ]);
  const all = tree.groups.flatMap(({ choices }) => choices);
  const picked = chosen(tree, all);
  const why = picked.length > 0 ? ` · ${tally(picked)}` : "";
  const total: Line = [
    bar,
    { text: `${picked.length} of ${all.length} selected`, style: "bold" },
    { text: why },
  ];
  const hints = wrap(HINTS, width - 3, BETWEEN).map((text): Line => [bar, { text, style: "dim" }]);
  const list = rowsOf(tree);
  // Two "more" lines, the total, the end mark, and the row the terminal keeps for its cursor.
  const height = Math.max(3, rows - question.length - hints.length - 5);
  const { start, end } = windowOf(list.length, tree.cursor, height);
  const more = (count: number): Line => [
    bar,
    { text: count > 0 ? `  … ${count} more` : "", style: "dim" },
  ];
  const shown = list
    .slice(start, end)
    .map((row, index): Line => [
      bar,
      start + index === tree.cursor
        ? { text: `${glyphs.cursor} `, style: "cyan" }
        : { text: " ".repeat(glyphs.cursor.length + 1) },
      ...(row.type === "group"
        ? groupLine(tree, row.group, glyphs)
        : choiceLine(tree, row.choice, glyphs)),
    ]);
  const scrolls = list.length > height;
  const lines: Line[] = [
    ...question,
    total,
    ...(scrolls ? [more(start)] : []),
    ...shown,
    ...(scrolls ? [more(list.length - end)] : []),
    ...hints,
    [{ text: glyphs.end, style: "cyan" }],
  ];
  return lines.map((line) => clip(line, width));
};

const NAMED_AT_MOST = 5;

/** What stays on screen once answered: what each folder gave, or that it was cancelled. */
export const drawAnswer = (
  tree: Tree,
  { message, columns, glyphs }: View,
  cancelled: boolean,
): Line[] => {
  const picked = tree.groups.flatMap((group) => {
    const units = chosen(tree, group.choices);
    if (units.length === 0) return [];
    const named = units.map(({ label }) => label).join(", ");
    return [`${group.label} ${units.length > NAMED_AT_MOST ? tally(units) : named}`];
  });
  const answer = cancelled ? ["cancelled"] : picked.length > 0 ? picked : ["nothing"];
  const bar: Span = { text: `${glyphs.bar}  `, style: "dim" };
  const mark: Span = cancelled
    ? { text: `${glyphs.cancelled}  `, style: "red" }
    : { text: `${glyphs.done}  `, style: "green" };
  return [
    ...wrap(message, columns - 4).map((text, index): Line => [index === 0 ? mark : bar, { text }]),
    ...answer.map((text): Line => [bar, { text, style: "dim" }]),
  ].map((line) => clip(line, columns - 1));
};
