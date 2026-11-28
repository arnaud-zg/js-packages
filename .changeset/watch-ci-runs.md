---
"shiplane": patch
"@shiplane/github": patch
---

After a ship, a promote or a test release starts runs on the CI pipeline, shiplane can follow them
live until they end, on GitHub Actions with `gh run watch` on the very run it started. It asks, the
first run preselected, unless `--watch`/`--no-watch` or the config's new `watch` key says; `--yes`
accepts. A run it followed that fails fails the ship, with its page linked. A run not followed gets
the command to follow it.
