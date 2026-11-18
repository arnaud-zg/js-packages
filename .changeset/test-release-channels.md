---
"shiplane": minor
---

`shiplane test-release` publishes what the pending changesets release (npm packages only for now;
other units say a test release is not available yet), at the version the next release gives them, so
a test version always sorts above the last release: `0.6.0-main.329aafb`. Name a channel for a
numbered prerelease, `shiplane test-release beta` → `0.6.0-beta.<n>` under the npm tag `beta`, the
next free number read from npm. `testRelease` gives each branch its channel, with the
`testReleases.nightly`, `.prerelease` and `.gitflow` presets and documented `channels`. `--dry-run`
shows each version and tag, a terminal picks which pending packages publish, and `latest` stays the
real release's.
