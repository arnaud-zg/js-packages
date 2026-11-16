import { StyleSheet } from "react-native";

export const expoGoIndicatorStyles = StyleSheet.create({
  container: {
    flex: 1,
    borderWidth: 2,
    borderStyle: "dotted",
    borderColor: "#FF3B30",
  },
  badge: {
    position: "absolute",
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#FF3B30",
  },
  label: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "600",
  },
});
