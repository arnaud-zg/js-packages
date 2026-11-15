import type { Prompter } from "../ports/terminal.port";

/** Nobody answers: --yes takes every suggestion, and without a terminal there is nobody to ask. */
export const unattended = ({
  prompter,
  options,
}: {
  prompter: Pick<Prompter, "interactive">;
  options: { yes: boolean };
}) => options.yes || !prompter.interactive;
