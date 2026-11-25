import type { VersionChoice } from "shiplane/plugin";

import type { MobileRelease, Platform, ReleaseAction, RetryStep } from "./decide";

export const PLATFORM_NAME: Record<Platform, string> = { ios: "iOS", android: "Android" };

/** A count with its noun: `1 crash`, `3 crashes`. */
export const count = ({ total, one, many }: { total: number; one: string; many: string }) =>
  `${total} ${total === 1 ? one : many}`;

/** How long an update has been out, as a person says it: hours under two days, then days. */
export const timeOut = (hours: number) =>
  hours < 48
    ? count({ total: Math.max(1, Math.floor(hours)), one: "hour", many: "hours" })
    : count({ total: Math.floor(hours / 24), one: "day", many: "days" });

/** Up to three changed files, then `...` when there are more. */
export const fewFiles = (files: readonly string[]) =>
  files.slice(0, 3).join(", ") + (files.length > 3 ? ", ..." : "");

/** How long ago, as a person says it: minutes, hours under two days, then days. */
export const ago = ({ from, now }: { from: string; now: Date }) => {
  const minutes = Math.max(1, Math.floor((now.getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

const BUILD_LABEL = "New build, iOS and Android";
const UPDATE_LABEL = "Over-the-air update";

/**
 * What the person may pick once detection spoke, the suggestion first: a build is always possible,
 * an update only on the native layer the installed binaries carry.
 */
export const mobileChoice = ({
  action,
  why,
  app,
  environment,
}: {
  action: ReleaseAction;
  why: string;
  app: string;
  environment: string;
}): VersionChoice | undefined => {
  if (action === "wait" || action === "pull") return undefined;
  const question = `What should ${app} ship to ${environment}?`;
  if (action === "build") {
    return {
      question,
      suggested: "build",
      options: [
        { value: "build", label: `${BUILD_LABEL} (suggested)`, hint: why },
        {
          value: "update",
          label: UPDATE_LABEL,
          hint: "not safe: installed binaries lack this native layer",
          disabled: true,
        },
      ],
    };
  }
  return {
    question,
    suggested: "update",
    options: [
      { value: "update", label: `${UPDATE_LABEL} (suggested)`, hint: why },
      {
        value: "build",
        label: BUILD_LABEL,
        hint: "not needed: a new binary anyway, under its own version",
      },
    ],
  };
};

/** What the release pull request says ships once it is merged. */
export const ON_MERGE: Partial<Record<MobileRelease["ships"], string>> = {
  build: "Build iOS and Android, submitted when done",
  update: "Over-the-air update",
};

/** The failure EAS shows for a version, as a person reads it, or null when it shows none. */
export const retryFailure = ({ steps, now }: { steps: readonly RetryStep[]; now: Date }) => {
  for (const step of steps) {
    if (step.action === "build" && step.failed) {
      const verb = step.failed.status === "canceled" ? "was canceled" : "failed";
      const when = ago({ from: step.failed.createdAt, now });
      return {
        short: `the ${PLATFORM_NAME[step.platform]} build ${verb} ${when}`,
        what: `build`,
        platform: PLATFORM_NAME[step.platform],
        verb,
        when,
      };
    }
    if (step.action === "submit" && step.submission?.createdAt) {
      const verb = step.submission.status === "canceled" ? "was canceled" : "failed";
      const when = ago({ from: step.submission.createdAt, now });
      return {
        short: `the ${PLATFORM_NAME[step.platform]} submission ${verb} ${when}`,
        what: "submission",
        platform: PLATFORM_NAME[step.platform],
        verb,
        when,
      };
    }
  }
  return null;
};

const ORDER: Record<RetryStep["action"], number> = { done: 0, running: 1, submit: 2, build: 3 };

const found = (step: RetryStep) => {
  const name = PLATFORM_NAME[step.platform];
  switch (step.action) {
    case "done":
      return `${name} ✓ build ${step.build.buildNumber ?? step.build.id}`;
    case "running":
      return `${name} … building`;
    case "submit":
      return `${name} ✓ build ${step.build.buildNumber ?? step.build.id}, submit ✗ ${step.submission ? step.submission.status.replace("errored", "failed") : "missing"}`;
    case "build":
      return step.failed
        ? `${name} ✗ ${step.failed.status === "canceled" ? "canceled" : "failed"}`
        : `${name} – no build`;
  }
};

const joined = (names: string[]) => names.join(" and ");

/**
 * One line: what a retry found, then what runs, such as
 * `tag ✓, release notes ✓, Android ✓ build 42, iOS ✗ failed → build iOS, then submit`.
 */
export const retryLine = ({
  steps,
  notes,
}: {
  steps: readonly RetryStep[];
  notes: boolean | null;
}) => {
  const sorted = [...steps].sort((left, right) => ORDER[left.action] - ORDER[right.action]);
  const builds = steps
    .filter(({ action }) => action === "build")
    .map(({ platform }) => PLATFORM_NAME[platform]);
  const submits = steps
    .filter(({ action }) => action === "submit")
    .map(({ platform }) => PLATFORM_NAME[platform]);
  const runs = [
    ...(builds.length > 0 ? [`build ${joined(builds)}, then submit`] : []),
    ...(submits.length > 0 ? [`submit ${joined(submits)}`] : []),
  ];
  return [
    "tag ✓",
    ...(notes === null ? [] : [`release notes ${notes ? "✓" : "✗"}`]),
    ...sorted.map(found),
  ]
    .join(", ")
    .concat(` → ${runs.join("; ")}`);
};
