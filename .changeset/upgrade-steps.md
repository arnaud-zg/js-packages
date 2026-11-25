---
"shiplane": minor
---

**Upgrading:** a repository that deploys apps names its environments and replaces its `ship.yml`.

<details>
<summary>How to upgrade</summary>

1. Update `shiplane` and every `@shiplane/*` package to the same version.
2. If it deploys apps, or a package's `tag` is a map per environment, add to the config, with the
   names your unit files already use:
   `deployApps: { promote: [{ from: "preview", to: "production" }] }`. Every value per environment
   then holds each of those names and no other.
3. On EAS, `eas.json` has a profile and a channel of each name, and there is one step. On Cloudflare
   Pages with `checkEnvBeforeDeploy`, add `secretsIn`, the Cloudflare environment holding its
   secrets.
4. Run `shiplane doctor` and let it replace `ship.yml`, as `shiplane-ship.yml` is gone. Your own
   edits are lost: copy them over. An older pin runs until it is changed, so replace the file before
   Renovate moves it.
5. Run `shiplane ship --dry-run`, then release one low-risk app first.

A repository of packages only does 1, 4 and 5. An adapter of your own receives `flow`, the names in
order and the one users are on, `deployments` takes the environments to read, and `perEnv` has no
default keyed by a name.

</details>
