---
"shiplane": minor
---

Publish a branch release for testers: on a branch with an open pull request, `shiplane` (asked
first) or `shiplane branch` publishes each npm package the branch changed as
`<version>-<branch>.<sha>` under a branch npm tag, no changeset needed, keeps the install lines in
one pull request comment, and leaves git untouched. Releases now start from the default branch git
reports, main or master.
