import type { Node } from "yaml";
import { Document, isScalar, visit } from "yaml";

/** How shiplane writes shiplane.yml: lines up to 100 wide, `[pnpm, -s, build]` with no padding. */
export const YAML_WRITE = { lineWidth: 100, flowCollectionPadding: false } as const;

/** Puts each list of plain values, such as a command and its arguments, on one line. */
export const oneLineLists = (node: Document | Node) =>
  visit(node, {
    Seq: (_key, seq) => {
      if (seq.items.every(isScalar)) seq.flow = true;
    },
  });

/** A value as shiplane.yml holds it: maps as blocks, a list of plain values on one line. */
export const yamlText = (value: unknown) => {
  const document = new Document(value);
  oneLineLists(document);
  return document.toString(YAML_WRITE);
};
