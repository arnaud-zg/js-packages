[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ Release** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: release

Pick a version, preview it, promote it, and retry when a ship fails. Every option named here is in
the [Reference](./reference.md).

- [Force another version](#force-another-version)
- [Preview every command](#preview-every-command)
- [Promote to production](#promote-to-production)
- [Widen a production rollout](#widen-a-production-rollout)
- [Retry a failed release](#retry-a-failed-release)

## Force another version

When everything a release moves lands on one version, `pnpm shiplane` asks for it, with the computed
version selected:

```text
◆  Release these to preview as (Esc cancels)
│  ○ 1.0.0  major
│  ● 0.5.0  minor, computed
│  ○ 0.4.1  patch
```

Enter releases the computed version. Pick another and it asks why, in one line:

```text
◆  Why 1.0.0? Tell users what changed, in one line.
│  Drops subjectsSince from SourceControlPort
```

Esc or an empty line goes back to the versions. The line reaches the changelog, the release PR and
the release notes, as
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

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
