import type { ConfigContext, ExpoConfig } from "expo/config";
import { withAndroidManifest, type ConfigPlugin } from "expo/config-plugins";

/**
 * Hardware the app can do without, declared as optional.
 *
 * Android infers these as *required* — screen.portrait from the portrait lock,
 * wifi from a library's Wi-Fi state permission — and Play then hides the app
 * from devices without them (some tablets, Chromebooks, mobile-data-only
 * phones). The app needs neither: it locks to portrait where it can and talks
 * to the server over any connection.
 */
const OPTIONAL_FEATURES = ["android.hardware.screen.portrait", "android.hardware.wifi"];

const withOptionalFeatures: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest as typeof mod.modResults.manifest & {
      "uses-feature"?: { $: Record<string, string> }[];
    };
    const features = (manifest["uses-feature"] ??= []);
    for (const name of OPTIONAL_FEATURES) {
      const existing = features.find((f) => f.$["android:name"] === name);
      if (existing) existing.$["android:required"] = "false";
      else features.push({ $: { "android:name": name, "android:required": "false" } });
    }
    return mod;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  return withOptionalFeatures({
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
      infoPlist: {
        // HTTPS only, nothing else: spares App Store Connect's export-
        // compliance question on every upload.
        ITSAppUsesNonExemptEncryption: false,
      },
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
      "expo-status-bar",
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
  });
};
