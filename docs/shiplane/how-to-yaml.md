[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ YAML config** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: YAML config

Write the release in `shiplane.yml` instead of `shiplane.config.ts`: no TypeScript, the same
release. Every option named here is in the [Reference](./reference.md).

- [Write the config in YAML](#write-the-config-in-yaml)
- [Give an adapter options](#give-an-adapter-options)
- [Name an adapter of your own](#name-an-adapter-of-your-own)
- [Use a preset](#use-a-preset)

## Write the config in YAML

1. Install the plugins you name, as for a TS config:
   `pnpm add -D shiplane @shiplane/git @shiplane/github @shiplane/changesets`.
2. Write `shiplane.yml` at the root. Each port of the flow names its adapter, and each module names
   the adapter it ships with:

   ```yaml
   flow:
     sourceControl: git
     codeHost: github
     ciPipeline: github-actions
     versioning: changesets
   modules:
     - use: published-package
       with:
         packageRegistry: npm
     - internal-tool
   ```

3. Delete `shiplane.config.ts` if there is one: shiplane reads one config, and says so when it finds
   both.

**Check it worked:** `pnpm shiplane plugins` lists the flow under `Flow in shiplane.yml`, and
`pnpm shiplane doctor` passes.

Every slot takes one of two shapes: a name (`fly`), or `use:` the name with `with:` its options. A
module's `with` holds its adapter and, when two modules share a kind, its `name`.

## Give an adapter options

Switch the slot to `use` and `with`:

```yaml
flow:
  sourceControl:
    use: git
    with:
      main: develop
```

A wrong or unknown option is a problem with its line and what the adapter takes, such as
`shiplane.yml:6  web-app takes no region  → it takes name, staticHosting`.

## Name an adapter of your own

Point the slot at a file that exports a `catalog`, from the repository root:

```yaml
modules:
  - use: backend-service
    with:
      serverHosting: ./shiplane/adapters/my-host.ts
```

```ts
// shiplane/adapters/my-host.ts
import { z } from "shiplane";
import { adapterEntry } from "shiplane/plugin";

import { myHostServerHosting } from "./my-host-server-hosting";

export const catalog = [
  adapterEntry({
    name: "my-host",
    port: "serverHosting",
    description: "Deploys to my host",
    options: z.object({}),
    make: () => myHostServerHosting(),
  }),
];
```

A plugin package does the same: it exports `catalog`, and its `package.json` has a `shiplane` key.

## Use a preset

What a TS config imports by name, YAML writes as the name:

| YAML                           | TS config                                            |
| ------------------------------ | ---------------------------------------------------- |
| `tag: plugin`                  | `tag: "plugin"`                                      |
| `testComment: compact`         | `testComment: comments.compact`                      |
| `testRelease: gitflow`         | `testRelease: testReleases.gitflow`                  |
| `with: { line: whatsChanged }` | `changesetsVersioning({ line: lines.whatsChanged })` |
| `with: { thanks: none }`       | `changesetsVersioning({ thanks: presets.none })`     |

A function, such as a mascot drawn by code, has no YAML form: keep `shiplane.config.ts` for it.

## Example

[`examples/shiplane.yml`](../../packages/shiplane/examples/shiplane.yml) is
[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
in YAML; `packages/shiplane-integration/src/__tests__/yamlParity.e2e.test.ts` runs both and checks
`shiplane plugins --json` prints the same for each.
