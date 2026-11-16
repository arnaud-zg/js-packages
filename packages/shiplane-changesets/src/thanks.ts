/**
 * Ready-made templates for `line`, each change's line in the release notes. Each is a plain string.
 * Placeholders: `{summary}` the change as written, `{authors}` `@a and @b`, `{pr}` the pull
 * request's URL, which GitHub shows as `#62`.
 */
export const lines = {
  /** `* Exit 1 on a bad config by @octocat in https://github.com/o/r/pull/62`, as GitHub writes it. */
  whatsChanged: "* {summary} by {authors} in {pr}",
  /** `- Exit 1 on a bad config (https://github.com/o/r/pull/62)`. */
  compact: "- {summary} ({pr})",
} as const;

/**
 * Ready-made templates for `thanks`. Each is a plain string: use one as it is, extend it, or copy it
 * and edit. Placeholders: `{changes}` the release's changes, `{contributors}` `@arnaud-zg`,
 * `{list}` one `- @login` per line, `{avatars}` a row of GitHub avatars.
 */
export const presets = {
  /** `🙏 Thanks to @arnaud-zg for this release!` under the changes. */
  sentence: "{changes}\n\n🙏 Thanks to {contributors} for this release!",
  /** A `### Contributors` heading under the changes, then `- @arnaud-zg`. */
  list: "{changes}\n\n### Contributors\n\n{list}",
  /** A `### Contributors` heading under the changes, then a row of linked avatars. */
  avatars: "{changes}\n\n### Contributors\n\n{avatars}",
  /** The changes only: no one is thanked. */
  none: "{changes}",
} as const;

interface Contributor {
  login: string;
  url: string;
}

/** One change as @changesets/changelog-github writes it, read once. */
interface Change {
  /** The pull request's URL, or `""`. */
  pr: string;
  authors: Contributor[];
  summary: string;
  /** The line as written, without its inline thanks. */
  unthanked: string;
}

// `- [#62](pr) [`hash`](commit) Thanks [@a](url), [@b](url)! - summary`, each link optional.
const CHANGE =
  /^- (?:\[#\d+\]\(([^)]+)\) )?(?:\[`[^`]+`\]\([^)]+\) )?(?:Thanks ((?:\[@[^\]]+\]\([^)]+\)(?:, )?)+)! )?- (.*)$/;
// `Thanks [@a](url), [@b](url)!` as @changesets/changelog-github writes it, after the links.
const INLINE = / Thanks ((?:\[@[^\]]+\]\([^)]+\)(?:, )?)+)!/;
const USER = /\[@([^\]]+)\]\(([^)]+)\)/g;
// A summary's next line of prose: indented, and not a list, quote, table, heading or code fence.
const WRAPPED = /^ {2}(?![-*+>|#]|\d+\.|```)\S/;

const changeOf = (line: string): Change | null => {
  const match = CHANGE.exec(line);
  if (!match) return null;
  const [, pr = "", users = "", summary = ""] = match;
  const authors = [...users.matchAll(USER)].map(([, login = "", url = ""]) => ({ login, url }));
  return { pr, authors, summary, unthanked: line.replace(INLINE, "") };
};

const linked = ({ login, url }: Contributor) => `[@${login}](${url})`;

/** `a`, `a and b`, `a, b and c`. */
const joined = (words: readonly string[]) =>
  words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

const PLACEHOLDERS: Record<string, (contributors: readonly Contributor[]) => string> = {
  "{contributors}": (contributors) => joined(contributors.map(linked)),
  "{list}": (contributors) => contributors.map((person) => `- ${linked(person)}`).join("\n"),
  "{avatars}": (contributors) =>
    contributors
      .map(
        ({ login, url }) =>
          `<a href="${url}"><img src="${url}.png?size=64" width="32" height="32" alt="@${login}"></a>`,
      )
      .join(" "),
};

/** A change by `template`; null when the change lacks a value the template asks for. */
const lineOf = (template: string, { pr, authors, summary }: Change) => {
  const values: Record<string, string> = {
    "{summary}": summary,
    "{authors}": joined(authors.map(({ login }) => `@${login}`)),
    "{pr}": pr,
  };
  const used = Object.entries(values).filter(([key]) => template.includes(key));
  if (used.some(([, value]) => value === "")) return null;
  return used.reduce((out, [key, value]) => out.replaceAll(key, () => value), template);
};

export interface NotesOptions {
  /** Each change's line, such as `lines.whatsChanged`. */
  line?: string;
  /** The section around the changes, such as `presets.sentence`. */
  thanks?: string;
}

/**
 * Rewrites the newest section of a changelog, the one a release just wrote: each change by `line`,
 * the whole by `thanks`. A change missing a value `line` asks for stays as changesets wrote it. A
 * `thanks` without `{changes}` goes under the changes; a section that thanks no one gets no thanks.
 */
export const placeNotes = (changelog: string, { line, thanks }: NotesOptions): string => {
  const start = changelog.search(/^## /m);
  if (start === -1) return changelog;
  const headingEnd = changelog.indexOf("\n", start);
  if (headingEnd === -1) return changelog;
  const nextHeading = changelog.slice(headingEnd).search(/^## /m);
  const end = nextHeading === -1 ? changelog.length : headingEnd + nextHeading;

  const contributors = new Map<string, Contributor>();
  const written = changelog.slice(headingEnd + 1, end).split("\n");
  const rewritten: string[] = [];
  for (let index = 0; index < written.length; index += 1) {
    const text = written[index] ?? "";
    const change = changeOf(text);
    if (!change) {
      rewritten.push(text);
      continue;
    }
    change.authors.forEach((person) => {
      if (!contributors.has(person.login)) contributors.set(person.login, person);
    });
    // A summary wrapped over several lines is one sentence: the line goes on after all of it.
    const wrapped: string[] = [];
    while (WRAPPED.test(written[index + 1 + wrapped.length] ?? "")) {
      wrapped.push((written[index + 1 + wrapped.length] ?? "").trim());
    }
    const shaped =
      line === undefined
        ? null
        : lineOf(line, { ...change, summary: [change.summary, ...wrapped].join(" ") });
    if (shaped !== null) index += wrapped.length;
    rewritten.push(shaped ?? (thanks === undefined ? text : change.unthanked));
  }
  const template = contributors.size > 0 ? thanks : undefined;
  if (template === undefined && rewritten.join("\n") === written.join("\n")) return changelog;

  const full =
    template === undefined || template.includes("{changes}")
      ? (template ?? "{changes}")
      : `{changes}\n\n${template}`;
  const section = Object.entries(PLACEHOLDERS)
    .reduce(
      (out, [key, render]) => out.replaceAll(key, () => render([...contributors.values()])),
      full,
    )
    .replaceAll("{changes}", () => rewritten.join("\n").trim())
    .trim();
  const rest = changelog.slice(end);
  return `${changelog.slice(0, headingEnd + 1)}\n${section}\n${rest ? `\n${rest}` : ""}`;
};
