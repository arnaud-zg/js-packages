---
"shiplane": minor
"@shiplane/cloudflare-pages": minor
"@shiplane/eas": minor
"@shiplane/fly": minor
"@shiplane/git": patch
"@shiplane/github": minor
"@shiplane/github-pages": minor
"@shiplane/npm": minor
---

Environment names are the repository's: shiplane assumes none.

**Upgrading:** a repository that deploys apps adds one line to its config, with the names its unit
files already use: `deployApps: { promote: [{ from: "staging", to: "prod" }] }`. A package whose
`tag` is a map per environment needs it too. Every per-environment map then holds each of those
names and no other. A repository of packages only adds nothing.

`shiplane setup` asks for the names, or takes `--environments a,b`. EAS takes them as its profiles
and channels: one step, or a lone `from`.

Cloudflare Pages: to check env before a deploy, `secretsIn` in the unit file says which Cloudflare
environment holds the secrets.

The `ship.yml` setup writes runs on `ubuntu-26.04`, not on whatever `ubuntu-latest` becomes.
