import type { Environment } from "../../domain/environment";
import type { ReleaseUnit } from "../../domain/unit";
import { DEFAULT_FLOW } from "../../domain/environment";
import { isPerEnvValue, isRecord, REFERENCE, valueAt } from "./values";

const resolve = (
  value: unknown,
  env: Environment,
  units: readonly ReleaseUnit[],
  path: readonly Environment[],
): unknown => {
  const picked = isPerEnvValue(value, path) ? value[env] : value;
  if (typeof picked === "string") {
    return picked.replace(REFERENCE, (_match, name: string, key: string) => {
      const other = units.find((unit) => unit.name === name);
      const resolved = other
        ? resolve(valueAt(other.options, key.split(".")), env, units, path)
        : "";
      return typeof resolved === "string" ? resolved : "";
    });
  }
  if (Array.isArray(picked)) return picked.map((item) => resolve(item, env, units, path));
  if (isRecord(picked)) {
    return Object.fromEntries(
      Object.entries(picked).map(([key, item]) => [key, resolve(item, env, units, path)]),
    );
  }
  return picked;
};

/** A unit's options for one environment: per-environment values picked, references filled in. */
export const optionsFor = (
  unit: ReleaseUnit,
  env: Environment,
  units: readonly ReleaseUnit[],
  path: readonly Environment[] = DEFAULT_FLOW.path,
): Record<string, unknown> => {
  const resolved = resolve(unit.options, env, units, path);
  return isRecord(resolved) ? resolved : {};
};
