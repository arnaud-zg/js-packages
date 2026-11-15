import type { ConfigProblem } from "../application/config/problem";
import { paint } from "../application/say";

export const out = (line = "") => process.stdout.write(`${line}\n`);

/** Problems as `file:line  message`, each hint on the line below. */
export const printProblems = (problems: readonly ConfigProblem[]) => {
  problems.forEach(({ file, line, message, hint }) => {
    const where = line === undefined ? file : `${file}:${line}`;
    out(`${paint("red", "✗")}  ${paint("bold", where)}  ${message}`);
    if (hint) out(`   ${paint("dim", hint)}`);
  });
};
