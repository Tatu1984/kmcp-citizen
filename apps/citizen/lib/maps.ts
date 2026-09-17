import { Platform } from "react-native";

/**
 * A geo: link the phone's own maps app will open.
 *
 * Deliberately not a Google Maps URL. `geo:` is honoured by whatever the person
 * has chosen as their maps app, and a citizen who has decided not to use Google
 * Maps should not be forced into it by a municipal parking app. The label is
 * carried as a query so the pin arrives named rather than as a bare coordinate.
 */
export function directionsUrl(lat: number, lng: number, label: string): string {
  const encoded = encodeURIComponent(label);
  return Platform.OS === "ios"
    ? `maps://?daddr=${lat},${lng}&q=${encoded}`
    : `geo:${lat},${lng}?q=${lat},${lng}(${encoded})`;
}
