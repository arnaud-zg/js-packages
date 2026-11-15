import type { InterruptGuard } from "./interruptGuard";

// expo-doctor runs synchronously, so a `finally` never runs on Ctrl-C: restore the app's package.json here.
export const processSignals: InterruptGuard = {
  run({ work, onInterrupt }) {
    const restoreAndExit = () => {
      onInterrupt();
      process.exit(1);
    };
    process.on("SIGINT", restoreAndExit);
    process.on("SIGTERM", restoreAndExit);
    try {
      return work();
    } finally {
      process.off("SIGINT", restoreAndExit);
      process.off("SIGTERM", restoreAndExit);
    }
  },
};
