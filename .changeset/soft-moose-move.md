---
"shiplane": patch
---

A ship through GitHub Actions runs on the release tag, even when the tag is main's last commit, so a
merge to main while the run waits can't change what ships, and the run and its deployment show the
tag. Your ship workflow needs no change: one that checks out github.ref already accepts a tag.
