import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { expoGoIndicatorStyles as styles } from "./ExpoGoIndicator.styles";

type ExpoGoIndicatorProps = {
  name: string;
  children: ReactNode;
};

export const ExpoGoIndicator = ({ name, children }: ExpoGoIndicatorProps) => (
  <View style={styles.container}>
    {children}
    <View style={styles.badge} pointerEvents="none">
      <Text style={styles.label} numberOfLines={1}>
        {name} · Expo Go
      </Text>
    </View>
  </View>
);
