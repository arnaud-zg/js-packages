[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ CI** · [📖 Reference](./reference.md) · [🔌 Plugins](./plugins.md) ·
[💡 Explanation](./explanation.md)

# 🛠️ How-to: ci

Ship from GitHub Actions, from this machine, or from a script. Every option named here is in the
[Reference](./reference.md).

- [Choose GitHub Actions or this machine](#choose-github-actions-or-this-machine)
- [Watch the run until it ends](#watch-the-run-until-it-ends)
- [Ship from GitHub Actions](#ship-from-github-actions)
- [Set up any Node project in your workflow](#set-up-any-node-project-in-your-workflow)
- [Ship with no laptop](#ship-with-no-laptop)
- [Use it from a script](#use-it-from-a-script)

## Choose GitHub Actions or this machine

```sh
pnpm shiplane ship --via ci         # or --via local
```

`ci` is the flow's CI pipeline, GitHub Actions by default; `--via github` still works and means the
same. Without `--via`, it asks per app and shows this month's CI minutes. When gh may not read them,
for a person or an organization, it warns, links to the numbers and shows the command that grants
the right, if one does; you can ship anyway. To stop asking, set `via: "ci"` (your CI pipeline) or
`via: "local"` in `shiplane.config.ts`; `--via` still wins for one run. An app only one way can ship
is not asked, and it says why. Through GitHub Actions, each run goes on a release tag, so a merge to
`main` while it waits cannot change what ships; see
[Explanation](./explanation.md#ci-and-your-laptop-run-the-same-jobs).

## Watch the run until it ends

```sh
pnpm shiplane ship --via ci --watch     # or --no-watch
```

Once a ship, a promote or a test release starts runs on your CI pipeline, shiplane can follow them
live in your terminal, `gh run watch <run id>` on GitHub Actions, on the run it just started: never
gh's own list of every run in progress. A run that fails fails the ship, with its page linked. Which
happens is decided in this order; the first that says wins:

| Case                                | What happens                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--watch`                           | Follows each run it started, in order. Nothing asked                                                                                                                                        |
| `--no-watch`                        | Follows none. Prints `gh run watch <id>` per run, nothing asked                                                                                                                             |
| `watch: true` in the config         | As `--watch`, on every ship                                                                                                                                                                 |
| `watch: false` in the config        | As `--no-watch`, on every ship                                                                                                                                                              |
| `--yes`, with neither of the above  | The question counts as accepted: as `--watch`                                                                                                                                               |
| None of them, in a terminal         | Asks. One run: `Watch Ship to preview on GitHub Actions until it ends?`, yes first. Several: pick one, the first preselected, or **No, return now**; after each, the rest are offered again |
| None of them, without a terminal    | Follows none. Prints `gh run list --limit 5`                                                                                                                                                |
| On a runner (inside GitHub Actions) | Never follows: the runner ships itself                                                                                                                                                      |

Set it once in `shiplane.config.ts` (or `shiplane.yml`) to stop being asked:

```ts
export default defineRelease({
  // ...
  watch: true, // follow every run a ship starts; false: never, print the command instead
});
```

When GitHub has not shown the run after about ten seconds, it says so and prints the command to list
the latest runs. Ctrl+C stops following; the run keeps going on GitHub.

## Ship from GitHub Actions

```sh
pnpm shiplane setup      # writes .github/workflows/ship.yml
pnpm shiplane doctor     # checks it, offers each fix
```

`ship.yml` is one job using shiplane's action. You write no step: it checks out the repo, detects
the package manager and Node version, installs, installs the deploy tools your units need, then runs
`shiplane ship`, the same command as your laptop. It passes, by name, only the secrets your
configured adapters read, and only the check and ship steps see them.

```yaml
# .github/workflows/ship.yml, as setup writes it
# Ships with shiplane: `pnpm shiplane ship --via ci`, or Run workflow here.
# Written by `shiplane setup`; `shiplane doctor` keeps the pin current.
name: Ship
run-name: Ship to ${{ inputs.environment }}${{ inputs.dry-run && ' (dry run)' || '' }}

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
    runs-on: ubuntu-26.04
    environment:
      name: ${{ inputs.environment }}
      deployment: ${{ !inputs.dry-run }} # a dry run reads its secrets, records no deployment
    steps:
      - uses: actions/checkout@v5 # at the tag, with its history
      - uses: arnaud-zg/js-packages/.github/actions/ship@<commit> # shiplane@<version>
        with:
          units: ${{ inputs.units }}
          environment: ${{ inputs.environment }}
          dry-run: ${{ inputs.dry-run }}
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
    steps:
      - uses: arnaud-zg/js-packages/.github/actions/ship@<commit> # shiplane@<version>
        with:
          # units, environment and dry-run as above
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

With no adapter that reads a secret, it passes none.

1. **Create one GitHub Environment per choice** (Settings › Environments): `preview`, `production`;
   for npm packages, `snapshot`, `nightly`, `alpha`, `beta`, `rc` and `latest` too. On npmjs.com,
   trust `ship.yml` for each package (Settings › Trusted publishing): no npm secret.
   [The command, and the error without it](../../packages/shiplane-npm/README.md#-npm-does-not-trust-the-workflow).
2. **Add each adapter's secret to it**, by the name in
   [the sign-ins table](./how-to-hosts.md#set-up-the-sign-ins): `FLY_API_TOKEN`,
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, `EXPO_TOKEN`. Setup passes the ones your
   adapters read; after adding an adapter, `pnpm shiplane doctor` offers to add its secret there.
3. **Ship:** `pnpm shiplane ship --via ci`, or Run workflow in the Actions tab.

A unit that fails never stops the next one. The run page lists what ships before, and how each unit
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
a step with `actions/create-github-app-token` before the action and give it the token:
`github-token`.

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
environment. Where users are runs as soon as you start it.

## Use it from a script

```sh
pnpm -s shiplane status --json
```

Without a terminal every question answers no: pass `--yes` (refused where users are) and `--via`.
`--yes` also follows the runs a ship starts until they end, so the script's exit code is theirs: add
`--no-watch` (or set `watch: false`) to return as soon as they are started.

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
