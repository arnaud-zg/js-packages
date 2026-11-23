[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ CI** · [📖 Reference](./reference.md) · [🔌 Plugins](./plugins.md) ·
[💡 Explanation](./explanation.md)

# 🛠️ How-to: ci

Ship from GitHub Actions, from this machine, or from a script. Every option named here is in the
[Reference](./reference.md).

- [Choose GitHub Actions or this machine](#choose-github-actions-or-this-machine)
- [Ship from GitHub Actions](#ship-from-github-actions)
- [Set up any Node project in your workflow](#set-up-any-node-project-in-your-workflow)
- [Ship with no laptop](#ship-with-no-laptop)
- [Use it from a script](#use-it-from-a-script)

## Choose GitHub Actions or this machine

```sh
pnpm shiplane ship --via ci         # or --via local
```

`ci` is the flow's CI pipeline, GitHub Actions by default; `--via github` still works and means the
same. Without `--via`, it asks per app and shows this month's CI minutes. To stop asking, set
`via: "ci"` (your CI pipeline) or `via: "local"` in `shiplane.config.ts`; `--via` still wins for one
run. An app only one way can ship is not asked, and it says why. Through GitHub Actions, each run
goes on a release tag, so a merge to `main` while it waits cannot change what ships; see
[Explanation](./explanation.md#ci-and-your-laptop-run-the-same-jobs).

## Ship from GitHub Actions

```sh
pnpm shiplane setup      # writes .github/workflows/ship.yml
pnpm shiplane doctor     # checks it, offers each fix
```

`ship.yml` is about 30 lines that call shiplane's reusable workflow. You write no step: it checks
out the repo, detects the package manager and Node version, installs, installs the deploy tools your
units need, then runs `shiplane ship`, the same command as your laptop. It passes, by name, only the
secrets your configured adapters read, and only the check and ship steps see them.

```yaml
# .github/workflows/ship.yml, as setup writes it
# Ships with shiplane: `pnpm shiplane ship --via ci`, or Run workflow here.
# Written by `shiplane setup`; `shiplane doctor` keeps the pin current.
name: Ship
run-name: Ship ${{ inputs.units || 'every released unit' }} to ${{ inputs.environment }}

on:
  workflow_dispatch:
    inputs:
      units:
        description: "Units to ship, space separated (empty: every unit the environment lacks)"
        type: string
        default: ""
      environment:
        description: "Where to ship the ref this runs on"
        type: choice
        options: [preview, production]
        default: preview

permissions:
  contents: read
  deployments: write
  actions: read

jobs:
  ship:
    uses: arnaud-zg/js-packages/.github/workflows/shiplane-ship.yml@<commit> # shiplane@<version>
    with:
      units: ${{ inputs.units }}
      environment: ${{ inputs.environment }}
    secrets:
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

That one ships apps on Cloudflare Pages only. With apps on EAS, Fly and Cloudflare Pages, and
`releaseComments` in `features`, setup writes four secrets, and lets the run comment:

```yaml
permissions:
  contents: read
  deployments: write
  actions: read
  issues: write
  pull-requests: write

jobs:
  ship:
    # uses: and with: as above
    secrets:
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
      FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

With no adapter that reads a secret, there is no `secrets:` key.

1. **Create one GitHub Environment per channel** (Settings › Environments): `preview`, `production`.
2. **Add each adapter's secret to it**, by the name in
   [the sign-ins table](./how-to-hosts.md#set-up-the-sign-ins): `FLY_API_TOKEN`,
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, `EXPO_TOKEN`. Setup lists the ones your
   adapters read under `secrets:`; after adding an adapter, `pnpm shiplane doctor` offers to add its
   secret there.
3. **Ship:** `pnpm shiplane ship --via ci`, or Run workflow in the Actions tab.

A unit that fails never stops the next one. The run page shows what ships before, and how each unit
went after; the run fails when one did.

**Build before shipping.** Set `prepare` in `shiplane.config.ts`. It runs before each unit ships,
from the repo root, on your laptop and on the runner alike: `{unit}` is the unit's name, `{dir}` its
folder.

```ts
export default defineRelease({ prepare: "pnpm turbo run build typecheck --filter=./{dir}" });
```

Without `prepare`, a package about to publish from this machine, the runner, or as a test release
[builds only if needed](./reference.md#build-before-publishing).

**Push as an app, not as Actions.** A push with the default token never starts another workflow. Add
secrets `SHIPLANE_APP_ID` and `SHIPLANE_APP_PRIVATE_KEY` of a GitHub App installed on the repo, pass
both under `secrets:` in `ship.yml`, and the workflow uses its token instead.

**Keep the pin current.** The workflow is pinned to the commit of a shiplane release, never a moving
tag. After upgrading `shiplane`, `pnpm shiplane doctor` offers to re-pin it. If your repository uses
Renovate, add the preset shiplane publishes for it, and Renovate opens a PR that moves the commit
and the `# shiplane@x.y.z` comment together:

```json
{ "extends": ["github>arnaud-zg/js-packages//renovate/shiplane"] }
```

`shiplane setup` adds it to `renovate.json`, `.github/renovate.json` or `.renovaterc(.json)` when
you have one, prints the line for a JSON5 or `package.json` config, and never creates a Renovate
config. Renovate alone cannot do it: it reads only `prefix-1.2.3` or `prefix/1.2.3` tags, and
shiplane's are `shiplane@1.2.3`. Dependabot reads neither, so rely on `shiplane doctor`.

**Not supported, or a repo that differs.** The first step checks everything and fails before
anything ships, with what to change: see
[GitHub Actions workflow](./reference.md#github-actions-workflow). Only as a last resort, pass
`node-version`, `install-command` or `working-directory` under `with:`.

## Set up any Node project in your workflow

```yaml
steps:
  - uses: actions/checkout@v5
  - uses: arnaud-zg/js-packages/.github/actions/setup-node-project@<commit> # shiplane@<version>
    id: setup
    # Only as a last resort: with: { node-version, install-command, working-directory }
  - run: ${{ steps.setup.outputs.exec }} shiplane status
```

It runs in your own job the same setup steps as shiplane's ship workflow: it detects the package
manager and Node version, sets them up and installs, reusing `node_modules` from the same lockfile
and Node. Check out first; pin it like the workflow, to the commit of a shiplane release. Its inputs
and outputs: [Setup Node project action](./reference.md#setup-node-project-action).

## Ship with no laptop

Run the **Ship** workflow from the Actions tab, on a tag or `main`, with the units and the
environment. Production runs as soon as you start it.

## Use it from a script

```sh
pnpm -s shiplane status --json
```

Without a terminal every question answers no: pass `--yes` (refused on production) and `--via`.

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
