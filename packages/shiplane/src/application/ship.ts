import type { DeployPath, WebShip } from "../domain/deploys";
import type { Environment } from "../domain/environment";
import type { WorkflowJob } from "../domain/shipRoute";
import type { ReleaseUnit } from "../domain/unit";
import type { AppInput, ReleaseModule } from "../modules/module";
import type { Deploy } from "../ports/code-host.port";
import type { Decision, Job, ShipKind } from "../ports/delivery.port";
import type { Shipment } from "./askPath";
import type { ReleaseContext } from "./context";
import type { Outcomes, ShipStep } from "./shipSteps";
import { onlyVersionFiles, shipsFrom, webShip } from "../domain/deploys";
import { yesAllowed } from "../domain/governance";
import { prepareLine } from "../domain/prepare";
import { choosesPath, forcedPath, routeChoice, shipRuns } from "../domain/shipRoute";
import { askPaths, ciLabel, pathLabel } from "./askPath";
import { buildingIfNeeded } from "./buildIfNeeded";
import { checkEnvBeforeDeploy } from "./checkEnvBeforeDeploy";
import { runFollowUps } from "./followUps";
import { mapLimit } from "./mapLimit";
import { pullRequestFirst } from "./pullRequestFirst";
import { deployedOn } from "./readScope";
import { signIn, signInsOf } from "./requirements";
import { confirm, fail, paint } from "./say";
import { runShipSteps, writePlan, writeResult } from "./shipSteps";
import {
  checkout,
  decideContext,
  destination,
  dispatchShip,
  environmentLabel,
  jobInput,
  runHere,
  shipPlanOf,
  unitTag,
  versionFiles,
} from "./targets";

interface Ready {
  unit: ReleaseUnit;
  module: ReleaseModule;
  input: AppInput;
  kind: ShipKind;
  jobs: Job[];
  /** Its module decided for itself: the moved-past check is already its own. */
  decided: boolean;
  /** Why this machine cannot ship it, as its module decided. */
  notLocal: string | null;
  /** The person already said go for it. */
  confirmed: boolean;
}

const WEB_STATUS: Record<Exclude<WebShip, "deploy">, string> = {
  deploying: "deploying already",
  shipped: "already there",
  "not-on-preview": "not on preview yet: ship it there first",
};

/** A web unit decides from GitHub Deployments, which a ship records once it rolled out. */
const webDecision = (
  context: ReleaseContext,
  module: ReleaseModule,
  input: AppInput,
  history: Deploy[],
): Decision => {
  const { jobs } = shipPlanOf(context, module, input);
  const ship = webShip({
    environment: input.environment,
    run: deployedOn(history, input.tag, input.environment),
    onPreview: deployedOn(history, input.tag, "preview") === "done",
  });
  return ship === "deploy"
    ? { action: "ship", kind: "deploy", jobs }
    : { action: "none", status: WEB_STATUS[ship] };
};

/**
 * Where a choice stands, then the person's pick: its jobs ship, or nothing does and it is held.
 * With nobody to answer, a choice that says so fails instead.
 */
const chosen = async (
  context: ReleaseContext,
  choice: Extract<Decision, { action: "choose" }>,
): Promise<Extract<Decision, { action: "ship" | "none" | "fail" }>> => {
  const { output, prompter, options } = context;
  // Only a choice that names what to say refuses unattended; any other is asked whenever it can be.
  if (choice.unattended && (!prompter.interactive || options.ci)) {
    return { action: "fail", ...choice.unattended };
  }
  output.line();
  choice.lines.forEach((line) => output.line(`  ${line}`));
  output.line();
  const value = prompter.interactive
    ? await prompter.select(
        choice.question,
        choice.options.map(({ value, label, hint, disabled }) => ({
          value,
          label,
          hint,
          disabled,
        })),
        choice.suggested,
      )
    : null;
  const picked = choice.options.find((option) => option.value === value);
  picked?.then?.forEach((line) => output.line(`  ${line}`));
  const jobs = picked?.jobs ?? [];
  return jobs.length > 0
    ? {
        action: "ship",
        kind: choice.kind ?? "update",
        jobs,
        ...(choice.notLocal ? { notLocal: choice.notLocal } : {}),
        ...(choice.confirmed ? { confirmed: true } : {}),
      }
    : { action: "none", status: choice.held };
};

