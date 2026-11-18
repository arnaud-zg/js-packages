import type { FC } from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { withExpoGoIndicator } from "../withExpoGoIndicator";

type StubProps = { label: string };

const Stub: FC<StubProps> = ({ label }) => <Text testID="stub">{label}</Text>;

describe("withExpoGoIndicator", () => {
  it("given a wrapped component, when rendered, then the original component still renders with its props", () => {
    const Wrapped = withExpoGoIndicator(Stub, "CameraView");

    render(<Wrapped label="hello" />);

    expect(screen.getByTestId("stub")).toHaveTextContent("hello");
  });

  it("given a component name, when rendered, then it shows a short label with the name and Expo Go", () => {
    const Wrapped = withExpoGoIndicator(Stub, "CameraView");

    render(<Wrapped label="hello" />);

    expect(screen.getByText("CameraView · Expo Go")).toBeTruthy();
  });

  it("given two different wrapped components, when rendered, then each shows its own name", () => {
    const WrappedA = withExpoGoIndicator(Stub, "CameraView");
    const WrappedB = withExpoGoIndicator(Stub, "MascotView");

    render(<WrappedA label="a" />);
    render(<WrappedB label="b" />);

    expect(screen.getByText("CameraView · Expo Go")).toBeTruthy();
    expect(screen.getByText("MascotView · Expo Go")).toBeTruthy();
  });

  it("given a component name, when wrapped, then the wrapper's displayName identifies both the helper and the component", () => {
    const Wrapped = withExpoGoIndicator(Stub, "CameraView");

    expect(Wrapped.displayName).toBe("withExpoGoIndicator(CameraView)");
  });
});

describe("spotting a native view that runs as a stand-in in Expo Go", () => {
  it("given a camera view marked as an Expo Go stand-in, when the screen renders, then a dotted red frame surrounds it and a red badge in white text sits on its top-left corner", () => {
    const Wrapped = withExpoGoIndicator(Stub, "CameraView");

    render(<Wrapped label="hello" />);

    const label = screen.getByText("CameraView · Expo Go");
    const badge = label.parentElement;
    const frame = badge?.parentElement;
    expect(frame).toHaveStyle({
      borderTopStyle: "dotted",
      borderTopWidth: "2px",
      borderTopColor: "rgb(255, 59, 48)",
    });
    expect(badge).toHaveStyle({
      position: "absolute",
      top: "4px",
      left: "4px",
      backgroundColor: "rgb(255, 59, 48)",
    });
    expect(label).toHaveStyle({
      color: "rgb(255, 255, 255)",
      fontSize: "10px",
      fontWeight: "600",
    });
  });
});
