[🏠 Home](../../README.md) · [📚 Docs](../README.md) · Contributing: [🛠️ How-to](./how-to.md) ·
[📖 Reference](./reference.md) · **💡 Explanation**

# 💡 Explanation: Contributing

## Why independent packages share one repo

Every package here is a small, focused tool with no shared runtime between them: installing one
never pulls in another, and each publishes and versions independently. A monorepo buys one set of
dev tooling (lint, format, release process, CI) instead of duplicating it per package; nothing about
any package's own code depends on the others existing.

## Why this repo is an incubator

A new idea should not need a new repo. Here it gets a toolchain and a release process from day one,
so it can be tried, published and dropped cheaply. Some packages stay small for good, and that is
fine: this repo is a good home for them.

A package that grows needs what a shared repo cannot give it: its own issue tracker, roadmap,
release notes, stars and maintainers. From there this repo is too small for it, and moving it out is
the successful end of the incubation.

A package must be stable before it moves out: stability is a gate. The
[maturity indicators](./reference.md#maturity-indicators) then say when to have that conversation.
They are a hint: numbers start the discussion, the maintainer decides. They only count what people
outside do, and downloads alone are not enough: npm counts bots, mirrors and CI installs too.

## Versioning policy

Each package versions independently through [Changesets](https://github.com/changesets/changesets),
not in lockstep: a fix to one package never forces a version bump on another. Each starts at
`0.1.0`: usable, not yet stable, expect breaking changes signaled by a `0.x` minor bump until
`1.0.0`, see [When a package is stable](#when-a-package-is-stable).

A new feature is a minor bump too, even when it breaks nothing: below `1.0.0` a minor means "new" or
"breaking", and the changelog says which; a patch only ever means "fixed". Changesets never picks
the bump, so the one who writes the changeset applies this rule.

## When a package is stable

`1.0.0` says the API can be relied on, not that the package is popular: a small package can be
stable and stay here. So the [stability indicators](./reference.md#stability-indicators) count
confidence, and the maturity indicators count traction. An abandoned API is quiet too, which is why
the quiet months must include releases.

Moving out already changes the repo, the issues and the links. A stable API means users do not face
breaking changes at the same time.

## Why every package is written to be found

Nobody promotes these packages: people find them through npm search, web search or an AI assistant.

- **npm search** ranks on the name, `description` and `keywords`, then the README.
- **Web search** matches what people type, often the exact error, so the README quotes it.
- **AI assistants** recommend what they can describe and quote: a plain description and a first
  example that works when pasted.
- **npm shows the published `package.json`**, so a metadata change needs a release to show.
