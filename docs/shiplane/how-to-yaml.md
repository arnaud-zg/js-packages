[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ YAML config** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: YAML config

Write the release in `shiplane.yml` instead of `shiplane.config.ts`: no TypeScript, the same
release. Every key named here is in the [`shiplane.yml` reference](./reference-yaml.md).

- [Write the config in YAML](#write-the-config-in-yaml)
- [Set up a new repository in YAML](#set-up-a-new-repository-in-yaml)
- [Move a TS config to YAML](#move-a-ts-config-to-yaml)
- [Get autocomplete in your editor](#get-autocomplete-in-your-editor)
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

## Set up a new repository in YAML

```sh
pnpm shiplane setup --format yaml
```

Setup asks what it always asks and writes `shiplane.yml` instead of `shiplane.config.ts`. Run again,
it adds each new app's module to the `modules` of the `shiplane.yml` there, its comments kept. A
config already in place keeps its format: `--format` only picks a new one's.

## Move a TS config to YAML

```sh
pnpm shiplane migrate
```

It writes `shiplane.yml` from `shiplane.config.ts`, loads it back, and removes the TS config only
when both compose the same release. `git restore shiplane.config.ts` brings it back.

What YAML cannot hold is listed, each with where it is, and nothing is written:

```text
✗  display.mascot  is a function: YAML holds values only
   use true, false, frames per mood, or keep shiplane.config.ts
✗  modules[0].with.serverHosting  the serverHosting adapter "my-host" is in no catalog
   export a catalog from its file (adapterEntry from shiplane/plugin), then name it by its path in shiplane.yml
```

Change each one in `shiplane.config.ts` and run it again, or keep the TS config.

## Get autocomplete in your editor

`shiplane setup --format yaml` and `shiplane migrate` write the schema with `shiplane.yml`. After
installing a plugin or adding an adapter, write it again:

```sh
pnpm shiplane schema
```

It writes `node_modules/.cache/shiplane/shiplane.schema.json` from the plugins installed and your
own adapters (each file in `shiplane/adapters/` that exports a `catalog`, and each local file
`shiplane.yml` names), and puts its line on top of `shiplane.yml`:

```yaml
# yaml-language-server: $schema=node_modules/.cache/shiplane/shiplane.schema.json
```

Any editor running the YAML language server (VS Code with the Red Hat YAML extension, Zed, Neovim)
then offers each port's adapters, and once `use:` names one, the keys its `with:` takes.

**Check it worked:** type `serverHosting: ` under a module's `with:`; the editor offers `fly`,
`shell` and the rest installed.

The schema for the first-party plugins ships in the package as `shiplane/shiplane.schema.json`.
Every key it holds is in the [`shiplane.yml` reference](./reference-yaml.md).

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
