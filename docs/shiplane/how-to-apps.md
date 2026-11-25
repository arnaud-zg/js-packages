[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ Apps** · [📖 Reference](./reference.md) · [🔌 Plugins](./plugins.md)
· [💡 Explanation](./explanation.md)

# 🛠️ How-to: apps

Add, remove, configure and hold back the apps a release ships. Every option named here is in the
[Reference](./reference.md).

- [Add an app](#add-an-app)
- [Stop shipping an app](#stop-shipping-an-app)
- [Set a value per environment](#set-a-value-per-environment)
- [Read another app's value](#read-another-apps-value)
- [Check env before deploy](#check-env-before-deploy)
- [Hold an app back](#hold-an-app-back)

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

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
