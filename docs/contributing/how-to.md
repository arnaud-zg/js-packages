[🏠 Home](../../README.md) · [📚 Docs](../README.md) · Contributing: **🛠️ How-to** ·
[📖 Reference](./reference.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to guides: Contributing

## Run this repo's own tests

```sh
pnpm install
pnpm verify
```

Or scope to one package:

```sh
pnpm --filter agent-context-budget test
```

## Release a new version

Uses [shiplane](../../packages/shiplane/README.md), with
[Changesets](https://github.com/changesets/changesets) for the versions. Nobody pushes to `main`
directly, including for version bumps: everything lands through a merged PR.

**1. Add a changeset, in your feature/fix PR**

This repo writes its changelog itself (`changesetsVersioning()`), so you pick the bump from the PR
title:

```sh
pnpm changeset --minor shiplane -m "What users can now do."   # feat
pnpm changeset --patch @shiplane/fly -m "What now works."     # fix, perf, …
```

A breaking change (`!`) is `--minor` below `1.0.0`. Before merging,
`pnpm changeset status --verbose` lists the version each package gets. See
[Choose how versions are bumped](../shiplane/how-to-versions.md#choose-how-versions-are-bumped).

Each merged PR carries its own changeset; they pile up on `main` until step 2 cuts a release. Commit
the generated `.changeset/*.md` file and merge the PR as usual.

**2. Open the release PR, once changesets have piled up on `main`**

```sh
git checkout main && git pull
pnpm release
```

`pnpm release` builds, then runs shiplane. With changesets pending, it opens the release PR:
versions bumped and `CHANGELOG.md` written by `changeset version`. Review the diff and merge it like
any other PR. `pnpm shiplane status` shows what is pending at any time.

**3. Publish, after that PR is merged**

```sh
git checkout main && git pull
npm login           # if you don't already have a session
pnpm release
```

The same command now tags each bumped package, publishes it to npm and writes its GitHub Release
from the `CHANGELOG.md` entry. It needs `gh` and `npm` signed in.

Packages are
[staged](../../packages/shiplane-npm/README.md#%EF%B8%8F-staged-publishing-recommended): approve
each one with 2FA on npmjs.com (Staged Packages) to make it public.

One-time setup: **Settings → Branches** → require a PR before merging into `main`, so steps 1 and 2
are the only way in. (Needs the repo to be public, or GitHub Pro, for a private repo.)

Packages version independently, not in lockstep: a fix to one package doesn't force a version bump
on another. Each starts at `0.1.0`: usable, not yet stable, expect breaking changes signaled by a
`0.x` minor bump until `1.0.0`. See
[Explanation § Versioning policy](./explanation.md#versioning-policy) for why.

## Publish from GitHub Actions

`pnpm shiplane test-release` and `pnpm release` ask: GitHub Actions or this machine. Or start the
[Ship workflow](../../.github/workflows/ship.yml) yourself, with **dry-run** to only look:

```sh
gh workflow run ship.yml --ref main -f environment=nightly -f dry-run=true
```

The environment is also the GitHub Environment, so each run shows under **Deployments**:

| Environment                      | Branch | npm gets                                                            |
| -------------------------------- | ------ | ------------------------------------------------------------------- |
| `snapshot`                       | any    | `0.6.0-<branch>.<sha>`, no tag kept                                 |
| `nightly`, `alpha`, `beta`, `rc` | `main` | `0.6.0-<channel>.<n>` under that tag                                |
| `production`                     | `main` | the merged release PR's versions, staged: approve each on npmjs.com |

A test release publishes what the pending changesets release: with none, nothing. `production`
refuses when `main` moved past the release.

**One-time setup, per package**, on npmjs.com (Settings › Trusted publishing): GitHub Actions,
repository `arnaud-zg/js-packages`, workflow `ship.yml`, environment empty. Allow `npm publish`
(test releases) and `npm dist-tag` (dropping a snapshot's tag). A package must already be on npm.

## Make a package stable

When its [maturity score](./reference.md#package-lifecycle) reaches 5:

1. Open an issue with the numbers, and decide there.
2. Add the changeset and release it:

```sh
pnpm changeset --major <pkg> -m "Stable: breaking changes are now major versions."
```

## Move a mature package to its own repo

When a package is on `1.0.0` or later and its [maturity score](./reference.md#package-lifecycle)
reaches 7:

1. Open an issue with the numbers, and decide there.
2. Create the new repo, keeping the package's git history and npm name.
3. Update `homepage` and `repository` in its `package.json`, publish from the new repo, and transfer
   its open issues.
4. Here, remove the package, leave a link to the new home in the root README and
   `packages/<dir>/README.md`, and run `pnpm sync-issues`.

## Keep a package findable

When you add a package or change what one does, check it against the
[Findability rules](./reference.md#findability-rules), then:

```sh
pnpm changeset --patch <pkg> -m "Clearer npm description and keywords."
# after the release, check what npm shows:
npm view <pkg> description keywords
```

For a new ecosystem, add a repo topic: `gh repo edit arnaud-zg/packages --add-topic <topic>`.
