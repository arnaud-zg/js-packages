---
"shiplane": minor
---

Publish a branch release for testers: on a branch with an open pull request, `shiplane` (asked
first) or `shiplane branch` publishes each npm package with a pending changeset as
`<next>-<branch>.<sha>` under a branch npm tag, keeps the install lines in one pull request comment,
and leaves git untouched. Releases now start from the default branch git reports, main or master.
