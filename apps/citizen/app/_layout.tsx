import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "../lib/session";
import { theme } from "../lib/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        {/* Dark glyphs, because everything behind them is white. */}
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.colour.bg },
            headerTintColor: theme.colour.ink,
            headerTitleStyle: { fontWeight: "700" },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.colour.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="zone/[id]/index" options={{ title: "Car park" }} />
          <Stack.Screen name="zone/[id]/bays" options={{ title: "Bays" }} />
          <Stack.Screen name="parked/[plate]" options={{ title: "Your car" }} />
          <Stack.Screen name="vehicles" options={{ title: "Your vehicles" }} />
          <Stack.Screen name="passes" options={{ title: "Passes" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
