import type { Mood } from "../../../domain/display";
import type { BatchPlace, Output, Progress, StepPlace } from "../../../ports/terminal.port";

export interface ProgressEvent {
  kind: "stage" | "during" | "say";
  text: string;
  mood?: Mood;
  step?: StepPlace;
  /** How many items a batch runs at once. */
  batch?: number;
}

/** Progress kept as events; what it says also goes to the output, as a terminal would print it. */
export class RecordingProgress implements Progress {
  readonly events: ProgressEvent[] = [];

  constructor(private readonly output: Output) {}

  stage = (stages: readonly string[], index: number) => {
    this.events.push({
      kind: "stage",
      text: stages[index] ?? "",
      step: { index, total: stages.length },
    });
  };

  during = <T>(
    label: string,
    mood: Mood,
    work: () => Promise<T>,
    step?: StepPlace | BatchPlace,
  ) => {
    const place = step && "done" in step ? { batch: step.total } : step ? { step } : {};
    this.events.push({ kind: "during", mood, text: label, ...place });
    return work();
  };

  say = (mood: Mood, text: string) => {
    this.events.push({ kind: "say", mood, text });
    this.output.line(text);
  };
}
