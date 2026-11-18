import { afterEach, describe, expect, it, vi } from "vitest";

import { processSignals } from "../processSignals.adapter";

afterEach(() => {
  vi.restoreAllMocks();
});

function listenerCounts(): { sigint: number; sigterm: number } {
  return {
    sigint: process.listenerCount("SIGINT"),
    sigterm: process.listenerCount("SIGTERM"),
  };
}

describe("guarding a run against Ctrl-C and termination", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "given work in progress, when %s arrives, then its side effects are undone and the process exits with 1",
    (signal) => {
      const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const undone: string[] = [];

      processSignals.run({
        work: () => process.emit(signal, signal),
        onInterrupt: () => undone.push("restored"),
      });

      expect(undone).toEqual(["restored"]);
      expect(exit).toHaveBeenCalledWith(1);
    },
  );

  it("given work in progress, when it finishes, then both signals were caught only while it ran and its result comes back", () => {
    const before = listenerCounts();

    const during = processSignals.run({ work: listenerCounts, onInterrupt: () => undefined });

    expect(during).toEqual({ sigint: before.sigint + 1, sigterm: before.sigterm + 1 });
    expect(listenerCounts()).toEqual(before);
  });

  it("given work that throws, when it fails, then the error comes back and the signals are no longer caught", () => {
    const before = listenerCounts();

    expect(() =>
      processSignals.run({
        work: () => {
          throw new Error("boom");
        },
        onInterrupt: () => undefined,
      }),
    ).toThrow("boom");
    expect(listenerCounts()).toEqual(before);
  });
});
