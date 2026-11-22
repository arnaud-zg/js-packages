#!/usr/bin/env node
// Times one shiplane run on this repository: the wall time, the time spent in child processes
// (git, gh, npm, counted once when they overlap), and the rest, shiplane's own work.
// `node packages/shiplane/scripts/time-run.mjs status --json`. Read by docs/shiplane/decisions/ADR-001.
import path from "node:path";
import { createJiti } from "jiti";

const root = path.resolve(import.meta.dirname, "../../..");
const src = path.join(root, "packages/shiplane/src");
const jiti = createJiti(import.meta.url);
const { runCli } = await jiti.import(path.join(src, "cli/main.ts"));
const { systemShell } = await jiti.import(path.join(src, "adapters/shell/system-shell.adapter.ts"));

const calls = [];
const timed = (kind) => async (command, args, options) => {
  const start = performance.now();
  try {
    return await systemShell[kind](command, args, options);
  } finally {
    calls.push({ tool: command, start, end: performance.now() });
  }
};
const shell = { ...systemShell, capture: timed("capture"), attach: timed("attach") };

const write = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
const start = performance.now();
const code = await runCli(process.argv.slice(2), root, { shell });
const total = performance.now() - start;
process.stdout.write = write;

let busy = 0;
let reached = -Infinity;
for (const { start: from, end } of calls.toSorted((a, b) => a.start - b.start)) {
  if (end > reached) {
    busy += end - Math.max(from, reached);
    reached = end;
  }
}
const byTool = Object.groupBy(calls, ({ tool }) => tool);
const ms = (value) => Math.round(value);
process.stdout.write(
  JSON.stringify({
    argv: process.argv.slice(2),
    code,
    totalMs: ms(total),
    toolsMs: ms(busy),
    ownMs: ms(total - busy),
    calls: Object.fromEntries(Object.entries(byTool).map(([tool, list]) => [tool, list.length])),
  }) + "\n",
);
