import type { z } from "zod";

export type ParsedJson<Value> = { success: true; data: Value } | { success: false; error: string };

/** Text a tool printed, read as JSON and checked against `schema`; never throws. */
export const parseJson = <Schema extends z.ZodType>({
  text,
  schema,
}: {
  text: string;
  schema: Schema;
}): ParsedJson<z.output<Schema>> => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, error: parsed.error.message };
};
