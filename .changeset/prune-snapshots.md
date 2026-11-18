---
"shiplane": minor
"@shiplane/npm": minor
---

`shiplane prune-snapshots` removes the npm tags old snapshots left behind: those on a snapshot
version published 30 days ago or more (`--older-than <days>`, 7 or more). It only touches tags a
shiplane snapshot gives, never `latest`, a numbered channel or a tag of your own, and the versions
stay installable by their number. `--dry-run` lists them, `--otp <code>` passes a two-factor code to
every removal (a terminal asks for a fresh one when it expires), and without a terminal it needs
`--yes`. A registry adapter offers it with the optional `tags` and `untagJob`. The docs now say
snapshots are temporary: never depend on one.
