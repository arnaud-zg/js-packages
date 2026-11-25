---
"shiplane": minor
"@shiplane/github": minor
"@shiplane/npm": patch
---

Say how a repository releases: `deployApps: { promote: { from: "preview", to: "production" } }` for
apps, and `publishPackages: { channels: ["nightly", "live"] }` for packages. Both are optional and
unset changes nothing. `shiplane setup` writes a `ship.yml` listing them, with the permissions npm
needs, and `shiplane doctor` keeps it in step.

`ship.yml` is the only workflow: it uses the `.github/actions/ship` action. The reusable workflow
`shiplane-ship.yml` is gone: run `shiplane doctor` and let it replace a `ship.yml` that calls it.
