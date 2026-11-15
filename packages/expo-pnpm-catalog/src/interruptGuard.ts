export type GuardedTask<Result> = {
  work: () => Result;
  /** Undoes the task's side effects when the process is interrupted mid-run. */
  onInterrupt: () => void;
};

export type InterruptGuard = {
  run<Result>(task: GuardedTask<Result>): Result;
};

// A library caller owns its process signals, so by default nothing is installed.
export const noInterruptGuard: InterruptGuard = {
  run: ({ work }) => work(),
};
