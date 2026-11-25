[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) ·
[🛠️ How-to](./how-to.md) · [📖 Reference](./reference.md) · [🔌 Plugins](./plugins.md) · **💡
Explanation**

# 💡 Explanation

## A ship triggers each deploy and returns

A deploy finishes on its own platform, in minutes nobody can act on. So shiplane starts it and
returns; `shiplane status` reads the outcome later, from any machine. It waits only for what is a
decision (your merge) or what it must confirm before recording it (a Fly rollout).

```mermaid
sequenceDiagram
    participant You
    participant shiplane
    participant Host as Fly, EAS, Pages, npm
    You->>shiplane: shiplane
    shiplane->>Host: start each deploy
    shiplane-->>You: Triggered
    Host-->>Host: builds, rolls out
    You->>shiplane: shiplane status
    shiplane->>Host: what runs where?
```

## The core holds the release, plugins hold the hosts

The core knows what changed, versions, tags, order and safety. Each host is a plugin filling a port,
so a repository installs only what it ships with, and a new host is a new package, not a new CLI.
One plugin per provider, not per port: GitHub's code host, Actions and comments share one sign-in.
The shell adapter stays built in, the fallback for any host.

## The order of `modules` is the release order

Versions, tags, deploys and comments follow it, so `--dry-run` shows a reorder before anything
ships. An app reading another's url comes after it, and loading says so when it does not.

## Changesets decide what ships

A diff says something changed; a changeset says whether it is a fix or a feature, and what to tell
users. So it drives the version and the changelog, and a change with none stays unreleased.

Core only knows the versioning port, so where changesets come from is the adapter's choice:
`commitsVersioning()` writes them from Conventional Commits and hands them to changesets, with
nothing in core reading a commit to release it.

A changeset is written before anyone sees the whole release, so whoever releases has the last word:
the computed version is selected, and picking another takes a typed line. It is typed, not picked
from a list, because a list only repeats what the number says, major means breaking, while users
need to know what broke. Going up adds a changeset, so the changes keep the sections they were
written for. Going down caps every line, since a single minor left in a fixed group would hold the
whole group up.

## A package or a plugin has no environment

Preview is for checking, production is for users. A package with one dist-tag has nothing to check
on preview: it goes straight to production, with the release when nothing in the repository has a
preview, else with the next promote. A plugin ships when its release PR merges: a run says `live`
for it.

## What runs where is read from the platform

GitHub Deployments records each deploy under its tag, so every machine knows what preview and
production run without a local file. npm and EAS know their own state, so their plugins read it
there instead.

## A mobile app takes an update unless its native layer changed

An over-the-air update only reaches binaries built from the same native layer and version.

```mermaid
flowchart TD
    A["Compare this commit with the newest store build"] --> B{"Native fingerprint or version changed?"}
    B -->|"yes"| C["Store build"]
    B -->|"no"| D{"Built from this commit already?"}
    D -->|"yes"| E["Nothing to ship"]
    D -->|"no"| F["Over-the-air update"]
```

One update reaches both platforms, so the stricter verdict wins. A new binary needs a new version,
which is why production first opens a PR moving its version to the one preview validated.

## CI and your laptop run the same jobs

Through GitHub Actions, shiplane dispatches one workflow, `ship.yml`, which runs `shiplane ship` on
the runner. Same jobs, same unit files: a url changed once reaches both paths.

Each run goes on a release tag, never on `main`, even when the tag is main's last commit. A runner
checks out its ref when the job starts, not when it is dispatched: a run queued behind another one
on `main` would ship whatever was merged in between. Units tagged on the same commit still share one
run, on the first one's tag, and the Actions run and its GitHub deployment show that tag. Only a job
that ships `main` on purpose, like an Expo production update, runs on `main`.

That workflow is yours, but its steps are not: `shiplane setup` writes a `ship.yml` that only calls
`shiplane-ship.yml`, a reusable workflow published from shiplane's repository. Every repository then
runs the same steps, and a fix to them reaches all of them with an upgrade. The call is pinned to
the commit of a shiplane release, not to a tag or a branch: a commit cannot move, so nothing changes
what runs on your secrets until you re-pin, and `shiplane doctor` offers that after each upgrade.

Your ship workflow needs no change for this: a `workflow_dispatch` workflow that checks out
`github.ref` already accepts a tag.

## Production makes you type its name

It reaches every user, so it cannot start by reflex or by `--yes`.

## Fakes keep the tests honest

Every port has a Fake and a contract suite. The suite runs on the Fake and on each real adapter, so
a test passing on Fakes says something true about the real hosts.

## One engine, in TypeScript

A run waits on git, the code host, the registry and the deploys; shiplane's own work is about a
tenth of a second of it. So the engine stays in one language and speed work goes to fewer tool
calls. Why, with the timing: [ADR-001](./decisions/ADR-001-one-typescript-engine.md). Every
decision: [🧭 Decisions](./decisions/README.md).

## YAML and TS hold the same release

`shiplane.yml` names each adapter, module and feature from the plugins' catalogs;
`shiplane.config.ts` imports them. Both become the same declaration, checked the same way, so a team
picks the form it can write. Why: [ADR-002](./decisions/ADR-002-yaml-beside-ts.md).
