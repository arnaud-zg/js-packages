import { setTimeout as sleep } from "node:timers/promises";

/**
 * Runs `run`, then again after each of `delays` while its result is `retryable`; returns the last
 * result, whatever it is.
 */
export const retrying = async <Result>({
  run,
  retryable,
  delays,
  wait = sleep,
}: {
  run: () => Promise<Result>;
  retryable: (result: Result) => boolean;
  /** How long to wait before each new try, in ms: one try per delay. */
  delays: readonly number[];
  wait?: (ms: number) => Promise<unknown>;
}): Promise<Result> => {
  let result = await run();
  for (const delay of delays) {
    if (!retryable(result)) return result;
    await wait(delay);
    result = await run();
  }
  return result;
};
