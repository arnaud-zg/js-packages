/** Where a unit runs, in promotion order: production ships what preview validated. */
export const ENVIRONMENTS = ["preview", "production"] as const;

/** Where the released packages go on a runner: tagged, then published under their real dist-tag. */
export const LIVE = "live";

export type Environment = (typeof ENVIRONMENTS)[number];
