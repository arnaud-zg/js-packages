[🏠 Home](../../README.md) · [📚 Docs](../README.md) · `expo-pnpm-catalog`:
[🚀 Tutorial](./tutorial.md) · [🛠️ How-to](./how-to.md) · [📖 Reference](./reference.md) · **💡
Explanation**

# 💡 Explanation: `expo-pnpm-catalog`

## Why `expo-pnpm-catalog check` resolves the whole workspace, not just the Expo app

`expo-doctor` reads a single `package.json`'s dependency versions; a pnpm catalog reference
(`catalog:expo`) isn't a version it understands. Resolving only the Expo app's own manifest would
miss drift in a shared package elsewhere in the workspace (a UI kit, a shared hooks package) that
also depends on the same Expo-managed package through the same catalog: `expo-doctor` would pass
locally while that sibling package quietly drifts. `WorkspaceCatalogScanner` scans every top-level
workspace directory for other `package.json` files referencing the same catalog entries, so
`check`'s pass/fail reflects the whole workspace's dependency surface, not just one app's.

## Why `sync` runs `expo install --fix` instead of hand-computing versions

`expo install --fix` is the same engine `expo-doctor` itself uses to decide what a given Expo SDK
version wants. Reimplementing that logic against the SDK's own compatibility table would mean
tracking every SDK release by hand and inevitably drifting from what Expo's own tooling decides;
running the real command against the resolved manifest and reading back what it changed can't drift,
by construction.

## Why the Expo app's `package.json` is always restored, even on `Ctrl-C`

Both `check` and `sync` temporarily rewrite the Expo app's `package.json`, replacing every
`catalog:*` reference with its resolved concrete version, because `expo-doctor` and
`expo install --fix` can't read a catalog reference directly. Leaving that rewritten file in place
would silently convert catalog references into hardcoded pins, defeating the point of using a
catalog. A `finally` block around the mutation puts the original file back on a clean exit or an
error. `expo-doctor` runs synchronously, so a `finally` never runs on `Ctrl-C`: the CLI also wraps
`check`'s run in `SIGINT`/`SIGTERM` handlers that restore the file before exiting. The handlers live
in `cli.ts`, not in `runCheck`, so a program calling `runCheck` keeps control of its own signals
(see [Reference § Programmatic](./reference.md#programmatic)).

## Why `pnpm-workspace.yaml` updates are a targeted string replace, not a full YAML round-trip

`sync` only ever changes a handful of version values inside `catalogs.*`. Parsing the file with
`js-yaml`, mutating the object, and re-serializing it would re-flow the whole document through the
library's own formatting rules, dropping comments and reordering keys in the process.
`updateVersionInYaml` instead matches each changed package's line by regex and replaces only the
version portion, leaving everything else in the file, comments included, byte-for-byte unchanged.
`js-yaml` is still used to _read_ the file (parsing structure needs a real parser); only the write
path avoids it.

## How the code is laid out

The rules work on values, not files. `CatalogWorkspace` (`pnpm-workspace.yaml`) and
`ExpoAppManifest` (the Expo app's `package.json`) are built with `fromText()`, turned back into text
with `toText()`, and never touch the disk. Each file is read and written by an adapter
(`catalogWorkspace.adapter.ts`, `expoAppManifest.adapter.ts`) behind a port (`*.ports.ts`), and each
text is checked against a zod schema (`schemas.ts`) as it is read, so a malformed file stops the run
with its path instead of failing later. Every line of terminal output goes through `printer.ts`, and
`cli.ts` is the one place that touches the process (signals, exit codes).

`check` and `sync` prepare the manifest that Expo tooling reads in the same three steps:

```ts
const resolved = ExpoManifestResolver.from(manifest) // the Expo app's own package.json
  .withCatalogResolution(workspace) // catalog:* references become concrete versions
  .mergeExtraPackages(extra.versions) // catalog deps that only sibling packages declare
  .build();
```
