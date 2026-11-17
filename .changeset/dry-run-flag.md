---
"shiplane": minor
"@shiplane/cloudflare-pages": patch
"@shiplane/eas": patch
"@shiplane/fly": patch
"@shiplane/github": patch
"@shiplane/npm": patch
---

`--dry-run` previews a ship: `shiplane ship --dry-run` prints every command a ship to preview would
run, `shiplane promote --dry-run` the same for production, and nothing runs. `shiplane plan` is
deprecated and still runs, with a line pointing to the flag.
