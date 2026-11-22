---
"shiplane": minor
---

`shiplane schema` writes the editor schema of `shiplane.yml`: each port offers the adapters the
installed plugins give, plus your own (`shiplane/adapters/*.ts` and each local file `shiplane.yml`
names), and once `use:` names one, the keys its `with:` takes. It puts the schema's line on top of
`shiplane.yml`. The schema for the first-party plugins ships in the package as
`shiplane/shiplane.schema.json`.
