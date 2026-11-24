# Contributing

This repo is an incubator for small npm packages: experiments, fixes and ideas are all welcome. A
package that outgrows it moves to its own repo, see the
[maturity indicators](./docs/contributing/reference.md#maturity-indicators).

## Report an issue

[Open an issue](https://github.com/arnaud-zg/packages/issues/new/choose) and pick the package. One
sentence is enough to start; a reproduction helps but is optional.

## Create a pull request

You need Node 22 or later, pnpm 10.10 or later, and the [GitHub CLI](https://cli.github.com) (or
fork and open the pull request on github.com). For a new package or a large change, open an issue
first.

**1. Fork, clone and install**

```sh
gh repo fork arnaud-zg/js-packages --clone
cd js-packages
pnpm install
```

**2. Create a branch and make your change**

```sh
git checkout -b fix/short-description
pnpm --filter <pkg> test   # tests for one package
```

Add a test for a fix or a feature, and update `docs/<pkg>/` when users will see the change.

**3. Add a changeset for any change to a package's `src`**

```sh
pnpm changeset --patch <pkg> -m "What now works."       # fix, perf, refactor…
pnpm changeset --minor <pkg> -m "What users can now do." # feat, or a breaking change below 1.0.0
```

Docs-only and tooling changes outside a package need none.

**4. Check, commit and push**

```sh
pnpm verify   # typecheck, lint, format, test, build
git add .
git commit -m "fix(<pkg>): short description"
git push -u origin HEAD
```

**5. Open the pull request**

```sh
gh pr create
```

- Keep one change per pull request, with a
  [conventional commit](https://www.conventionalcommits.org) title such as `fix(shiplane): ...`: it
  becomes the commit on `main`.
- Say what changes and why, and link the issue (`Closes #123`).
- Run `pnpm verify` before asking for a review: no CI runs it on pull requests.

The maintainer reviews it, squash-merges it, and
[releases it](./docs/contributing/how-to.md#release-a-new-version) later.

## Triage (maintainer)

The form a reporter picks sets `pkg: <name>`. Triage is adding one priority:

| Label              | Means                                       |
| ------------------ | ------------------------------------------- |
| `priority: high`   | Do next: unblocks users or several packages |
| `priority: medium` | Worth doing, no rush                        |
| `priority: low`    | Low value: a pull request is welcome        |

- [Inbox](https://github.com/arnaud-zg/packages/issues?q=is%3Aopen+is%3Aissue+-label%3A%22priority%3A+high%22+-label%3A%22priority%3A+medium%22+-label%3A%22priority%3A+low%22):
  open issues with no priority yet
- [Next up](https://github.com/arnaud-zg/packages/issues?q=is%3Aopen+label%3A%22priority%3A+high%22)
- Per package: filter by `label:"pkg: shiplane"`

After adding, renaming or removing a package, run `pnpm sync-issues` to regenerate the forms, then
`pnpm sync-issues --labels --apply` to sync the labels. It runs locally; no GitHub Action is
involved.
