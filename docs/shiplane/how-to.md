[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) · **🛠️ How-to** ·
[📖 Reference](./reference.md) · [🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to

One page per area, one task per section. New here? Start with the [Tutorial](./tutorial.md).

| Page                                             | Tasks                                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [📝 YAML config](./how-to-yaml.md)               | Write the config in YAML, set up or migrate to YAML, get autocomplete, give an adapter options, name an adapter of your own, use a preset |
| [🧩 Apps](./how-to-apps.md)                      | Add an app, stop shipping one, set a value per environment, read another app's value, check env before deploy, hold an app back           |
| [🚢 Release](./how-to-release.md)                | Force another version, staging every command, promote to prod, widen a rollout, retry a failed release                                    |
| [🧪 Test versions](./how-to-test-versions.md)    | Publish a test version, pick its channel, shape its pull request comment, clean up old snapshots                                          |
| [⚙️ CI](./how-to-ci.md)                          | Choose GitHub Actions or this machine, ship from GitHub Actions, set up any Node project, ship with no laptop, use it from a script       |
| [📦 Packages and versions](./how-to-versions.md) | Publish to npm, release Claude Code plugins, choose how versions are bumped, release from commits, shape release notes                    |
| [🔌 Hosts and plugins](./how-to-hosts.md)        | Ship a host with no plugin, swap a provider, write a plugin, comment on what shipped, set up the sign-ins                                 |
| [🖥️ Terminal](./how-to-terminal.md)              | Bring your own mascot, turn the mascot off                                                                                                |

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
