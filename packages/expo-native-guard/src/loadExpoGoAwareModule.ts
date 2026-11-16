import { isRunningInExpoGo } from "expo";

// Loaders must be require() calls: Metro evaluates static imports eagerly, crashing Expo Go.
export const loadExpoGoAwareModule = <T>(loaders: { native: () => T; expoGo: () => T }): T =>
  isRunningInExpoGo() ? loaders.expoGo() : loaders.native();
