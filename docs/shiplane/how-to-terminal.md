[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ Terminal** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: terminal

Change what the terminal shows while a release runs. Every option named here is in the
[Reference](./reference.md).

- [Bring your own mascot](#bring-your-own-mascot)
- [Turn the mascot off](#turn-the-mascot-off)

## Bring your own mascot

A built-in mascot sits beside the live line by default. Give `display.mascot` frames for the moods
you want; any mood you leave out uses the built-in frames:

```ts
// shiplane.config.ts
export default defineRelease({
  display: {
    mascot: {
      working: ["(=^･ω･^=)/", "(=^･ω･^=)-"], // looped while something runs
      happy: ["(=^▽^=) ✦"],
      worried: ["(=;ω;=)"],
    },
  },
  // flow, modules…
});
```

To react to more than the mood, give a function. It gets the mood, the animation tick and what runs
right now:

```ts
import type { Mascot } from "shiplane";

const rocket: Mascot = ({ mood, tick, label }) =>
  mood === "worried" ? "💥" : label.includes("production") ? "🚀✨" : ["🛰", "🛸"][tick % 2];

export default defineRelease({ display: { mascot: rocket } /* flow, modules… */ });
```

Shiplane pads every frame to one width so lines stay aligned, colours it (green when happy, red when
worried), and holds it still in CI or under `NO_MOTION=1`. To share one, export it from a package
(`shiplane-mascot-<name>`) and import it in the config. The moods are in the
[reference](./reference-output.md#mascot).

## Turn the mascot off

For one run: `pnpm shiplane --no-mascot`. For good: `display: { mascot: false }` in
`shiplane.config.ts`. `--mascot` brings it back for one run, your own if the config has one.

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