/** Units checked at once: their platforms answer slowly, each on its own. */
const CHECKS_AT_ONCE = 4;

/**
 * What every picked unit needs on the environment, in dispatch order, said as it goes. Every unit is
 * checked at once, then each is settled in order. A module may first need a small PR merged (a
 * version moving): it opens, merges, and that unit and every one after it decide again. Null when
 * one of them refused.
 */
const decideAll = async (
  context: ReleaseContext,
  environment: Environment,
  scope: ReadonlySet<string> | undefined,
): Promise<Ready[] | null> => {
  const { release, services, output } = context;
  const recorded = await services.codeHost.deployments().catch(() => []);
  const picked = release.units.flatMap((unit) => {
    const found = unitTag(context, unit);
    if ((scope && !scope.has(unit.name)) || !found) return [];
    return [{ unit, ...found }];
  });
  const tagged = await mapLimit(
    picked,
    CHECKS_AT_ONCE,
    async ({ module, tag }) =>
      module.decide !== undefined || (await services.sourceControl.tagCommit(tag)) !== null,
  );
  const units = picked
    .filter((_, index) => tagged[index])
    .map(({ unit, module, tag }) => {
      const decide = async () => {
        const at = await checkout(context);
        const input = jobInput(context, module, unit, { tag, environment, ...at });
        const decision = module.decide
          ? await module.decide(decideContext(context), input)
          : webDecision(context, module, input, recorded);
        return { input, decision };
      };
      const checked = module.kind === "published-package" ? module.provider : environment;
      const label = module.releaseOnly
        ? `Checking what ${tag} needs`
        : `Checking what ${tag} needs on ${checked}`;
      const on = module.releaseOnly ? null : checked;
      return { unit, module, tag, decide, label, on };
    });
  const [only] = units;
  const places = new Set(units.map(({ on }) => on));
  const [place] = places;
  const batchLabel = `Checking what ${units.length} units need${places.size === 1 && place ? ` on ${place}` : ""}`;
  let done = 0;
  const firstLook = !only
    ? []
    : units.length === 1
      ? [await context.progress.during(only.label, "thinking", only.decide)]
      : await context.progress.during(
          batchLabel,
          "thinking",
          () =>
            mapLimit(units, CHECKS_AT_ONCE, async ({ decide }) => {
              const result = await decide();
              done += 1;
              return result;
            }),
          { done: () => done, total: units.length },
        );
  const ready: Ready[] = [];
  // A merged PR moves main: every unit after it decides again on the new commit.
  let moved = false;
  for (const [index, { unit, module, tag, decide, label }] of units.entries()) {
    const looked = firstLook[index];
    if (!looked) continue;
    let { input, decision } = moved
      ? await context.progress.during(label, "thinking", decide)
      : looked;
    while (decision.action === "pull-request") {
      const merged = await pullRequestFirst(context, decision);
      if (merged === "failed") return null;
      if (merged === "declined") {
        decision = { action: "none", status: "left for later" };
        break;
      }
      moved = true;
      ({ input, decision } = await decide());
    }
    if (decision.action === "choose") decision = await chosen(context, decision);
    if (decision.action === "fail") {
      fail(context, decision.title, decision.detail, decision.commands);
      return null;
    }
    if (decision.action === "none") {
      output.line(`  ${paint("dim", "·")} ${tag}  ${paint("dim", decision.status)}`);
      continue;
    }
    ready.push({
      unit,
      module,
      input,
      kind: decision.kind,
      jobs: decision.jobs,
      decided: module.decide !== undefined,
      notLocal: decision.notLocal ?? null,
      confirmed: decision.confirmed === true,
    });
  }
  return ready;
};

