import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";

import { theme } from "../../lib/theme";

/**
 * Four tabs: where to park, what you have, what you spent, and your account.
 *
 * The tab group is deliberately not gated on being signed in. `zones/nearby` is
 * public, so the map — the thing somebody installed this app for — works before
 * anybody has typed an email address. Wallet and History need an account and each
 * says so on itself, which is a smaller wall than a sign-in screen in front of
 * everything.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.colour.bg },
        headerTintColor: theme.colour.ink,
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: theme.colour.bg,
          borderTopColor: theme.colour.line,
          height: 68,
          paddingBottom: 10,
          paddingTop: 6,
        },
        tabBarActiveTintColor: theme.colour.primary,
        tabBarInactiveTintColor: theme.colour.muted,
        tabBarLabelStyle: { fontSize: 12.5, fontWeight: "600" },
        sceneStyle: { backgroundColor: theme.colour.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Map",
          headerShown: false,
          tabBarIcon: ({ color }) => <TabGlyph glyph="◎" color={color} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color }) => <TabGlyph glyph="₹" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color }) => <TabGlyph glyph="≡" color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <TabGlyph glyph="◐" color={color} />,
        }}
      />
    </Tabs>
  );
}

/** Glyphs rather than an icon package — four tabs do not justify the dependency. */
function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 21, lineHeight: 26 }}>{glyph}</Text>;
}
