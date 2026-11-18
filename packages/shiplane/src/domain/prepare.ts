import { z } from "zod";

/** What a `prepare` command may name, filled per unit. */
const PLACEHOLDERS = ["unit", "dir"];

/** A `prepare` command: text naming only `{unit}` and `{dir}`. */
export const PrepareSchema = z
  .string({ error: 'prepare is a shell command, such as "pnpm --filter {unit} build"' })
  .superRefine((text, context) => {
    for (const [, name = ""] of text.matchAll(/\{([^}]*)\}/g)) {
      if (!PLACEHOLDERS.includes(name)) {
        context.addIssue({ code: "custom", message: `unknown placeholder {${name}} in prepare` });
      }
    }
  });

/** The command a unit prepares with: `{unit}` its name, `{dir}` its folder from the root. */
export const prepareLine = (template: string, { name, dir }: { name: string; dir: string }) =>
  template.replaceAll("{unit}", name).replaceAll("{dir}", dir);