/** Why a path cannot ship a unit, or null when it can. */
const blockedOn = async (
  context: ReleaseContext,
  path: DeployPath,
  { input, jobs, decided, notLocal }: Ready,
): Promise<string | null> => {
  const { services } = context;
  if (path === "ci") {
    const workflow = services.ciPipeline.shipWorkflow;
    // Where a ref holds the workflow is the pipeline's to say; one that says nothing is not checked.
    const file = services.ciPipeline.workflowFile?.(workflow);
    for (const { ci } of jobs) {
      if (!ci) return "only ships from this machine";
      if (file === undefined) continue;
      if ((await services.sourceControl.fileAt(ci.ref, file)) !== null) continue;
      const onMain =
        ci.ref !== input.defaultBranch &&
        (await services.sourceControl.fileAt(input.defaultBranch, file)) !== null;
      return onMain ? `predates ${workflow}` : `no ${workflow}`;
    }
    return null;
  }
  if (decided) return notLocal;
  const changed = await services.sourceControl.diffNames(input.tag, "HEAD");
  const sinceTagOnlyVersionFiles = onlyVersionFiles(changed, versionFiles(context));
  return shipsFrom(path, { sinceTagOnlyVersionFiles })
    ? null
    : `${input.defaultBranch} moved past it`;
};

/** What to do instead, when the path a person forced cannot ship a unit. */
const instead = (context: ReleaseContext, forced: DeployPath) =>
  forced === "ci"
    ? "ship it from this machine"
    : `this machine builds its checkout, ship it through ${ciLabel(context.services.ciPipeline)}`;

const takes = (context: ReleaseContext, path: DeployPath) =>
  `ships ${path === "ci" ? "through" : "from"} ${pathLabel(context.services.ciPipeline, path)}`;

/**
 * The way a unit ships: the forced one when it can, the only one left when the other cannot, or
 * asked. Said whenever it is not asked.
 */
const routeOf = async (
  context: ReleaseContext,
  entry: Ready,
  forced: DeployPath | undefined,
): Promise<DeployPath | "ask" | "skip" | "stuck"> => {
  const say = (mark: string, why: string) =>
    context.output.line(`  ${mark} ${entry.input.tag}  ${paint("dim", why)}`);
  if (forced) {
    const why = await blockedOn(context, forced, entry);
    if (!why) return forced;
    say(paint("yellow", "!"), `${why}: ${instead(context, forced)}`);
    return "skip";
  }
  const ci = await blockedOn(context, "ci", entry);
  const local = await blockedOn(context, "local", entry);
  const choice = routeChoice({ ci, local });
  // Both ways can: the config's way when it names one, else the person picks.
  if (choice.route === "ask") return context.release.via ?? "ask";
  if (choice.route === "stuck") {
    say(paint("red", "✗"), `${ci}, and ${local}: nothing can ship it`);
    return "stuck";
  }
  say(paint("dim", "·"), `${choice.blocked}: ${takes(context, choice.route)}`);
  return choice.route;
};

const shipmentOf =
  (shipWorkflow: string) =>
  ({ unit, module, input, jobs }: Ready): Shipment => ({
    item: { app: unit.name, tag: input.tag, kind: "deploy" },
    workflows: jobs.some(({ ci }) => ci) ? [shipWorkflow] : [],
    typicalMinutes: module.typicalMinutes,
  });

/** Each job the workflow ships, in order, with the commit its ref tags: the default branch moves, so it has none. */
const workflowJobs = async ({ services }: ReleaseContext, entries: readonly Ready[]) => {
  const refs = entries.flatMap(({ unit, jobs, input }) =>
    jobs.flatMap(({ ci }) =>
      ci ? [{ unit: unit.name, ref: ci.ref, moves: ci.ref === input.defaultBranch }] : [],
    ),
  );
  const jobs: WorkflowJob[] = [];
  for (const { unit, ref, moves } of refs) {
    const commit = moves ? null : await services.sourceControl.tagCommit(ref);
    jobs.push({ unit, ref, commit });
  }
  return jobs;
};

/** `Ship a through <the CI pipeline>`, or each tag with its way when they differ. */
const shipQuestion = (
  going: Ready[],
  paths: ReadonlyMap<Ready, DeployPath>,
  environment: string,
  context: ReleaseContext,
) => {
  const label = environmentLabel(
    context,
    going.map(({ unit }) => unit.name),
    environment,
  );
  const used = [...new Set(going.flatMap((entry) => paths.get(entry) ?? []))];
  const [only] = used;
  const names = going
    .map((entry) => {
      const path = paths.get(entry);
      return used.length > 1 && path
        ? `${entry.input.tag} (${pathLabel(context.services.ciPipeline, path)})`
        : entry.input.tag;
    })
    .join(", ");
  const how =
    used.length === 1 && only ? ` through ${pathLabel(context.services.ciPipeline, only)}` : "";
  return `Ship ${names} ${label === "live" ? "live" : `to ${label}`}${how}?`;
};

