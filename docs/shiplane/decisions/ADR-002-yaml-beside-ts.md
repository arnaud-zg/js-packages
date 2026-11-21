# ADR-002: YAML beside TS

[🏠 Home](../../../README.md) · [📚 Docs](../../README.md) · [🧭 Decisions](./README.md) ·
**ADR-002**

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

A shiplane config is `shiplane.config.ts`: a repository needs Node, TypeScript and a `package.json`
to write one, and an editor knows its keys only through TypeScript. Teams releasing Rust, Python or
Go code have none of these. Every config in use today is TypeScript, and some hold functions (a
mascot drawn by code, a custom adapter object).

## Decision

`shiplane.yml` is read beside `shiplane.config.ts`, never instead of it:

- Both become the same declaration, which `loadRelease` checks the same way. A `ConfigReader` port
  has one adapter per file kind.
- YAML names what TS imports. Each plugin exports a `catalog`: every adapter, module and feature it
  gives, the port each fills and its options as zod. `sourceControl: git` makes what
  `gitSourceControl()` makes.
- One shape per slot: a name, or `use` with `with`. A local file exporting a `catalog` is named by
  its path.
- A repository holds one config. Both at once is a problem that names them and says to keep one.
- The TS config stays: what YAML cannot hold, such as a function, keeps it.

## Consequences

- No change for a repository on TS. Its config loads as before.
- A plugin adds a `catalog` export for YAML users; one without it still works from TS.
- `shiplane plugins --json` prints the same for a config in either form; a test holds this for
  `examples/repository` and for this repository's own config.
- Problems in YAML carry their line and the fix, as
  `shiplane.yml:12  no staticHosting adapter named "netlify"  → name one of: …`.
- A JSON Schema from the catalogs (editor autocomplete) and `shiplane migrate` come next, on the
  same catalog.
