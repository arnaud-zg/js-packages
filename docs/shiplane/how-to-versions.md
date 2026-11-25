[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ Packages and versions** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: packages and versions

Publish packages and plugins, choose how versions are bumped and what the release notes say. Every
option named here is in the [Reference](./reference.md).

- [Publish a package to npm](#publish-a-package-to-npm)
- [Release Claude Code plugins](#release-claude-code-plugins)
- [Choose how versions are bumped](#choose-how-versions-are-bumped)
- [Release from commits](#release-from-commits)
- [Shape release notes](#shape-release-notes)

## Publish a package to npm

```yaml
# packages/my-tool/shiplane.unit.yml
module: published-package
```

Needs `publishedPackage({ packageRegistry: npmPackageRegistry() })` in `modules`. A release
publishes under `latest`; to stage under `next` first, add
`tag: { preview: next, production: latest }`. A new package needs no changeset for its first
version: merge it, then run `pnpm shiplane`.

Recommended: `npmPackageRegistry({ staged: true })` holds each release on npm until a person
approves it with 2FA. See
[Staged publishing](../../packages/shiplane-npm/README.md#%EF%B8%8F-staged-publishing-recommended).

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

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