/** Production refuses --yes and asks for its name; on a runner, the person typed it before the dispatch. */
const mayStart = async (context: ReleaseContext, environment: Environment) => {
  const { output, prompter, options } = context;
  if (options.ci) return true;
  if (!yesAllowed(environment, options.yes)) {
    fail(context, "No --yes on production", "every production step asks a person.", [
      "shiplane ship --channel production",
    ]);
    return false;
  }
  if (environment !== "production") return true;
  if (await prompter.typed('Type "production" to start:', "production")) return true;
  output.line(paint("dim", "Nothing ran."));
  return false;
};

/**
 * The path each unit that chooses one takes: said when only one can, else asked. Null when the
 * person was asked and gave no answer. A picked unit nothing can ship fails the run, after the
 * others shipped.
 */
const pathsOf = async (
  context: ReleaseContext,
  {
    environment,
    ready,
    forced,
  }: { environment: Environment; ready: readonly Ready[]; forced: DeployPath | undefined },
) => {
  const paths = new Map<Ready, DeployPath>();
  const unanswered: Ready[] = [];
  let stuck = false;
  for (const entry of ready.filter(choosesPath)) {
    const route = await routeOf(context, entry, forced);
    if (route === "ask") unanswered.push(entry);
    if (route === "stuck") stuck = true;
    if (route === "ci" || route === "local") paths.set(entry, route);
  }
  if (unanswered.length === 0) return { paths, stuck };
  const answers = await askPaths(
    context,
    environment,
    unanswered.map(shipmentOf(context.services.ciPipeline.shipWorkflow)),
  );
  if (!answers) return null;
  unanswered.forEach((entry, index) => {
    const answer = answers[index];
    if (answer) paths.set(entry, answer);
  });
  return { paths, stuck };
};

/** The person said no: preview offers production instead, which asks for its name on its own rules. */
const declined = async (
  context: ReleaseContext,
  {
    environment,
    scope,
    via,
  }: { environment: Environment; scope?: ReadonlySet<string>; via?: DeployPath },
): Promise<boolean> => {
  const { prompter } = context;
  const instead =
    environment === "preview" &&
    prompter.interactive &&
    (await prompter.confirm("Ship to production instead?"));
  if (instead) return shipTo(context, "production", { scope, via });
  context.progress.say("resting", paint("dim", "Nothing shipped."));
  return true;
};

/**
 * The unit's `prepare` from the config, as a step run from the root before the unit ships or
 * publishes from this machine; null when the config has none.
 */
export const preparing = (
  { release, shell }: ReleaseContext,
  unit: { name: string; dir: string },
  tag: string,
) => {
  if (release.prepare === undefined) return null;
  const line = prepareLine(release.prepare, unit);
  return {
    label: `prepare ${tag}: ${line}`,
    run: async () => {
      const status = await shell.attach("sh", ["-c", line], { cwd: release.root });
      if (status !== 0) throw new Error(`${line} exited with ${status}`);
    },
  };
};

const prepareStep = (context: ReleaseContext, { unit, input, jobs }: Ready): ShipStep[] => {
  const step =
    preparing(context, unit, input.tag) ??
    buildingIfNeeded(context, { unit, tag: input.tag, jobs });
  if (step === null) return [];
  return [
    {
      ...step,
      tags: [input.tag],
      unit: unit.name,
      stage: "prepare",
    },
  ];
};

/**
 * Ships every picked unit its environment does not run yet, and returns once each one is
 * triggered: EAS builds and workflows go on on their own, a Fly deploy from here once rolled out.
 * Production asks for its name first. False on a failure.
 */
