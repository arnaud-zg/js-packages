[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) › **🛠️ Upgrade** · [📖 Reference](./reference.md) ·
[🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to: upgrade to 0.6

Two changes to make, then you choose the names of your environments and release from one `ship.yml`.

- [What applies to you](#what-applies-to-you)
- [Upgrade](#upgrade)
- [If you wrote an adapter](#if-you-wrote-an-adapter)

## What applies to you

| Your repository                                          | To do            |
| -------------------------------------------------------- | ---------------- |
| Deploys apps                                             | Steps 1 to 4     |
| Publishes packages only                                  | Steps 1, 3 and 4 |
| Publishes a package whose `tag` is a map per environment | Steps 1 to 4     |

## Upgrade

**1. Update `shiplane` and every `@shiplane/*` package together**, to the same version.

**2. Name your environments** in the config, with the names your unit files already use:

```ts
deployApps: { promote: [{ from: "staging", to: "prod" }] },
```

```yaml
deployApps:
  promote:
    - from: staging
      to: prod
```

Then check each `shiplane.unit.yml`:

- A value per environment holds each of those names and no other.
- On EAS, `eas.json` has a profile and a channel of each name, and there is one step.
- On Cloudflare Pages with `checkEnvBeforeDeploy`, add `secretsIn`: the Cloudflare environment
  holding its secrets.

**3. Replace `ship.yml`.** `shiplane-ship.yml` is gone; a `ship.yml` pinned to an older commit still
runs until you change the pin.

```sh
pnpm shiplane doctor
```

It says `ship.yml does not ship with shiplane` and offers to replace it. **Your own edits are
lost:** copy them over after. If Renovate moves that pin first, the run fails until the file is
replaced.

To publish packages from GitHub Actions, also trust `ship.yml` on npmjs.com for each package and
create the GitHub Environments: [Ship from GitHub Actions](./how-to-ci.md#ship-from-github-actions).

**4. Check, then release something small.** Nothing runs in the first two:

```sh
pnpm shiplane doctor
pnpm shiplane ship --dry-run
```

Read the plan, then release one low-risk app to its first environment before the rest.

## What else you will notice

| Before                                   | Now                                                           |
| ---------------------------------------- | ------------------------------------------------------------- |
| A package published from this machine    | It asks: CI or this machine. `via` or `--via` answers for you |
| A build failed halfway through a release | Every picked unit builds first, before anything is written    |
| More than 15 units in one list           | Grouped by folder                                             |
| An unknown `--channel` crashed           | It says which names exist                                     |

## If you wrote an adapter

| Where                                       | Change                                                             |
| ------------------------------------------- | ------------------------------------------------------------------ |
| A delivery adapter's input, and `listNames` | Carry `flow`: the names in order, and the one users are on         |
| A code host's `deployments`                 | Takes the environments to read                                     |
| A CI pipeline's `callerWorkflow`            | Receives `environments` and `apps`                                 |
| Settings with `perEnv`                      | Keyed by the repository's names; give no default keyed by any name |

Compare names with `entryOf`, `previousOf` and `reachesUsers` from `shiplane/plugin`, never with a
word.
