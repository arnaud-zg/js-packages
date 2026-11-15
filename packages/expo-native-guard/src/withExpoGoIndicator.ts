import type { ComponentType } from "react";
import { createElement } from "react";

import { ExpoGoIndicator } from "./ExpoGoIndicator";

// Flags the Expo Go fallback on screen: the native path still needs its own test pass.
export const withExpoGoIndicator = <P extends object>(
  Component: ComponentType<P>,
  name: string,
): ComponentType<P> => {
  const WithExpoGoIndicator = (props: P) =>
    createElement(ExpoGoIndicator, { name, children: createElement(Component, props) });

  WithExpoGoIndicator.displayName = `withExpoGoIndicator(${name})`;

  return WithExpoGoIndicator;
};
