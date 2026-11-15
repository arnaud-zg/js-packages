import type {
  AfterShipContext,
  CodeHostPort,
  Environment,
  Feature,
  FollowUp,
  IssueRef,
  ServiceAdapter,
  Shipped,
  SourceControlPort,
} from "shiplane/plugin";
import { issueName, previousTag } from "shiplane/plugin";

import type { Release } from "./issues";
import { pullRequestNumbers, relatedIssues, releaseComment, releaseMarker } from "./issues";

export interface ReleaseCommentsOptions {
  /** Where the pull requests and issues live, and where the comments go. */
  codeHost: ServiceAdapter<CodeHostPort>;
  /** Where the tags are, to find the version a ship follows. */
  sourceControl: ServiceAdapter<SourceControlPort>;
  /** The apps whose ships comment; every app when absent. */
  apps?: string[];
}

interface Target {
  about: IssueRef;
  environment: Environment;
  kind: "pr" | "issue";
  releases: (Release & { refs: IssueRef[] })[];
}

const targetsOf = (
  linked: ReadonlyMap<number, { pr: IssueRef; issues: IssueRef[] }>,
  reached: readonly { shipped: Shipped; numbers: number[] }[],
) => {
  const prs = new Map<string, Target>();
  const issues = new Map<string, Target>();
  const add = (
    into: Map<string, Target>,
    kind: Target["kind"],
    about: IssueRef,
    { unit, tag, environment }: Shipped,
    refs: IssueRef[],
  ) => {
    const key = `${environment} ${issueName(about)}`;
    const target = into.get(key) ?? { about, environment, kind, releases: [] };
    const release = target.releases.find((entry) => entry.tag === tag);
    if (release) release.refs.push(...refs);
    else target.releases.push({ unit: unit.name, version: unit.version, tag, refs: [...refs] });
    into.set(key, target);
  };
  for (const { shipped, numbers } of reached) {
    for (const number of numbers) {
      const entry = linked.get(number);
      if (!entry) continue;
      add(prs, "pr", entry.pr, shipped, entry.issues);
      for (const issue of entry.issues) add(issues, "issue", issue, shipped, [entry.pr]);
    }
  }
  const sorted = [...prs.values()].sort((left, right) => left.about.number - right.about.number);
  return [...sorted, ...issues.values()];
};

const uniqueRefs = (refs: readonly IssueRef[]) => {
  const seen = new Map(refs.map((ref) => [issueName(ref), ref]));
  return [...seen.values()];
};

const followUpsOf = async (
  codeHost: CodeHostPort,
  context: AfterShipContext,
  tags: ReadonlySet<string>,
  picked: readonly Shipped[],
): Promise<FollowUp[]> => {
  const reached = await Promise.all(
    picked.map(async (shipped) => {
      const { unit, tag } = shipped;
      const from = previousTag({
        tags,
        unit: unit.name,
        version: unit.version,
        format: context.tagFormat,
      });
      const numbers = from
        ? pullRequestNumbers(await context.subjectsReaching(unit, from, tag))
        : [];
      return { shipped, numbers: numbers.sort((left, right) => left - right) };
    }),
  );
  const numbers = [...new Set(reached.flatMap(({ numbers: found }) => found))].sort(
    (left, right) => left - right,
  );
  if (numbers.length === 0) return [];
  const prs = await codeHost.pullRequests(numbers);
  const linked = new Map(
    prs.map((pr, index) => [
      numbers[index] ?? pr.number,
      { pr: { repository: pr.repository, number: pr.number }, issues: relatedIssues(pr) },
    ]),
  );
  const targets = targetsOf(linked, reached);
  if (targets.length === 0) return [];
  const existing = await codeHost.comments(targets.map(({ about }) => about));
  return targets.flatMap(({ about, environment, kind, releases }, index) => {
    const pending = releases.filter(
      ({ tag }) =>
        !existing[index]?.some((comment) => comment.includes(releaseMarker(tag, environment))),
    );
    if (pending.length === 0) return [];
    const mention = {
      kind: kind === "pr" ? ("issue" as const) : ("pr" as const),
      refs: uniqueRefs(pending.flatMap(({ refs }) => refs)),
    };
    return [
      {
        label: `comment on ${issueName(about)}: ${pending.map(({ tag }) => tag).join(", ")} on ${environment}`,
        run: () =>
          codeHost.comment(
            about,
            releaseComment({ about, releases: pending, environment, mention }),
          ),
      },
    ];
  });
};

/** Tells every PR the shipped versions hold, and every issue they relate to, that they are out: one comment per PR or issue, each tag and environment once. */
export const releaseComments = ({
  codeHost,
  sourceControl,
  apps,
}: ReleaseCommentsOptions): Feature => ({
  type: "feature",
  name: "release-comments",
  adapters: [codeHost, sourceControl],
  requirements: () => [
    ...(codeHost.requirements?.() ?? []),
    ...(sourceControl.requirements?.() ?? []),
  ],
  afterShip: async (context, shipped) => {
    const picked = shipped.filter(({ unit }) => !apps || apps.includes(unit.name));
    if (picked.length === 0) return [];
    const host = context.open(codeHost);
    const tags = await context.open(sourceControl).tags();
    return followUpsOf(host, context, tags, picked);
  },
});
