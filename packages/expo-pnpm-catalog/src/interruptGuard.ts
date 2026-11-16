export type GuardedTask<Result> = {
  work: () => Result;
  /** Undoes the task's side effects when the process is interrupted mid-run. */
  onInterrupt: () => void;
};

export type InterruptGuard = {
  run<Result>(task: GuardedTask<Result>): Result;
};
