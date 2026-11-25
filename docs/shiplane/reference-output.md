[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) · [📖 Reference](./reference.md) › **Output** · [🔌 Plugins](./plugins.md)
· [💡 Explanation](./explanation.md)

# 📖 Reference: output

What a release shows while it runs, and what `status --json` prints for a script.

[Mascot](#mascot) · [`status --json`](#status---json)

## Mascot

`display.mascot` in `shiplane.config.ts`:

| Value                  | Draws                                                |
| ---------------------- | ---------------------------------------------------- |
| `true` (default)       | the built-in mascot                                  |
| `false`                | nothing                                              |
| `{ [mood]: string[] }` | your frames, looped by tick; missing moods: built-in |
| `(moment) => string`   | what the function returns for each moment            |

`--no-mascot` hides any of them for one run; `--mascot` shows the configured one, or the built-in
one.

| Mood       | When                                    |
| ---------- | --------------------------------------- |
| `thinking` | reading: git, the code host, the config |
| `working`  | something runs: a build, a deploy       |
| `waiting`  | on a person, a merge or CI              |
| `happy`    | done                                    |
| `worried`  | failed                                  |
| `resting`  | nothing to do                           |

A moment is `{ mood, tick, label }`: `tick` counts frames from 0 and stays 0 when motion is off;
`label` is what runs, such as `deploy api@1.2.0 to prod`. Every frame is padded to the widest one.
Type: `Mascot` from `shiplane`. Source: `src/domain/display.ts`.

## `status --json`

From `pnpm -s shiplane status --json`, trimmed to one unit:

```json
{
  "environment": "staging",
  "units": [
    {
      "unit": "api",
      "target": "fly",
      "version": "0.0.12",
      "tag": "api@0.0.12",
      "tagged": true,
      "changesets": 3,
      "pending": true,
      "hint": "3 changesets"
    }
  ],
  "next": { "step": "release-pr" }
}
```

`next.step` is `release-pr`, `wait-merge` or `ship`. A unit whose plugin reads its platform (EAS)
adds `live`. Source: `src/application/readStatus.ts`.

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
is the config `status --json` reads above;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