export const shipTo = async (
  context: ReleaseContext,
  environment: Environment,
  {
    scope,
    via,
    envChecked = new Set(),
  }: {
    scope?: ReadonlySet<string>;
    via?: DeployPath;
    /** Units whose env this run already checked on this environment. */
    envChecked?: ReadonlySet<string>;
  },
): Promise<boolean> => {
  const { output, prompter, options, services } = context;
  if (!(await mayStart(context, environment))) return false;
  const ready = await decideAll(context, environment, scope);
  if (!ready) return false;
  if (ready.length === 0) {
    context.progress.say(
      "resting",
      paint("dim", `Nothing to ship ${destination(context, scope ?? [], environment)}.`),
    );
    return true;
  }
  const toCheck = ready.map(({ unit }) => unit).filter(({ name }) => !envChecked.has(name));
  const listing = new Set(
    toCheck.filter((unit) => unit.checkEnvBeforeDeploy).map(({ name }) => name),
  );
  const signedIn =
    listing.size === 0 ||
    (await signIn(context, {
      requirements: signInsOf(context.release, listing),
      again: "ship again",
    }));
  if (!signedIn) return false;
  if (!(await checkEnvBeforeDeploy(context, { environment, units: toCheck }))) return false;
  const routed = await pathsOf(context, {
    environment,
    ready,
    forced: forcedPath({ ci: options.ci, via }),
  });
  if (!routed) {
    output.line(paint("dim", "  Nothing shipped."));
    // Cancelled by the person is fine; no terminal to ask is a failure a script should see.
    return prompter.interactive;
  }
  const { paths, stuck } = routed;
  const going = ready.filter((entry) => !choosesPath(entry) || paths.has(entry));
  if (going.length === 0) return !stuck;
  // A job run from its tag's worktree leaves this checkout alone.
  const runsHere = going.some(
    (entry) => paths.get(entry) === "local" && entry.jobs.some(({ from }) => !from),
  );
  if (runsHere && !(await services.sourceControl.isClean())) {
    fail(
      context,
      "Uncommitted changes",
      "this machine ships its checkout: commit or stash them first.",
    );
    return false;
  }
  if (
    going.some(({ confirmed }) => !confirmed) &&
    !(await confirm(
      context,
      shipQuestion(going, paths, environment, context),
      environment === "preview",
    ))
  ) {
    return declined(context, { environment, scope, via });
  }
  const here = going.filter((entry) => paths.get(entry) !== "ci");
  const runs = shipRuns(
    await workflowJobs(
      context,
      going.filter((entry) => paths.get(entry) === "ci"),
    ),
  );
  const workflow = services.ciPipeline.shipWorkflow;
  const steps: ShipStep[] = [
    ...here.flatMap((entry) => [
      ...prepareStep(context, entry),
      ...entry.jobs.map((job) => ({
        label: job.label,
        run: () => runHere(context, job, entry.input),
        tags: [entry.input.tag],
        unit: entry.unit.name,
        stage: "ship" as const,
      })),
    ]),
    ...runs.map((run) => ({
      label: `ship ${run.units.join(", ")} from ${run.ref} (${workflow})`,
      run: () => dispatchShip(context, run, environment),
      tags: going.filter(({ unit }) => run.units.includes(unit.name)).map(({ input }) => input.tag),
      unit: run.units.join(", "),
      stage: "ship" as const,
    })),
  ];
  await writePlan(context, environment, new Set(going.map(({ unit }) => unit.name)));
  const outcomes: Outcomes = new Map();
  const shipped = await runShipSteps(context, steps, outcomes);
  writeResult(context, outcomes);
  if (!shipped) return false;
  const names = going.map(({ input }) => input.tag).join(", ");
  const where = destination(
    context,
    going.map(({ unit }) => unit.name),
    environment,
  );
  output.line();
  context.progress.say(
    "happy",
    `${paint(["bold", "green"], "✓ Triggered.")} ${paint("dim", `${names}, shipping ${where} on their own.`)}`,
  );
  await runFollowUps(
    context,
    going.map(({ unit, input }) => ({ unit, tag: input.tag, environment })),
  );
  const { runsLine } = context.services.ciPipeline;
  if (runs.length > 0 && runsLine) {
    output.line(`    ${paint("cyan", runsLine)}`);
  }
  // A package has no channel to read, so status has nothing to show for one.
  if (going.some(({ module }) => module.kind !== "published-package")) {
    output.line(`    ${paint("cyan", `shiplane status --channel ${environment}`)}`);
  }
  output.line();
  return !stuck;
};
