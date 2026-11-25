[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) · **📖 Reference** · [🔌 Plugins](./plugins.md) ·
[💡 Explanation](./explanation.md)

# 📖 Reference

[Commands](#commands) · [Flags](#flags) · [Exit codes](#exit-codes) ·
[`shiplane.config.ts`](#shiplaneconfigts) · [`shiplane.unit.yml`](#shiplaneunityml) ·
[Modules](#modules) · [Safety](#safety) · [Mascot and `status --json`](./reference-output.md) ·
[`shiplane.yml`](./reference-yaml.md) · [GitHub Actions workflow](#github-actions-workflow)

## Commands

| Command                                     | Does                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shiplane`                                  | The next release step: release PR, merge, tags, ship                                                                                                                                                       |
| `shiplane test-release [channel] [unit...]` | Publish what the pending changesets release, npm only, as a snapshot or on a channel; `--dry-run` (alias `branch`)                                                                                         |
| `shiplane prune-snapshots`                  | Remove the npm tags of snapshots published 30 days ago or more; `--older-than <days>` (7+), `--otp`, `--dry-run`, `--yes` ([how-to](./how-to-test-versions.md#clean-up-old-snapshots))                     |
| `shiplane promote`                          | The next environment, from what the one before runs                                                                                                                                                        |
| `shiplane status`                           | Where every unit stands, and what to run next. Reads only                                                                                                                                                  |
| `shiplane plan`                             | Deprecated: it still runs; use `ship --dry-run` instead                                                                                                                                                    |
| `shiplane version`                          | Open the release PR for what is pending                                                                                                                                                                    |
| `shiplane tag`                              | Tag merged versions, publish their notes                                                                                                                                                                   |
| `shiplane ship [unit...]`                   | Trigger each tagged unit's deploy, then return; `--channel latest`: tag the released packages and publish them                                                                                             |
| `shiplane setup`                            | Find what ships, write the config and unit files, rehearse a release; `--format yaml` writes `shiplane.yml`                                                                                                |
| `shiplane init`, `add`                      | Deprecated: they still run; use `setup` instead                                                                                                                                                            |
| `shiplane remove <unit>`                    | Stop shipping a unit; it stays versioned                                                                                                                                                                   |
| `shiplane doctor`                           | Check the config, tools, sign-ins and [`ship.yml`](#shipyml), offer each fix                                                                                                                               |
| `shiplane doctor --ci [unit...]`            | On a runner: units, `--channel`, tools, secrets. Stops at the first problem ([workflow](#github-actions-workflow))                                                                                         |
| `shiplane plugins`                          | The flow, the modules in release order with their apps, the features                                                                                                                                       |
| `shiplane docs <name>`                      | Every key a module's or an adapter's unit files take                                                                                                                                                       |
| `shiplane migrate`                          | Write `shiplane.yml` from `shiplane.config.ts` and remove the TS config once both release the same; what YAML cannot hold is listed, nothing written ([how-to](./how-to-yaml.md#move-a-ts-config-to-yaml)) |
| `shiplane schema`                           | Write the editor schema of `shiplane.yml`: the plugins installed and your own adapters ([how-to](./how-to-yaml.md#get-autocomplete-in-your-editor))                                                        |
| `shiplane adapter new <name>`               | Scaffold a server hosting adapter, its contract test, its module                                                                                                                                           |

Source: `src/cli/main.ts`. Here, `pnpm shiplane` builds the CLI first when its sources changed.

`shiplane help` shows the ones run day to day: `shiplane`, `promote`, `branch`, `status`, `setup`,
`doctor` and `docs`. `shiplane help all` shows every command and flag.

## Flags

| Flag                      | Means                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `--channel <environment>` | The environment worked on (the first by default)                                            |
| `--via ci\|local`         | Ship through the CI pipeline or this machine, without asking                                |
| `--yes`, `-y`             | Yes to every question, at the computed version. Refused where users are                     |
| `--json`                  | `status` and `plugins` print JSON                                                           |
| `--blank`                 | Deprecated: `init` writes commented templates, not guesses                                  |
| `--verbose`, `--mascot`   | On by default; `--no-` turns off. Defaults: `display` in config                             |
| `--dry-run`               | `shiplane`, `ship`, `promote`: every command it would run, run none                         |
| `--environments a,b`      | `setup`: the environments apps go through, in order, where users are last; asked without it |
| `--ci`                    | `doctor`: check this runner can ship, installing a missing tool                             |

## Exit codes

| Code | Means                                                  |
| ---- | ------------------------------------------------------ |
| `0`  | Done, or nothing to do                                 |
| `1`  | A step failed or was refused; what to run next is said |
| `2`  | The config has problems, each with its file and line   |

## `shiplane.config.ts`

```ts
import { changesetsVersioning } from "@shiplane/changesets";
import { cloudflarePagesStaticHosting } from "@shiplane/cloudflare-pages";
import { easMobileDistribution } from "@shiplane/eas";
import { flyServerHosting } from "@shiplane/fly";
import { gitSourceControl } from "@shiplane/git";
import { gitHubActionsCiPipeline, gitHubCodeHost } from "@shiplane/github";
import { npmPackageRegistry } from "@shiplane/npm";
import {
  backendService,
  defineRelease,
  internalTool,
  mobileApp,
  publishedPackage,
  releaseFlow,
  webApp,
} from "shiplane";

export default defineRelease({
  flow: releaseFlow({
    sourceControl: gitSourceControl(),
    codeHost: gitHubCodeHost(),
    ciPipeline: gitHubActionsCiPipeline(),
    versioning: changesetsVersioning(),
  }),
  deployApps: { promote: [{ from: "preview", to: "production" }] },
  modules: [
    backendService({ serverHosting: flyServerHosting() }),
    webApp({ staticHosting: cloudflarePagesStaticHosting() }),
    mobileApp({ mobileDistribution: easMobileDistribution() }),
    publishedPackage({ packageRegistry: npmPackageRegistry() }),
    internalTool(),
  ],
});
```

| Key               | Means                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow`            | **Required.** One adapter per port: source control, code host, CI, versioning                                                                                                                                                                                                                                                                           |
| `modules`         | What ships, in release order. The first app is the GitHub Latest release                                                                                                                                                                                                                                                                                |
| `features`        | What runs after a ship, in order, such as `releaseComments()`                                                                                                                                                                                                                                                                                           |
| `units`           | Folders to look in. Default: the pnpm workspace, then `package.json` workspaces                                                                                                                                                                                                                                                                         |
| `tag`             | Tag format: `"package"` (`{name}@{version}`, default), `"plugin"` (`{name}--v{version}`, for Claude Code, Gemini CLI and Codex), `"single"` (`v{version}`), `"module"` (`{name}/v{version}`, Go modules), or your own. A format without `{name}` takes one unit                                                                                         |
| `display`         | `{ verbose, mascot }` defaults for the flags; `mascot` may be your own ([Mascot](./reference-output.md#mascot))                                                                                                                                                                                                                                         |
| `testComment`     | The test version's PR comment: `comments.table` (default), `comments.compact`, or your own text with `{branch}` `{commit}` `{table}` `{install}` ([how-to](./how-to-test-versions.md#publish-a-test-version))                                                                                                                                           |
| `testRelease`     | Which channel each branch's test release takes: `testReleases.nightly`, `.prerelease`, `.gitflow`, or `{ branch: channel }` with `*` patterns; unlisted branches publish a snapshot ([how-to](./how-to-test-versions.md#give-each-branch-a-channel))                                                                                                    |
| `via`             | `"ci"` (the flow's CI pipeline) or `"local"` (this machine): how an app ships when both ways can, so a ship stops asking. `--via` wins for one run; a way that cannot ship takes the other                                                                                                                                                              |
| `deployApps`      | Deployed apps only, **required as soon as one deploys**: `{ promote: [{ from, to }], onBranch }`, the way to users and where a branch may deploy. [How-to](./how-to-destinations.md#deploy-apps-through-your-environments)                                                                                                                              |
| `publishPackages` | Published packages only: `{ channels, onBranch }`, where they publish and what a branch may publish. [How-to](./how-to-destinations.md#publish-packages-on-channels)                                                                                                                                                                                    |
| `prepare`         | A shell command run from the root before each unit ships from this machine or a runner, never before a CI dispatch, and [before a release](#build-before-a-release): `{unit}` its name, `{dir}` its folder, such as `"pnpm --filter {unit}... build"`. A failure fails that unit. Any other `{…}` fails loading: `unknown placeholder {app} in prepare` |

Source: `src/application/config/defineRelease.ts`. A `release.config.ts` still loads, with a line
saying to rename it.

**Release order:** by module in `modules` order, then by name. An app reading another's value
(`${units.api.url}`) must come after it, or loading fails and names the module to move.

### Build before a release

`pnpm shiplane` builds every picked unit before it writes anything: no release PR, tag or publish
happens before every build passed. It runs after the sign-in and env checks, with `--yes` too.

| The config           | What runs for each picked unit                                                               |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Has a `prepare`      | That command, from the root                                                                  |
| Has none             | Its `buildCommand`, else its `build` script; the workspace packages it uses first, if needed |
| Has nothing to build | Nothing                                                                                      |

- **A picked unit always builds**, even when its build looks current, and once even when another
  picked unit uses it. One failure stops the run.
- **After a release PR merges**, what ships from this machine builds again: its version moved.
- **With no release PR to merge**, a unit built here is not built again before it ships. A `prepare`
  still runs again before each ship when several units are picked, since one may overwrite what
  another wrote.
- **A build that changes tracked files** stops the run: they would join the release PR.
- `ship`, `promote` and test versions are unchanged.

Source: `src/application/buildBeforeRelease.ts`.

### Build before publishing

Right before a package publishes, shiplane runs its `buildCommand`, else its `build` script, when
its build is missing or out of date. It never runs when the config has a `prepare`, which always
runs instead, and never for an app its host builds.

| It builds when                                                               | Compared with            |
| ---------------------------------------------------------------------------- | ------------------------ |
| An entry file (`main`, `module`, `types`, `bin`, `exports`) is missing       | `publishConfig` wins     |
| A source, a root file or a workspace package it uses is newer than an entry  | Entries git ignores only |
| No entry is a file git ignores, so nothing says whether the build is current |                          |

The workspace packages it uses are checked and built first, development ones included. A failed
build publishes nothing. `--dry-run` shows the command, marked "if needed".

Source: `src/application/buildIfNeeded.ts`.

## `shiplane.unit.yml`

One per app, next to its `package.json`, which gives its name and version. Every module has one;
[`examples/repository`](../../packages/shiplane/examples/repository/shiplane.config.ts) holds one of
each.

```yaml
module: backend-service # a module of shiplane.config.ts
app: # every other key belongs to that module's plugin
  preview: acme-api-preview
  production: acme-api
url: ${units.other.url} # another unit's value, same environment
checkEnvBeforeDeploy: # env var names a deploy waits for, read on the platform
  - SENTRY_DSN
```

- A map keyed by the environments of `deployApps.promote`, all of them, is a value per environment.
- An unknown key or module is refused, with its line and the closest match.
- `shiplane docs <module>` lists every key and its default. Keys per plugin:
  [Plugins](./plugins.md).
- A `release.unit.yml` still loads, with a line saying to rename it.
- `checkEnvBeforeDeploy` belongs to shiplane, not to the module. It is one list for every
  environment, or `all` plus a list per environment. Each name is UPPER_SNAKE. A name not listed is
  never checked. See [Check env before deploy](./how-to-apps.md#check-env-before-deploy).

## Modules

| Module                                  | `module:`           | Takes a plugin for   |
| --------------------------------------- | ------------------- | -------------------- |
| `backendService({ serverHosting })`     | `backend-service`   | Server hosting       |
| `webApp({ staticHosting })`             | `web-app`           | Static hosting       |
| `mobileApp({ mobileDistribution })`     | `mobile-app`        | Mobile distribution  |
| `publishedPackage({ packageRegistry })` | `published-package` | A package registry   |
| `agentPlugin()`                         | `agent-plugin`      | Nothing: see below   |
| `internalTool()`                        | `internal-tool`     | Nothing: tagged only |

`agentPlugin()` is a plugin for coding agents. The release PR writes its version into each agent
manifest in its folder that has one: `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
`.cursor-plugin/plugin.json`, `gemini-extension.json`. Then it is tagged; nothing deploys it. Pair
it with `tag: "plugin"`.

A published package, an agent plugin and an internal tool have no environment, so a run names none:
it asks to release them live, not to preview. A repository mixing them with an app that deploys
reads `preview`, since the app does go there.

Each takes an optional `name`, for two modules of one kind:
`backendService({ name: "workers", ... })` then `module: workers`. Source: `src/modules/`.

## Safety

- **Sign-ins first.** `shiplane` checks the picked units' tools before writing anything, and offers
  each fix.
- **Undo on failure.** A failed step undoes what ran, newest first: PRs closed, branches deleted,
  tags removed, back on `main`. A tag already pushed stays on origin, said with `shiplane tag` to
  finish its notes. What it cannot undo is printed as commands.
- **Retries.** A dropped push or pull is tried twice more, after 2s then 10s.
- **Where users are asks.** You type its name to start, and `--yes` is refused there.
- **A forced version says why.** Any version but the computed one takes a line for the release
  notes, and a version versioning cannot land on stops the run before anything is written.

Source: `src/application/steps.ts`, `src/application/requirements.ts`, `src/application/ship.ts`,
`src/application/chooseVersion.ts`.

## GitHub Actions workflow

On a runner (`GITHUB_ACTIONS=true`) the workflow runs
`shiplane doctor --ci <units> --channel <env>`, then
`shiplane ship <units> --channel <env> --yes --no-mascot`: a log reads plainer without the mascot,
whatever `display.mascot` says. `ship` there ships every unit even when one fails, each in its own
log group, writes a plan table and a result table (`Prepare`, `Ship`: success, failed or skipped) to
`GITHUB_STEP_SUMMARY`, and exits 1 when any failed.

| Check             | Supported                                                                                                                    | Fails with                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Package manager   | pnpm, npm, yarn, from `packageManager` in package.json, else the lockfile                                                    | `unsupported package manager "bun": pnpm, npm or yarn`, or `no package manager: add packageManager to package.json, or a lockfile` |
| Node version      | the `node-version` input, else `.nvmrc`, `.node-version`, `engines.node`, first found                                        | `no Node version: add .nvmrc or set node-version`                                                                                  |
| Units             | Names from the config; none means every unit                                                                                 | `unknown units [x]: known [a, b]`                                                                                                  |
| Environment       | Those of `deployApps.promote`; with packages, also `latest` and any test release channel                                     | `unknown environment "qa": preview, production`                                                                                    |
| Prepare           | `prepare` with `{unit}` and `{dir}`, run before each unit                                                                    | `unknown placeholder {app} in prepare`                                                                                             |
| Deploy tools      | Each picked unit's tools; a missing one runs its Linux install, its folder added to `PATH` and `GITHUB_PATH`                 | `flyctl missing and no install for linux`                                                                                          |
| Secrets           | Each picked unit's: `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, `EXPO_TOKEN`; the flow's `GH_TOKEN` | `api ships with fly: FLY_API_TOKEN missing in "preview"`                                                                           |
| Working directory | The repository root, or the `working-directory` input naming a folder holding `shiplane.config.ts` or `shiplane.yml`         | `no shiplane.config.ts or shiplane.yml in apps/x`                                                                                  |

### Channels and npm tags

A channel is the npm tag it publishes under:

| Channel               | Installed with                    | Starts with                               |
| --------------------- | --------------------------------- | ----------------------------------------- |
| `nightly`             | `npm i <pkg>@nightly`             | `shiplane test-release nightly`           |
| `alpha`, `beta`, `rc` | `npm i <pkg>@beta`                | `shiplane test-release beta`              |
| a word of your own    | `npm i <pkg>@canary`              | `shiplane test-release canary`            |
| `snapshot`            | the exact version, no tag is kept | `shiplane test-release snapshot`          |
| **`latest`**          | `npm i <pkg>`                     | `shiplane`, once its release PR is merged |

`latest` is the real release, never a test release's. A package whose unit file sets its own
[`tag`](../../packages/shiplane-npm/README.md#-unit-file-keys) publishes under that one instead.

### What each destination does

`shiplane ship --channel <name>`, or the same name in `ship.yml`:

|               | An environment                                   | `latest`                           | A test channel                         |
| ------------- | ------------------------------------------------ | ---------------------------------- | -------------------------------------- |
| Ships         | tagged apps, and packages released with them     | packages whose version is released | packages with pending changesets       |
| Version       | the tag's                                        | the one the release PR wrote       | the next one, plus `-<channel>.<n>`    |
| Needs first   | the version on the environment before            | the release PR merged              | a pending changeset                    |
| Writes to git | nothing                                          | the tags and the release notes     | nothing                                |
| Asks          | where users are: its name typed, `--yes` refused | to tag, then to publish            | which packages, and CI or this machine |
| Already there | skipped                                          | skipped, or only the npm tag moves | takes the next number                  |
| Stops when    | not on the environment before yet                | `main` moved past the tag          | uncommitted changes                    |

**An environment.** For each tagged app: skip it if that version is already deployed there, refuse
it if the environment before does not run it, run `prepare`, deploy, then record the deploy.
`shiplane promote` is the same on the next environment, after showing how the one before runs.

**`latest`.** Tags each released version on the commit that brought it and publishes its notes, then
for each package: skip it if npm has it under the tag, move the tag if npm has the version, else
publish. With
[staged publishing](../../packages/shiplane-npm/README.md#%EF%B8%8F-staged-publishing-recommended)
it is uploaded, and public once a person approves it on npm. The git tags and notes do not wait for
that.

**A test channel.** Takes the next free number, writes it to `package.json`, builds, publishes under
the channel's tag, puts `package.json` back even when it fails, and comments on the branch's pull
request. `snapshot` uses the branch and commit instead of a number and drops its tag; with
`deployApps.onBranch` it also
[deploys the branch's apps](./how-to-test-versions.md#deploy-a-branch).

With packages, a name that is no environment publishes them: `latest` the released ones, any other
as `shiplane test-release <name> <units>`. The caller lists the names as choices and allows
`contents: write` and `id-token: write`. `ref` is then ignored: the run publishes the ref it is on,
so the environment's branch rule holds. `dry-run: true` shows what would ship and records no
deployment.

`doctor --ci` stops at the first problem and prints this section's link. Source:
`src/application/doctorCi.ts`, `src/application/shipSteps.ts`.

### `ship.yml`

`shiplane setup` writes `.github/workflows/ship.yml` when it is missing, never over one there: a
manual run (`units`, `environment`, `ref`) using the `.github/actions/ship` action, pinned to the
commit of the installed shiplane's tag (`uses: …/actions/ship@<sha> # shiplane@x.y.z`). A test
version (`x.y.z-<branch>.<short sha>`) has no tag: it pins the commit its short sha names, or says
`no commit <short sha> for shiplane@x.y.z-…: pin ship.yml by hand` when GitHub does not know it. Any
other unreleased version: `no release tag shiplane@x.y.z: pin ship.yml by hand`.

A tag holds the `ship.yml` of the day it was cut. So that a ship, or its retry, runs today's
workflow, `shiplane ship --via ci` starts the run on the default branch and passes the tag as `ref`:
`gh workflow run ship.yml --ref main -f units=api -f environment=preview -f ref=api@1.2.0`. It
checks out `ref`, so what deploys is the tag's code, never main's.

Its `environment` input lists where the repository ships: apps' environments, then packages'
`channels`, as the config says. Writing one that lists a channel, setup also gives it the
permissions npm needs and a `dry-run` input. With neither key set, doctor leaves an existing list as
it is.

It passes, by name, only the secrets the configured adapters read (their requirements' `secrets`,
sorted, but `GH_TOKEN`, which the action sets itself). Its `permissions:` are `contents: read`,
`deployments: write`, `actions: read`, plus `issues: write` and `pull-requests: write` when
`features` holds `releaseComments`. An adapter can ask for more, such as `contents: write` and
`pages: write` for GitHub Pages. The variables a unit's build reads are in the job's `env:`, by
name.

The action declares the secrets it accepts, and gives them, with `GH_TOKEN`, only to its
`Check what ships` and `Ship` steps' `env:`; nothing goes to `$GITHUB_ENV`:

| Secret                  | Read by                        |
| ----------------------- | ------------------------------ |
| `FLY_API_TOKEN`         | `flyServerHosting`             |
| `CLOUDFLARE_API_TOKEN`  | `cloudflarePagesStaticHosting` |
| `CLOUDFLARE_ACCOUNT_ID` | `cloudflarePagesStaticHosting` |
| `EXPO_TOKEN`            | `easMobileDistribution`        |

A third-party plugin's secret goes in the job's `env:`: every step then sees it.

With ship.yml using shiplane, setup adds the preset
`github>arnaud-zg/js-packages//renovate/shiplane` to `extends` in a JSON Renovate config
(`renovate.json`, `.github/`, `.gitlab/`, `.renovaterc`, `.renovaterc.json`) that lacks it, names
the entry to add for a JSON5 or `package.json` config, and creates none.

`shiplane doctor` checks it on a laptop, not on a runner:

| Found                                                         | Fix offered                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ship.yml missing`                                            | Write it (yes by default; `--yes` writes it). Not said when `via` is `local` |
| `ship.yml does not ship with shiplane`                        | Replace it (no by default; never with `--yes` or unattended)                 |
| `ship.yml pins shiplane@0.5.2, installed 0.6.0`               | Re-pin: the `uses:` line                                                     |
| `ship.yml passes no EXPO_TOKEN, and apps/expo ships with eas` | Rewrite only `secrets:` and `permissions:` (`--yes` rewrites them)           |

The secrets check also says `ship.yml passes SENTRY_TOKEN, which no adapter needs` and
`ship.yml passes every secret (inherit), not only FLY_API_TOKEN`. Its fix keeps the rest of the file
as written.

Pinned to the installed version and passing the secrets its adapters read, it prints one
`✓ ship.yml` line. Source: `src/application/callerWorkflow.ts`.

### Setup Node project action

`.github/actions/setup-node-project` is a composite action holding the steps the ship action runs
before it ships: detect the package manager and Node version, set up pnpm, Node or yarn, restore
`node_modules`, and install. `actions/cache` saves `node_modules` at the end of the job, in its post
step, after a miss and only when the job succeeded. It fails on the same checks, except that it
needs no `shiplane.config.ts`: any Node repository can use it. It checks nothing out and reads no
secret. Pin it like the workflow, to a release commit:
`uses: arnaud-zg/js-packages/.github/actions/setup-node-project@<sha> # shiplane@x.y.z`.

| Input               | Default | Meaning                                                                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `node-version`      | `""`    | Last resort: a Node version, when there is no `.nvmrc`, `.node-version`, or `engines.node` |
| `install-command`   | `""`    | Last resort: the install command; skips the `node_modules` cache                           |
| `working-directory` | `.`     | Last resort: the folder holding `package.json`                                             |

| Output            | Value                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| `package-manager` | `pnpm`, `npm` or `yarn`                                                           |
| `exec`            | The prefix that runs an installed binary: `pnpm exec`, `npx --no-install`, `yarn` |
| `cache-hit`       | `true` when `node_modules` came from the cache, and the install was skipped       |

The workflow keeps its own copy of these steps, since a reusable workflow cannot use an action from
its own commit; a test fails when the two differ. Source:
`.github/actions/setup-node-project/action.yml`. The Renovate preset updates its pin too.

## Example

[`examples/render-server-hosting.ts`](../../packages/shiplane/examples/render-server-hosting.ts)
defines a server hosting plugin with settings, requirements and jobs;
`packages/shiplane-integration/src/__tests__/writeAPlugin.test.ts` runs it against the contract.
