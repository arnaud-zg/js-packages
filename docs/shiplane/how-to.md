[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) · **🛠️ How-to** ·
[📖 Reference](./reference.md) · [🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to

**Apps:** [Add an app](#add-an-app) · [Stop shipping an app](#stop-shipping-an-app) ·
[Set a value per environment](#set-a-value-per-environment) ·
[Read another app's value](#read-another-apps-value) ·
[Check env before deploy](#check-env-before-deploy) · [Hold an app back](#hold-an-app-back)

**Release:** [Force another version](#force-another-version) ·
[Preview every command](#preview-every-command) · [Promote to production](#promote-to-production) ·
[Widen a production rollout](#widen-a-production-rollout) ·
[Retry a failed release](#retry-a-failed-release) ·
[Publish a test version](#publish-a-test-version) ·
[Choose GitHub Actions or this machine](#choose-github-actions-or-this-machine) ·
[Ship from GitHub Actions](#ship-from-github-actions) ·
[Set up any Node project in your workflow](#set-up-any-node-project-in-your-workflow) ·
[Ship with no laptop](#ship-with-no-laptop) · [Use it from a script](#use-it-from-a-script)

**Hosts:** [Publish a package to npm](#publish-a-package-to-npm) ·
[Release Claude Code plugins](#release-claude-code-plugins) ·
[Choose how versions are bumped](#choose-how-versions-are-bumped) ·
[Release from commits](#release-from-commits) · [Shape release notes](#shape-release-notes) ·
[Ship a host with no plugin](#ship-a-host-with-no-plugin) · [Swap a provider](#swap-a-provider) ·
[Write a plugin](#write-a-plugin) · [Comment on what shipped](#comment-on-what-shipped) ·
[Set up the sign-ins](#set-up-the-sign-ins)

**Terminal:** [Bring your own mascot](#bring-your-own-mascot) ·
[Turn the mascot off](#turn-the-mascot-off)

## Add an app

```sh
pnpm shiplane setup
```

Run again, setup keeps your config and unit files and asks only about the new folder. Or write
`apps/docs/shiplane.unit.yml` yourself; `shiplane docs web-app` lists its keys:

```yaml
module: web-app
project: acme-docs
```

## Stop shipping an app

```sh
pnpm shiplane remove docs
```

Its unit file goes. Changesets still version it.

## Set a value per environment

```yaml
app:
  preview: acme-api-preview
  production: acme-api
```

## Read another app's value

```yaml
build:
  env:
    VITE_API_URL: ${units.api.url}
```

The app read must ship first: list its module before the reader's in `modules`.

## Check env before deploy

List the env var names an app reads. Before each deploy, shiplane checks they are set on the
platform. You set the values; shiplane only reads names, never values.

```yaml
# apps/api/shiplane.unit.yml
checkEnvBeforeDeploy:
  - SENTRY_DSN
  - DATABASE_URL
```

Names that differ per environment: `all` holds the shared ones, and an environment adds its own. A
new environment inherits `all`.

```yaml
checkEnvBeforeDeploy:
  all:
    - SENTRY_DSN
  production:
    - REVENUECAT_PROJECT_ID
```

| When a name is unset               | What happens                                             |
| ---------------------------------- | -------------------------------------------------------- |
| In a terminal                      | It prints the command to set it, waits, then reads again |
| In CI, with `--yes` or no terminal | Nothing runs; it prints the command and exits 1          |
| The plugin cannot list names       | A warning, and the deploy goes on                        |

Fly reads its secrets and the fly.toml `[env]` keys, EAS its environment's variables, and Cloudflare
Pages its secrets plus the unit's `build.env`. `shiplane doctor` shows the same check for every
environment. `release`, `promote` and `ship` check before anything deploys; a release to preview
checks before it opens the release PR.

## Hold an app back

Untick it when `pnpm shiplane` asks what to release. Its changesets wait for the next release.

## Force another version

When everything a release moves lands on one version, `pnpm shiplane` asks for it, with the computed
version selected:

```text
◆  Release these to preview as (Esc cancels)
│  ○ 1.0.0  major
│  ● 0.5.0  minor, computed
│  ○ 0.4.1  patch
```

Enter releases the computed version. Pick another and it asks why, in one line, with the usual
reason already typed:

```text
◆  Why 1.0.0? Tell users what changed, in one line.
│  Breaking change the changesets missed
```

Enter takes it; type over it to say what changed, like `Drops subjectsSince from SourceControlPort`.
Going up to a minor offers `New feature the changesets called a fix`, going down
`Changesets overstated the change`. Esc or an empty line goes back to the versions. The line reaches
the changelog, the release PR and the release notes, as
`Version forced to 1.0.0 instead of 0.5.0: Drops subjectsSince from SourceControlPort`. Everything
the release moves takes the forced version, a whole fixed group included, and a changeset's own bump
gives way when you go lower.

- **Units moving to different versions** get a plain yes: untick the others to force one.
- **`--yes` and a run without a terminal** keep the computed version.
- **An open release PR** has its version already: close it and run `pnpm shiplane` to change it.
- **A release PR replaced because main moved** starts again from the computed version, so force it
  again. `--yes` will not ask.
- **Versioning that cannot land there**, a peer dependency pulling a unit further, stops with
  `Can't force` and writes nothing.

## Preview every command

```sh
pnpm shiplane ship --dry-run        # preview
pnpm shiplane promote --dry-run     # production
```

Nothing runs. It prints the release order, then each command, both ways.

## Promote to production

```sh
pnpm shiplane promote
```

Type `production` when asked. Web apps redeploy the tag preview runs; the mobile app may first open
a PR moving its production version, then build after you merge it.

## Widen a production rollout

Run `pnpm shiplane promote` again and pick the mobile app. It shows the rollout, its launches and
crashes, and suggests the next step: 25%, 50%, everyone, stay, or roll back.

## Retry a failed release

```sh
pnpm shiplane
```

Run the same command again. It reads what is already done and skips it: an open release PR is picked
up, a pushed tag is not made twice, notes already published are kept. Only the step that failed runs
again.

A unit whose ship failed comes back ticked in the first question, as `released, not on preview yet`
(`not live yet` for a package, `never reached preview: retry` for a mobile app). Press Enter and it
goes straight to the ship.

To redeploy one unit without the questions:

```sh
pnpm shiplane ship my-api                      # add --channel production for production
```

If the unit is greyed out as `deploying already`, a GitHub deployment is still marked in progress.
Find its run with `gh run list --limit 5` and rerun it from GitHub.

### A mobile build failed and main moved on

```sh
pnpm shiplane ship expo
```

When a version never reached preview and main has moved since its tag, it offers that version again,
exactly as released:

```
  expo 0.6.0 didn't reach preview: the iOS build failed 2h ago.
  main has 3 commits since its tag (apps/expo/app.config.ts, packages/app/src/home.tsx).
◆  What should ship?
│  ● Retry 0.6.0 exactly as released
│  ○ Release the new code instead (pnpm changeset, then shiplane)
│  ○ Cancel
```

With nothing for the version on EAS, it asks
`Did the last attempt to ship 0.6.0 fail before it got this far?` instead. A retry ships the tag's
commit, never main: through GitHub Actions, the ship workflow runs on the tag; from this machine, it
runs in a temporary `git worktree` at the tag, with `pnpm install` and your ignored `.env*` files
copied in, removed afterwards even when the build fails. Picking Retry is the go-ahead: only the
GitHub Actions or this machine question follows.

Each platform gets only what it misses, read from EAS:
`tag ✓, release notes ✓, Android ✓ build 42, iOS ✗ failed → build iOS, then submit`. A platform
whose build finished but whose submission failed is only submitted again; one still building is left
to finish. A failed submission is offered even when main only changed JavaScript. An update the tag
released that already went out counts as done: it is on preview, nothing is offered. Tags, release
notes and PR comments already made are not made twice.

With no terminal, or on CI, it refuses and says the retry is there in a terminal. Preview only, and
never when main is behind the last preview build.

## Publish a test version

A test release publishes what your **pending changesets** release, before the real release, for
testers to install. From any branch, main included; no pull request needed. npm packages only for
now: other pending units are listed as not available yet. Snapshots are temporary, not a release to
depend on: their tags are [cleaned up](#clean-up-old-snapshots) once old.

```sh
pnpm shiplane test-release              # the branch's channel: a snapshot unless configured
pnpm shiplane test-release beta         # this run on beta: 0.6.0-beta.2 under npm tag beta
pnpm shiplane test-release --dry-run    # each package's version and npm tag, nothing published
```

Each version builds on the version the changesets give the package next, so it always sorts above
the last release. Two kinds of channel:

| Channel                                    | Version              | npm tag  | Lifetime              |
| ------------------------------------------ | -------------------- | -------- | --------------------- |
| `snapshot` (default)                       | `0.6.0-main.329aafb` | none     | one per commit        |
| `nightly`, `alpha`, `beta`, `rc`, any word | `0.6.0-beta.<n>`     | the word | `<n>` +1 each publish |

`<n>` is the next number npm does not hold for that version and channel, from 0. Nothing is written
to git: no tag, no commit; versions are written to `package.json` for the publish and put back
after, even when it fails. `latest` stays the real release's: no test release can use it. A snapshot
keeps no npm tag: npm needs one to publish, so it goes out under `snapshot` and loses it right
after, and no branch leaves a tag behind. Testers install it by its exact version, which the install
lines give.

In a terminal, plain `pnpm shiplane` on a feature branch asks first; with two pending packages or
more, you pick which ones get a test release:

```text
◆  You're on feat/x, not main.
│  ● Publish a test release    0.6.0-feat-x.ae08284 → no npm tag
│  ○ Switch to main            git switch main && git pull, then the real release
```

### Which channel, when

Each test release is one you run by hand with `pnpm shiplane test-release`, when you need it;
nothing publishes one by itself. A snapshot is enough most of the time:

| Channel   | Use it when                                                       | Skip it when                                |
| --------- | ----------------------------------------------------------------- | ------------------------------------------- |
| snapshot  | Someone tries one pull request before it merges                   | Never: it is the default                    |
| `nightly` | Consumers want what is on main before the release                 | Main has not changed since the last nightly |
| `alpha`   | A major version is under way and its API still changes            | Patches and minors                          |
| `beta`    | The major's features are done; testers check them for 1–2 weeks   | Patches and minors                          |
| `rc`      | The release is ready; it ships after a few quiet days with no fix | A small, low-risk patch                     |

For a patch or a minor, snapshots and the real release are all you need.

### Give each branch a channel

Without a setting, every branch publishes a snapshot. To give a branch its own channel when you run
`pnpm shiplane test-release` with no word, pick a preset or write one map. Hover any name in your
editor for what it publishes.

```ts
import { defineRelease, testReleases } from "shiplane";

export default defineRelease({
  // …
  testRelease: testReleases.gitflow,
});
```

| Preset                    | Map                                                                   |
| ------------------------- | --------------------------------------------------------------------- |
| _(none)_                  | every branch a snapshot                                               |
| `testReleases.nightly`    | `{ main: "nightly" }`                                                 |
| `testReleases.prerelease` | `{ main: "nightly", next: "alpha", beta: "beta", "release/*": "rc" }` |
| `testReleases.gitflow`    | `{ develop: "nightly", "release/*": "beta", "hotfix/*": "rc" }`       |

Your own: a key is a branch or a `*` pattern, the value a channel. The exact name wins, then the
longest pattern; a branch not listed publishes a snapshot.

```ts
import { channels, defineRelease } from "shiplane";

export default defineRelease({
  // …
  testRelease: { main: channels.nightly, "release/*": channels.beta }, // or plain "nightly", "beta"
});
```

### The pull request comment

With an open pull request, one comment on it, edited on each run, gives the commit, each package and
version linked on npmjs (plain text for another registry), install lines pinned to the exact
version, the tag to follow instead, and the pending units not available as test releases yet. Pick
another layout with `testComment`:

```ts
import { comments, defineRelease } from "shiplane";

export default defineRelease({
  // …
  testComment: comments.compact, // or comments.table (the default), or your own text
});
```

| `testComment`         | The comment                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `comments.table`      | The install table above                                                                   |
| `comments.compact`    | `` 📦 Test version of `feat/x` ([`a1b2c3d`](…)): `npm i shiplane@0.6.0-feat-x.a1b2c3d` `` |
| `"Try it: {install}"` | `` Try it: `npm i shiplane@0.6.0-feat-x.a1b2c3d` ``                                       |

Your own text takes `{branch}`, `{commit}` (linked), `{channel}`, `{table}` (the install table with
its notes) and `{install}` (one `npm i` line for every package). A hidden marker goes on top, so the
same comment is edited whatever the text.

It refuses uncommitted changes. With no pending changeset it says to add one (`pnpm changeset`). The
default branch is read from git (`origin/HEAD`, else `main` or `master`);
`gitSourceControl({ main })` sets it.

### Clean up old snapshots

> **Warning:** snapshots are for trying a change, not for depending on. A snapshot's npm tag, and in
> time the version itself, can be removed at any point: never pin a snapshot in anything that must
> keep installing. Depend on a released version, or on a numbered channel such as `beta`.

Snapshots used to be tagged with their branch name, and a run that stops partway can leave the
`snapshot` tag behind. `prune-snapshots` removes those npm tags once their version is old:

```sh
pnpm shiplane prune-snapshots --dry-run            # each old snapshot tag, nothing removed
pnpm shiplane prune-snapshots --otp 123456         # remove them, one code for all
pnpm shiplane prune-snapshots --older-than 60      # a longer wait than the 30-day default
```

- **What counts as old:** the version the tag points at was published 30 days ago or more. A branch
  still under test publishes a newer snapshot well within that, so its testers are never cut off.
  `--older-than` takes 7 days or more; a version npm gives no publish time for is never old.
- **What it touches:** only tags a shiplane snapshot gives, on a snapshot version
  (`0.6.0-feat-x.ae08284` under `feat-x`, `branch-feat-x` or `snapshot`). Never `latest`, a tag on
  the version `latest` points at, a numbered channel such as `beta`, or a tag of your own.
- **What stays:** the version. Only its tag goes, so `npm i shiplane@0.6.0-feat-x.ae08284` still
  installs.
- **Two-factor accounts:** pass the code with `--otp`. A code lasts about 30 seconds; in a terminal,
  a removal that fails asks for a fresh one and retries. Anywhere else it stops, and running it
  again with a fresh `--otp` picks up the tags still there.
- **Asking first:** in a terminal it lists the tags and asks; elsewhere it needs `--yes`.

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
2. **Add each adapter's secret to it**, by the name in [the sign-ins table](#set-up-the-sign-ins):
   `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, `EXPO_TOKEN`. Setup lists
   the ones your adapters read under `secrets:`; after adding an adapter, `pnpm shiplane doctor`
   offers to add its secret there.
3. **Ship:** `pnpm shiplane ship --via ci`, or Run workflow in the Actions tab.

A unit that fails never stops the next one. The run page shows what ships before, and how each unit
went after; the run fails when one did.

**Build before shipping.** Set `prepare` in `shiplane.config.ts`. It runs before each unit ships,
from the repo root, on your laptop and on the runner alike: `{unit}` is the unit's name, `{dir}` its
folder.

```ts
export default defineRelease({ prepare: "pnpm turbo run build typecheck --filter=./{dir}" });
```

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

## Publish a package to npm

```yaml
# packages/my-tool/shiplane.unit.yml
module: published-package
```

Needs `publishedPackage({ packageRegistry: npmPackageRegistry() })` in `modules`. A release
publishes under `latest`; to stage under `next` first, add
`tag: { preview: next, production: latest }`. A new package needs no changeset for its first
version: merge it, then run `pnpm shiplane`.

## Release Claude Code plugins

```ts
export default defineRelease({
  units: ["plugins/*"],
  tag: "plugin",
  flow: releaseFlow({
    sourceControl: gitSourceControl(),
    codeHost: gitHubCodeHost(),
    ciPipeline: gitHubActionsCiPipeline(),
    versioning: changesetsVersioning(),
  }),
  modules: [agentPlugin()],
});
```

```yaml
# plugins/reviewer/shiplane.unit.yml, next to a private package.json changesets versions
module: agent-plugin
```

The release PR writes each plugin's new version into every agent manifest it has
(`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`,
`gemini-extension.json`), one line each. After the merge, `reviewer--v0.8.0` is tagged with its
changelog as notes. Nothing deploys a plugin: agents install it from the repository, so the merge
ships it, and a run names no environment: it asks to release it live, as for a package on npm. A
manifest with no `version` is left alone.

Queue each release with `pnpm changeset`, as for any unit, or
[release from commits](#release-from-commits).

## Choose how versions are bumped

**Write the changelog yourself?** Use `changesetsVersioning()`. **Let PR titles be the changelog?**
Use `commitsVersioning()`.

Both run on [changesets](https://github.com/changesets/changesets) under the hood: commits mode only
writes the changesets for you, from the PR titles. Both bump the same way:

| PR title         | Bump                             |
| ---------------- | -------------------------------- |
| `feat`           | minor                            |
| `fix`, `perf`, … | patch                            |
| `!` (breaking)   | minor below `1.0.0`, major after |

With `changesetsVersioning()`, add one in the feature PR, bump taken from that table:

```sh
pnpm changeset --minor shiplane -m "What users can now do."
```

Changesets never picks the bump: it releases what the file says, so a `feat` written as `--patch`
ships as a patch. Before merging, `pnpm changeset status --verbose` lists the version each package
gets.

With `commitsVersioning()`, there's nothing to write: the PR title sets the bump, see
[Release from commits](#release-from-commits).

## Release from commits

`shiplane setup` offers this when the repository has no `.changeset/config.json`, and `--yes` takes
it: setup writes that file and adds `@changesets/cli`, and you run the install. A repository already
on changesets is not asked. To move one, swap the versioning adapter and no one writes a changeset:

```ts
import { commitsVersioning } from "@shiplane/changesets";

export default defineRelease({
  flow: releaseFlow({
    sourceControl: gitSourceControl(),
    codeHost: gitHubCodeHost(),
    ciPipeline: gitHubActionsCiPipeline(),
    versioning: commitsVersioning(),
  }),
  modules: [agentPlugin()],
});
```

Each package's commits since its version become its release, read as Conventional Commits:

| Subject               | Bump                   | Changelog                                     |
| --------------------- | ---------------------- | --------------------------------------------- |
| `feat: ...`           | minor                  | One line                                      |
| `fix:` or `perf: ...` | patch                  | One line                                      |
| `refactor!: ...`      | major, minor below 1.0 | One line, for any type marked `!`             |
| Anything else         | patch                  | Only the latest, when nothing else has a line |

Any commit touching a package releases it, so a change committed as `chore:` still ships. Only the
subject counts: a `BREAKING CHANGE:` footer is not read. A pending changeset naming a package takes
over from its commits. `.changeset/config.json` and `@changesets/cli` stay, as changesets still does
the versioning, and shiplane's own messages keep saying `changesets`.

## Shape release notes

Two options shape the section a release writes in each CHANGELOG.md, and so its GitHub release:
`line` for each change, `thanks` for the people. Both take a preset or your own text, and
`commitsVersioning()` takes them too. Both read what `@changesets/changelog-github` writes, so they
need it in `.changeset/config.json`.

```ts
import { changesetsVersioning, lines, presets } from "@shiplane/changesets";

versioning: changesetsVersioning({ line: lines.whatsChanged, thanks: presets.none }),
```

This repository's own release notes then read like GitHub's "What's Changed":

> ### Patch Changes
>
> - Exit 1 on a bad config by @octocat in https://github.com/arnaud-zg/js-packages/pull/62
>
> **Full Changelog**:
> https://github.com/arnaud-zg/js-packages/compare/shiplane@1.24.0...shiplane@1.24.1

The `**Full Changelog**` link goes in the GitHub release only, whatever the options, when the
package has a tag before this one.

### Each change: `line`

| `line`                                   | One change becomes                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| unset                                    | `- [#62](…) [`a1b2c3d`](…) Thanks [@octocat](…)! - Exit 1 on a bad config` |
| `lines.whatsChanged`                     | `* Exit 1 on a bad config by @octocat in https://github.com/…/pull/62`     |
| `lines.compact`                          | `- Exit 1 on a bad config (https://github.com/…/pull/62)`                  |
| `"- {summary}, thanks {authors} ({pr})"` | `- Exit 1 on a bad config, thanks @octocat (https://github.com/…/pull/62)` |

`{summary}` is the change as written, `{authors}` `@a and @b`, `{pr}` the pull request's URL, which
GitHub shows as `#62`. A change with no pull request, such as a direct push, keeps the line
changesets wrote. With `commitsVersioning()`, a subject ending in `(#62)` names its pull request.

### The people: `thanks`

With `@changesets/changelog-github`, every line says `Thanks @someone!`. To thank everyone once,
give the versioning adapter a template. The quickest is a preset:

```ts
import { changesetsVersioning, presets } from "@shiplane/changesets";

versioning: changesetsVersioning({ thanks: presets.sentence }),
```

Each preset, on a release by `@arnaud-zg`:

**`presets.sentence`** (one plain line, readable everywhere: the recommended pick)

> ### Patch Changes
>
> - [#51](https://github.com/arnaud-zg/packages/pull/51) A unit file can list
>   `checkEnvBeforeDeploy`…
>
> 🙏 Thanks to [@arnaud-zg](https://github.com/arnaud-zg) for this release!

**`presets.list`**

> ### Patch Changes
>
> - [#51](https://github.com/arnaud-zg/packages/pull/51) A unit file can list
>   `checkEnvBeforeDeploy`…
>
> ### Contributors
>
> - [@arnaud-zg](https://github.com/arnaud-zg)

**`presets.avatars`**

> ### Patch Changes
>
> - [#51](https://github.com/arnaud-zg/packages/pull/51) A unit file can list
>   `checkEnvBeforeDeploy`…
>
> ### Contributors
>
> <a href="https://github.com/arnaud-zg"><img src="https://github.com/arnaud-zg.png?size=64" width="32" height="32" alt="@arnaud-zg"></a>

**`presets.none`** removes the thanks, and leaving `thanks` out keeps changesets' own line-by-line
thanks.

### Write your own

A template is one string. `{changes}` is the release's changes; `{contributors}`, `{list}` and
`{avatars}` are the people, as above.

| You write                                  | You get                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `"💜 Made by {contributors}\n\n{changes}"` | the thanks first, then the changes                                       |
| `"Thanks {contributors}!"`                 | the changes, then `Thanks @arnaud-zg!` (no `{changes}` means under them) |
| `${presets.sentence}\n\n🚀 Ship it!`       | the sentence preset, then your line                                      |

It rewrites the changelog section the release just wrote, so the release PR shows the result before
it ships, and the tag's release notes match. `commitsVersioning()` takes the same option. Every
option is listed in [`@shiplane/changesets`](../../packages/shiplane-changesets/README.md#-options).

## Ship a host with no plugin

```ts
modules: [backendService({ name: "custom", serverHosting: shellServerHosting() })],
```

```yaml
module: custom
deploy:
  preview: [npx, my-host, deploy, --env, preview]
  production: [npx, my-host, deploy, --env, production]
```

## Swap a provider

One argument changes; the apps keep their module and take the new provider's keys:

```ts
modules: [webApp({ staticHosting: netlifyStaticHosting() })],
```

## Write a plugin

```sh
pnpm shiplane adapter new render
```

It writes `release/adapters/render.ts`, its contract test, and its module in the config. To share
it, publish it as a package and name its adapters in its `package.json`, so `setup` offers them:

```json
"shiplane": { "adapters": ["renderServerHosting"] }
```

The API is in [Plugins](./plugins.md#write-a-plugin); `@shiplane/fly` is a small example.

## Comment on what shipped

```ts
features: [releaseComments({ codeHost, sourceControl })],
```

Each PR in a shipped version, and each issue it relates to, gets one comment with the version and
the environment.

## Set up the sign-ins

| Plugin                    | On this machine                  | In CI                                           |
| ------------------------- | -------------------------------- | ----------------------------------------------- |
| shiplane-github           | `gh auth login`                  | `GH_TOKEN`                                      |
| shiplane-npm              | `npm login`                      | none: it publishes from this machine            |
| shiplane-fly              | `flyctl auth login`              | `FLY_API_TOKEN`                                 |
| shiplane-cloudflare-pages | `npx wrangler login`             | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| shiplane-eas              | `pnpm exec eas login` in the app | `EXPO_TOKEN`                                    |

`pnpm shiplane doctor` checks each one and offers its fix; `pnpm shiplane` checks them before it
writes anything.

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
[reference](./reference.md#mascot).

## Turn the mascot off

For one run: `pnpm shiplane --no-mascot`. For good: `display: { mascot: false }` in
`shiplane.config.ts`. `--mascot` brings it back for one run, your own if the config has one.

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
