[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ Test versions** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: test versions

Publish a version testers install before it is released. Every option named here is in the
[Reference](./reference.md).

- [Publish a test version](#publish-a-test-version)

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

Each run asks **your CI pipeline or this machine**, unless `--via` or the config's `via` says. CI
needs a `ship.yml` that offers the channel, and the branch pushed; otherwise it says why and
publishes from here. `--yes`, or no terminal, publishes from this machine. After the channel, name
packages to publish only those: `pnpm shiplane test-release beta my-lib`.

Each version builds on the version the changesets give the package next, so it always sorts above
the last release. Two kinds of channel:

| Channel                                    | Version              | npm tag  | Lifetime              |
| ------------------------------------------ | -------------------- | -------- | --------------------- |
| `snapshot` (default)                       | `0.6.0-main.329aafb` | none     | one per commit        |
| `nightly`, `alpha`, `beta`, `rc`, any word | `0.6.0-beta.<n>`     | the word | `<n>` +1 each publish |

`<n>` is the next number npm never took for that version and channel, from 0: an unpublished version
keeps its number, as npm refuses it twice. The packages of a changesets `fixed` group share one
`<n>`, the highest any of them needs. Nothing is written to git: no tag, no commit; versions are
written to `package.json` for the publish and put back after, even when it fails. `latest` stays the
real release's channel: no test release can use it. See
[every channel and its npm tag](./reference.md#channels-and-npm-tags). A snapshot keeps no npm tag:
npm needs one to publish, so it goes out under `snapshot` and loses it right after, and no branch
leaves a tag behind. Testers install it by its exact version, which the install lines give.

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

### Deploy a branch

```ts
deployApps: { onBranch: "staging" },
```

A snapshot test release on a branch then also deploys its pending apps to `staging`, from this
machine and asked first. It replaces what runs there until the next release. It is not recorded as a
deploy: nothing is promoted from it. Mobile apps on EAS are left out, as are runs on CI, and it is
never where users are.

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

| `testComment`         | The comment                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `comments.table`      | The install table above                                                                      |
| `comments.compact`    | `` 📦 Test version of `feat/x` (`a1b2c3d`, linked): `npm i shiplane@0.6.0-feat-x.a1b2c3d` `` |
| `"Try it: {install}"` | `` Try it: `npm i shiplane@0.6.0-feat-x.a1b2c3d` ``                                          |

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

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
