---
"shiplane": minor
"@shiplane/github": minor
"@shiplane/npm": patch
"@shiplane/cloudflare-pages": minor
"@shiplane/github-pages": minor
"@shiplane/git": patch
---

Say how a repository releases: `deployApps: { promote: [{ from: "preview", to: "production" }] }`
for apps, and
`publishPackages: { channels: ["nightly", "alpha", "beta", "rc", "latest"], onBranch: "snapshot" }`
for packages. Both are optional and unset changes nothing. Environment names are yours, and there
may be more than two: each promote step names `from` and `to`. `shiplane setup` writes a `ship.yml`
listing them, with the permissions npm needs, and `shiplane doctor` keeps it in step.

`ship.yml` is the only workflow: it uses the `.github/actions/ship` action.
