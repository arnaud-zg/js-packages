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

Environment names are the repository's: shiplane assumes none. `shiplane setup` asks for them, or
takes `--environments a,b`, EAS takes them as its profiles and channels, and Cloudflare Pages has
`secretsIn` for the environment holding its secrets. The `ship.yml` setup writes runs on
`ubuntu-26.04`.
