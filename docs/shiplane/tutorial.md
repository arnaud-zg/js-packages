[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · **🚀 Tutorial** · [🛠️ How-to](./how-to.md) ·
[📖 Reference](./reference.md) · [🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🚀 Release your first package

You will set shiplane up in a pnpm workspace of npm packages, then release one of them. Every output
below is copied from a run on a copy of [arnaud-zg/packages](https://github.com/arnaud-zg/packages).

```mermaid
flowchart LR
    A["Install"] --> B["setup"]
    B --> C["changeset"]
    C --> D["status"]
    D --> E["shiplane"]
```

**Before you start:** a pnpm workspace with changesets, on GitHub, with `gh` and `npm` signed in. No
changesets yet? `shiplane setup` asks how you want to release and configures them, then says to run
`pnpm install`.

## 1. Install the CLI and its plugins

```sh
pnpm add -D shiplane @shiplane/git @shiplane/github \
  @shiplane/changesets @shiplane/npm
```

## 2. Let it find what ships

```sh
pnpm shiplane setup --yes
```

```text
  Flow
  ✓ git             .git
  ✓ GitHub          remote github.com/arnaud-zg/packages
  ✓ GitHub Actions  .github/workflows/ci.yml
  ✓ Changesets      .changeset/config.json

  Apps
  ✓ packages/agent-context-budget  Published package → npm   proof: package.json, public, bin
  ✓ packages/vite-workspace-resolver  Published package → npm   proof: package.json, public, exports

  Rehearsal  · nothing is pushed, published or deployed
  ✓ build 2 apps
  ✓ git
  ✓ gh
  ✓ npm
  + shiplane.config.ts
  + packages/agent-context-budget/shiplane.unit.yml
  + packages/vite-workspace-resolver/shiplane.unit.yml

  ✓ Ready. Add a changeset, merge, and run shiplane
```

It rehearsed a release, then wrote `shiplane.config.ts` and a `shiplane.unit.yml` next to each
package. Without `--yes`, it asks only what it can't tell.

## 3. Queue a change

```sh
pnpm changeset
```

Pick `vite-workspace-resolver`, `patch`, and write one line its users understand.

## 4. See where things stand

```sh
pnpm shiplane status
```

```text
  Unit                     Version     Target            Where it stands
  agent-context-budget     0.1.0       npm               · 0.1.0 is on staging, nothing new
  vite-workspace-resolver  0.1.0       npm               ↑ 1 changeset

→ Next: open the release PR: shiplane
```

## 5. Release

```sh
pnpm shiplane
```

```text
  Unit                     Version             Ships live
  agent-context-budget     0.1.0               – nothing changed
  vite-workspace-resolver  0.1.0 → 0.1.1       ↑ ship  npm

  Steps
  1. Open the release PR, then wait for you to squash merge it
  2. Tag each version and publish its release notes
```

Say yes, then squash merge the release PR on GitHub. shiplane tags `vite-workspace-resolver@0.1.1`,
publishes its notes, and publishes it to npm under `latest`.

🎉 Released. Next: [add an app that deploys](./how-to-apps.md#add-an-app), or
[promote to prod](./how-to-release.md#promote-to-prod).
