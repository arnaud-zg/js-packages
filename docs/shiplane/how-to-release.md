[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ Release** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: release

Pick a version, see it first, promote it, and retry when a ship fails. Every option named here is in
the [Reference](./reference.md).

- [Pick from a long list](#pick-from-a-long-list)
- [Fix a build that stops the release](#fix-a-build-that-stops-the-release)
- [Force another version](#force-another-version)
- [See every command first](#see-every-command-first)
- [Promote to prod](#promote-to-prod)
- [Widen a prod rollout](#widen-a-prod-rollout)
- [Retry a failed release](#retry-a-failed-release)

## Pick from a long list

With more than 15 units, `pnpm shiplane` and `pnpm shiplane promote` ask by parent folder:

```text
◆  What do you want to release to staging? Greyed units have nothing to release.
│  42 of 44 selected · 2 with changesets, 40 first release
│  ❯ ▾ ◼ apps/  2/2 selected · 2 with changesets, 2 with nothing to release
│        ◼ shop (1 changeset)
│        ◼ admin (2 changesets)
│        ◻ blog (0.3.0 is on staging, nothing new)
│        ◻ docs (nothing new)
│    ▸ ◼ packages/  40/40 selected · 40 first release
│  ↑/↓ move • →/← open or close a folder • space select • a all or none
│  enter confirm • esc cancel
└
```

- **A folder opens when it holds more than first releases.** One with only first releases or nothing
  to release starts closed. Its row still counts what is selected, and why.
- **Space on a folder** selects all of it, or none when all of it was. `◧` is a folder partly
  selected. Greyed units stay out.
- **Units with something new come first** in their folder, then first releases, then greyed ones.
- **First releases start ticked**, as in a short list. To leave 40 of them out, press space on their
  folder.

`--yes` and a run without a terminal ask nothing and take everything pending.

## Fix a build that stops the release

Every picked unit builds before a release writes anything. When one fails, shiplane shows the end of
its output and stops:

```text
✗ build shop failed: pnpm run build in apps/shop exited with 1, the steps after it did not run.
    │ src/cart.ts(12,3): error TS2322
    Nothing was written: no release PR, tag or publish. Fix the build, then run:
    shiplane
```

Fix it and run `pnpm shiplane` again, or untick that unit. When a unit has a `build` script that a
release should not run, give it another command with `buildCommand:` in its `shiplane.unit.yml`.
What runs is in the [reference](./reference.md#build-before-a-release).

## Force another version

When everything a release moves lands on one version, `pnpm shiplane` asks for it, with the computed
version selected:

```text
◆  Release these to staging as (Esc cancels)
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

## See every command first

```sh
pnpm shiplane ship --dry-run        # staging
pnpm shiplane promote --dry-run     # prod
```

Nothing runs. It prints the release order, then each command, both ways.

## Promote to prod

```sh
pnpm shiplane promote
```

Type `prod` when asked. Web apps redeploy the tag staging runs; the mobile app may first open a PR
moving its prod version, then build after you merge it.

## Widen a prod rollout

Run `pnpm shiplane promote` again and pick the mobile app. It shows the rollout, its launches and
crashes, and suggests the next step: 25%, 50%, everyone, stay, or roll back.

## Retry a failed release

```sh
pnpm shiplane
```

Run the same command again. It reads what is already done and skips it: an open release PR is picked
up, a pushed tag is not made twice, notes already published are kept. Only the step that failed runs
again.

A unit whose ship failed comes back ticked in the first question, as `released, not on staging yet`
(`not live yet` for a package, `never reached staging: retry` for a mobile app). Press Enter and it
goes straight to the ship.

To redeploy one unit without the questions:

```sh
pnpm shiplane ship my-api                      # add --channel prod for prod
```

If the unit is greyed out as `deploying already`, a GitHub deployment is still marked in progress.
Find its run with `gh run list --limit 5` and rerun it from GitHub.

### A mobile build failed and main moved on

```sh
pnpm shiplane ship expo
```

When a version never reached staging and main has moved since its tag, it offers that version again,
exactly as released:

```
  expo 0.6.0 didn't reach staging: the iOS build failed 2h ago.
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
released that already went out counts as done: it is on staging, nothing is offered. Tags, release
notes and PR comments already made are not made twice.

With no terminal, or on CI, it refuses and says the retry is there in a terminal. Staging only, and
never when main is behind the last staging build.

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
