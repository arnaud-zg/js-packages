[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ Destinations** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: destinations

Say where your apps deploy and where your packages publish. Users only get what ran somewhere else
first, and nothing reaches them by accident.

- [Which setting do I need?](#which-setting-do-i-need)
- [Deploy apps through your environments](#deploy-apps-through-your-environments)
- [Try a branch on a real environment](#try-a-branch-on-a-real-environment)
- [Publish packages on channels](#publish-packages-on-channels)

## Which setting do I need?

| Your repository              | Write                                            |
| ---------------------------- | ------------------------------------------------ |
| Deploys apps                 | `deployApps`                                     |
| Publishes packages           | nothing, or `publishPackages` for fewer channels |
| Does both                    | `deployApps`                                     |
| Holds only internal packages | nothing                                          |

## Deploy apps through your environments

```ts
deployApps: { promote: [{ from: "preview", to: "production" }] },
```

The names are yours. A release deploys to `preview`; `pnpm shiplane promote` takes the same version
to `production`, once `preview` runs it.

| You want                 | Write                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| One more stop on the way | `[{ from: "dev", to: "preview" }, { from: "preview", to: "production" }]` |
| Straight to users        | `[{ to: "production" }]`                                                  |
| Nothing promoted         | `[{ from: "preview" }]`                                                   |

**What protects your users:** the last `to` is where they are. Shiplane asks to type its name,
refuses `--yes` there, and refuses an app version the environment before does not run. A run you
start from GitHub Actions is the confirmation, so limit who may start it with the GitHub
Environment's rules.

Use the same names in each `shiplane.unit.yml`, and in `eas.json` for a mobile app on EAS, which
takes one step:

```yaml
app:
  preview: acme-api-preview
  production: acme-api
```

## Try a branch on a real environment

```ts
deployApps: { promote: [{ from: "preview", to: "production" }], onBranch: "preview" },
```

```sh
pnpm shiplane test-release snapshot
```

On a branch, it deploys the apps with pending changes to `preview`, asked first, so someone can try
them before the merge. It replaces what runs there until the next release, and is never where users
are. [What it leaves out](./how-to-test-versions.md#deploy-a-branch).

## Publish packages on channels

```ts
publishPackages: { channels: ["nightly", "latest"], onBranch: "snapshot" },
```

A channel is the npm tag it publishes under, so `npm i <pkg>@nightly` installs the nightly and plain
`npm i <pkg>` only ever gets `latest`, the real release. `onBranch: false` turns snapshots off.
[Every channel, and what each does](./reference.md#channels-and-npm-tags).

List the channels you use: with no list, any word is a channel, a typo included.

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
deploys an API and a site through `preview` and `production`;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
