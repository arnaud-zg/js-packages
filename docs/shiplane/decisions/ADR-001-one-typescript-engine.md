# ADR-001: One TypeScript engine

[🏠 Home](../../../README.md) · [📚 Docs](../../README.md) · [🧭 Decisions](./README.md) ·
**ADR-001**

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Shiplane may one day run without Node, as a native binary. A rewrite of the engine in another
language only pays if shiplane's own work, not the tools it drives, is what a person waits for. So
we timed a real run before deciding.

The run: this repository (12 npm packages), shiplane at commit `463c3b2`, Node 22, an arm64 Mac
laptop. [`time-run.mjs`](../../../packages/shiplane/scripts/time-run.mjs) wraps the shell port and
times every child process (git, gh, npm); what is left of the wall time is shiplane's own work:
loading the config, planning, printing. Three rounds each, times rounded.

| Command                   | Wall time    | In git, gh, npm         | Shiplane's own | Own share |
| ------------------------- | ------------ | ----------------------- | -------------- | --------- |
| `shiplane help`           | 0.15 s       | none                    | 0.15 s         | 100%      |
| `shiplane plugins`        | 0.27 s       | none                    | 0.27 s         | 100%      |
| `shiplane status`         | 9.2 to 9.8 s | 9.1 to 9.7 s, 192 calls | 0.12 s         | about 1%  |
| `shiplane ship --dry-run` | 1.6 to 1.9 s | 1.5 to 1.7 s, 17 calls  | 0.12 s         | about 7%  |

`help` and `plugins` are Node starting and the config loading through jiti. `status` spends its time
in 141 git calls, 48 npm calls and 3 gh calls. A real ship adds the deploy on its platform, which
takes minutes and runs after shiplane returns. CI time is the runner and the install, not shiplane.

## Decision

Shiplane keeps one engine, in TypeScript. No rewrite for speed: shiplane's own work is about 0.1 s
of a run that waits seconds on git and the network, and minutes on deploys. Work on speed goes to
fewer and parallel tool calls, which is where the time is (the `big-o-optimizer` skill, when a run
shows a slow loop).

A native binary for teams without Node is a separate need. It is met first by compiling this engine
(release 2 of the plan), not by a second engine.

## Consequences

- Every feature lands once. No parity work between two engines.
- `status` is the command to make faster: 192 tool calls, most of them one git call per unit.
- This record is revisited, and superseded if needed, when a later timing shows shiplane's own work
  above 10% of a run, or when a Rust engine is reconsidered for reasons other than speed (one
  binary, no Node host). Run it again with `node packages/shiplane/scripts/time-run.mjs <command>`.
