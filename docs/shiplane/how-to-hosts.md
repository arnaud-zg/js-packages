[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) · **🛠️ Hosts how-to** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: hosts and versions

Where a release goes, how its version is decided and what its notes say. Everyday release tasks
(promote, retry, preview) are in [How-to](./how-to.md).

[Publish a package to npm](#publish-a-package-to-npm) ·
[Release Claude Code plugins](#release-claude-code-plugins) ·
[Choose how versions are bumped](#choose-how-versions-are-bumped) ·
[Release from commits](#release-from-commits) ·
[Thank contributors in release notes](#thank-contributors-in-release-notes) ·
[Ship a host with no plugin](#ship-a-host-with-no-plugin) · [Swap a provider](#swap-a-provider) ·
[Write a plugin](#write-a-plugin) · [Comment on what shipped](#comment-on-what-shipped) ·
[Set up the sign-ins](#set-up-the-sign-ins)

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

## Thank contributors in release notes

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
option is listed in
[`@shiplane/changesets`](../../packages/shiplane-changesets/README.md#-thank-contributors).

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
it, publish it as a package and name its adapters in its `package.json`, so `init` offers them:

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

| Plugin                    | On this machine                  | In CI                                |
| ------------------------- | -------------------------------- | ------------------------------------ |
| shiplane-github           | `gh auth login`                  | `GH_TOKEN`                           |
| shiplane-npm              | `npm login`                      | none: it publishes from this machine |
| shiplane-fly              | `flyctl auth login`              | `FLY_API_TOKEN`                      |
| shiplane-cloudflare-pages | `npx wrangler login`             | `CLOUDFLARE_API_TOKEN`               |
| shiplane-eas              | `pnpm exec eas login` in the app | `EXPO_TOKEN`                         |

`pnpm shiplane doctor` checks each one and offers its fix; `pnpm shiplane` checks them before it
writes anything.

## Example

[`examples/render-server-hosting.ts`](../../packages/shiplane/examples/render-server-hosting.ts)
defines a server hosting plugin with settings, requirements and jobs;
`packages/shiplane-integration/src/__tests__/writeAPlugin.test.ts` runs it against the contract.
