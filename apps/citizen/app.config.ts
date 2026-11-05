import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: "Smart Parking",
    slug: "kmcp-citizen",
    owner: "infps",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    scheme: "kmcpparking",
    // Light, deliberately, and not a preference: the whole app is built around
    // a map, and a map on a dark ground is unreadable in daylight.
    userInterfaceStyle: "light",
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.smartparking.citizen",
    },
    android: {
      package: "com.smartparking.citizen",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#01021d",
      },
      permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "Smart Parking uses your location to show the car parks nearest to you. It is never sent anywhere but the search for nearby bays.",
        },
      ],
      [
        "expo-splash-screen",
        {
          image: "./assets/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#01021d",
        },
      ],
    ],
    experiments: { typedRoutes: true },
    extra: {
      eas: {
        // Set once by `eas build:configure` (which cannot write into this
        // file itself, since it's a dynamic TS config rather than app.json).
        projectId: "588dd028-c896-4e79-8024-931ebf7e6725",
      },
    },
  };
};
