import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: "KMCP Parking",
    slug: "kmcp-citizen",
    owner: "infps",
    version: "1.0.0",
    orientation: "portrait",
    scheme: "kmcpparking",
    // Light, deliberately, and not a preference: the whole app is built around
    // a map, and a map on a dark ground is unreadable in daylight.
    userInterfaceStyle: "light",
    assetBundlePatterns: ["**/*"],
    ios: {
      supportsTablet: false,
      bundleIdentifier: "in.gov.kmc.parking.citizen",
    },
    android: {
      package: "in.gov.kmc.parking.citizen",
      permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "CAMERA"],
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "KMCP uses your location to show the car parks nearest to you. It is never sent anywhere but the search for nearby bays.",
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "KMCP uses the camera to read the parking code an attendant shows you. Nothing is photographed, recorded or sent — the picture is read for a code and discarded.",
          // No microphone, and no audio permission on Android with it. This
          // app never records; asking for a microphone to scan a QR code is
          // the kind of request that gets an app refused outright.
          recordAudioAndroid: false,
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
