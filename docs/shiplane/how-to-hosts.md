[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ Hosts and plugins** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: hosts and plugins

Ship to a host, swap one, write a plugin, set up the sign-ins. Every option named here is in the
[Reference](./reference.md).

- [Ship a host with no plugin](#ship-a-host-with-no-plugin)
- [Swap a provider](#swap-a-provider)
- [Write a plugin](#write-a-plugin)
- [Comment on what shipped](#comment-on-what-shipped)
- [Set up the sign-ins](#set-up-the-sign-ins)

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

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
