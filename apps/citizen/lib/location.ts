import * as React from "react";
import * as Location from "expo-location";

// Re-exported so a screen can decide "have I moved far enough to bother
// re-fetching" without this file and the caller each importing their own copy
// of the same haversine formula.
export { distanceMetres } from "@kmcp/api";

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
}

export type LocationState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; fix: Fix }
  | { status: "denied" }
  | { status: "failed"; reason: string };

/**
 * The centre of Kolkata, used when we do not know where the phone is.
 *
 * Refusing to show a map until permission is granted would be the wrong trade:
 * somebody who has just declined a location prompt still wants to see the car
 * parks, and the Esplanade is a defensible guess for a city parking app. The
 * map says plainly that it is showing the city centre rather than the user.
 */
export const KOLKATA: Fix = { lat: 22.5726, lng: 88.3639, accuracy: null };

/**
 * Where the phone is.
 *
 * Balanced accuracy rather than the best available. This is used to sort a list
 * of car parks by distance and to centre a map, and neither needs metres — the
 * high-accuracy mode costs seconds and battery for a precision nothing here
 * spends.
 *
 * A denial is a first-class state, not an error. It is a perfectly reasonable
 * thing for somebody to do, and every screen that uses this has to keep working
 * afterwards.
 *
 * `watch` turns this from a single fix into a live one: once permission is
 * granted, a subscription keeps `fix` current as the phone moves, throttled to
 * at most once every five seconds or fifteen metres — enough to notice "I have
 * walked to a different block", not so much that it drains the battery or
 * re-renders the map on every step. The blue dot on the map itself already
 * moves live regardless (that is `MapView`'s own `showsUserLocation`, driven
 * natively) — this is what lets the *app* — the nearby-zones query, the "how
 * far away" figures — notice the same thing.
 */
export function useLocation(
  auto = true,
  watch = false,
): LocationState & { locate: () => Promise<Fix | null> } {
  const [state, setState] = React.useState<LocationState>({ status: "idle" });
  const subscription = React.useRef<Location.LocationSubscription | null>(null);

  const stopWatching = React.useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
  }, []);

  const startWatching = React.useCallback(async () => {
    stopWatching();
    subscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 15,
      },
      (position) => {
        setState({
          status: "ready",
          fix: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy ?? null,
          },
        });
      },
    );
  }, [stopWatching]);

  const locate = React.useCallback(async (): Promise<Fix | null> => {
    setState({ status: "locating" });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setState({ status: "denied" });
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const fix: Fix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy ?? null,
      };
      setState({ status: "ready", fix });

      // A single fix answered "where am I right now"; a live one keeps that
      // answer true. Started here, once, rather than from its own effect, so
      // a watch never starts ahead of permission actually being granted.
      if (watch) void startWatching();

      return fix;
    } catch (error) {
      setState({
        status: "failed",
        reason: error instanceof Error ? error.message : "Could not get a position.",
      });
      return null;
    }
  }, [watch, startWatching]);

  React.useEffect(() => {
    if (auto) void locate();
    return stopWatching;
    // Deliberately only on mount — `locate` is stable per `watch`'s own
    // identity already, and re-running this because `locate` was recreated
    // would restart the whole permission dance on an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return { ...state, locate };
}

/** How far away a car park is, in the words a person walking would use. */
export function formatDistance(metres: number | null | undefined): string {
  if (metres === null || metres === undefined) return "—";
  if (metres < 950) return `${Math.round(metres / 10) * 10} m away`;
  return `${(metres / 1000).toFixed(1)} km away`;
}

/**
 * Roughly how long it takes to walk that far.
 *
 * Straight-line distance at 80 metres a minute, rounded up, and never less than
 * a minute. It is an estimate and reads as one — nothing here knows about
 * crossings, one-way streets or the Maidan.
 */
export function walkMinutes(metres: number | null | undefined): number | null {
  if (metres === null || metres === undefined) return null;
  return Math.max(1, Math.ceil(metres / 80));
}
