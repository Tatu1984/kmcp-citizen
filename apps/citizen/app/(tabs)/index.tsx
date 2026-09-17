import * as React from "react";
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, formatPlate, type NearbyZone } from "@kmcp/api";

import { Button, Chip, Loading, Sub, Swatch } from "../../components/ui";
import { ParkMap } from "../../components/park-map";
import { availabilityColour, availabilityTone, availabilityWord } from "../../lib/availability";
import { api } from "../../lib/api";
import { KOLKATA, distanceMetres, formatDistance, useLocation, walkMinutes } from "../../lib/location";
import { useSession } from "../../lib/session";
import { rememberZones } from "../../lib/zone-cache";
import { theme } from "../../lib/theme";

/**
 * Where can I park.
 *
 * The one screen in this app that works with no account at all, because
 * `GET /zones/nearby` is the single public route on the whole API. Somebody who
 * has just installed this gets a real answer before being asked for anything.
 *
 * It has to survive two separate absences and neither is unlikely:
 *
 *  - **No location.** Declining the prompt is ordinary. The map falls back to
 *    the centre of Kolkata and says so, rather than refusing to draw.
 *  - **No signal.** An error with a retry, never an empty list presented as
 *    "there is nowhere to park".
 */
export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `watch: true` — the fix stays live as the person walks, not just at the
  // moment the screen opened, so "car parks near me" still means that five
  // minutes later.
  const location = useLocation(true, true);
  const { user } = useSession();

  const [zones, setZones] = React.useState<NearbyZone[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [firstPlate, setFirstPlate] = React.useState<string | null>(null);

  const sheet = useDraggableSheet();

  // The shortcut on the finder bar needs one plate, not the whole list — so
  // this is a light read, and a failure of it (signed out, or the route not
  // yet built) just falls back to "add your plate" rather than an error.
  React.useEffect(() => {
    if (!user) {
      setFirstPlate(null);
      return;
    }
    let cancelled = false;
    void api.me
      .vehicles()
      .then((found) => {
        if (!cancelled) setFirstPlate(found[0]?.plateNumber ?? null);
      })
      .catch(() => {
        if (!cancelled) setFirstPlate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const fix = location.status === "ready" ? location.fix : KOLKATA;
  const locating = location.status === "locating" || location.status === "idle";

  const load = React.useCallback(async (lat: number, lng: number) => {
    setError(null);
    try {
      const found = await api.zones.nearby(lat, lng);
      setZones(found);
      // Hand these to the car park screen. It cannot fetch a zone by id — that
      // route is behind zone.read — so this is where its name and hours come
      // from. See lib/zone-cache.ts.
      rememberZones(found);
    } catch (cause) {
      setZones(null);
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not load car parks. Check your connection and try again.",
      );
    }
  }, []);

  // Where `load` was last actually called from, so a live fix updating every
  // fifteen metres does not turn into a nearby-zones request every fifteen
  // metres too. The GPS watcher already throttles the fix itself; this is a
  // second, coarser throttle on top of it, because "car parks near me" does
  // not need to be re-asked more often than a person could plausibly have
  // walked into range of a different one.
  const lastQueried = React.useRef<{ lat: number; lng: number } | null>(null);
  const REQUERY_METRES = 200;

  // Wait for the location attempt to settle before asking — a first request
  // from the centre of the city followed a second later by one from where the
  // person actually is makes the list jump under their thumb.
  React.useEffect(() => {
    if (locating) return;
    const last = lastQueried.current;
    if (last && distanceMetres(last, fix) < REQUERY_METRES) return;
    lastQueried.current = { lat: fix.lat, lng: fix.lng };
    void load(fix.lat, fix.lng);
  }, [locating, fix.lat, fix.lng, load]);

  /**
   * Filtering, not searching.
   *
   * There is no place-search endpoint, so this narrows what has already been
   * fetched by name, code, street and ward. That is a genuine search of the car
   * parks around you; it is not a search of Kolkata, and the empty state says
   * which of the two just happened.
   */
  const filtered = React.useMemo(() => {
    if (!zones) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return zones;
    return zones.filter((zone) =>
      [zone.name, zone.code, zone.street?.name, zone.ward?.name]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle)),
    );
  }, [zones, query]);

  const selected = filtered?.find((zone) => zone.id === selectedId) ?? null;

  return (
    <View style={styles.screen}>
      <View style={StyleSheet.absoluteFill}>
        <ParkMap
          centre={fix}
          zones={filtered ?? []}
          selectedId={selectedId}
          onSelect={setSelectedId}
          followsUser={location.status === "ready"}
        />
      </View>

      {/* ------------------------------------------------------- overlays */}
      <View style={[styles.top, { paddingTop: insets.top + theme.space(1) }]}>
        <View style={styles.search}>
          <Text style={styles.searchGlyph}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a place or a street"
            placeholderTextColor={theme.colour.muted}
            style={styles.searchInput}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        {/* The way into "your car is parked". A citizen never starts a session
            — an attendant does — so the only handle on it is a plate. */}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            firstPlate ? router.push(`/parked/${firstPlate}`) : router.push("/vehicles")
          }
          style={({ pressed }) => [styles.finder, pressed && styles.finderPressed]}
        >
          <Text style={styles.finderGlyph}>⌂</Text>
          <Text style={styles.finderText} numberOfLines={1}>
            {firstPlate
              ? `Find my car · ${formatPlate(firstPlate)}`
              : "Add your number plate to find your car"}
          </Text>
          <Text style={styles.finderChevron}>›</Text>
        </Pressable>
      </View>

      {/* ---------------------------------------------------- bottom sheet */}
      <Animated.View style={[styles.sheet, { height: sheet.height }]}>
        <View style={styles.handle} {...sheet.panHandlers}>
          <View style={styles.grabber} />

          <View style={styles.legend}>
            {(["AVAILABLE", "LIMITED", "FULL"] as const).map((state) => (
              <View key={state} style={styles.legendItem}>
                <Swatch colour={availabilityColour(state)} />
                <Text style={styles.legendLabel}>{availabilityWord[state]}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.sheetBody, { paddingBottom: insets.bottom + theme.space(1) }]}>
          {selected ? (
            <SelectedZone
              zone={selected}
              onOpen={() => router.push(`/zone/${selected.id}`)}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <ZoneList
              zones={filtered}
              error={error}
              filtering={query.trim().length > 0}
              locating={locating}
              denied={location.status === "denied"}
              onRetry={() => void load(fix.lat, fix.lng)}
              onSelect={setSelectedId}
            />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

/** The selected car park, as the sheet in the design draws it. */
function SelectedZone({
  zone,
  onOpen,
  onBack,
}: {
  zone: NearbyZone;
  onOpen: () => void;
  /** Clears the selection — the way back to every nearby car park, not just this one. */
  onBack: () => void;
}) {
  const walk = walkMinutes(zone.distanceMetres);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to all car parks"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
      >
        <Text style={styles.backGlyph}>‹</Text>
        <Text style={styles.backLabel}>All car parks</Text>
      </Pressable>

      <View style={styles.selectedHead}>
        <View style={styles.selectedText}>
          <Text style={styles.selectedName}>{zone.name}</Text>
          <Text style={styles.selectedMeta}>
            {walk === null ? formatDistance(zone.distanceMetres) : `${walk} min walk`} · open{" "}
            {zone.openTime}–{zone.closeTime}
          </Text>
        </View>
        <Chip
          tone={availabilityTone(zone.availability)}
          label={`${zone.available} of ${zone.capacity} free`}
        />
      </View>
      <Button label="See this car park" size="medium" onPress={onOpen} />
    </>
  );
}

/** Everything nearby, when nothing is selected — and the whole screen when there is no map. */
function ZoneList({
  zones,
  error,
  filtering,
  locating,
  denied,
  onRetry,
  onSelect,
}: {
  zones: NearbyZone[] | null;
  error: string | null;
  filtering: boolean;
  locating: boolean;
  denied: boolean;
  onRetry: () => void;
  onSelect: (id: string) => void;
}) {
  if (locating) return <Loading label="Finding where you are" />;

  if (error) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>Could not load car parks</Text>
        <Sub style={styles.stateBody}>{error}</Sub>
        <Button label="Try again" variant="ghost" size="medium" onPress={onRetry} />
      </View>
    );
  }

  if (!zones) return <Loading />;

  if (zones.length === 0) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateTitle}>
          {filtering ? "Nothing here matches" : "No car parks within two kilometres"}
        </Text>
        <Sub style={styles.stateBody}>
          {filtering
            ? "This searches the car parks around you, not the whole city. Clear the search to see them all."
            : "Only open, government car parks are shown. There may be others further out."}
        </Sub>
      </View>
    );
  }

  return (
    <>
      {denied ? (
        <Text style={styles.denied}>
          Showing the centre of Kolkata — location is switched off for this app.
        </Text>
      ) : null}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {zones.map((zone) => (
          <Pressable
            key={zone.id}
            accessibilityRole="button"
            accessibilityLabel={`${zone.name}, ${zone.available} of ${zone.capacity} free, ${formatDistance(zone.distanceMetres)}`}
            onPress={() => onSelect(zone.id)}
            style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
          >
            <View style={styles.listText}>
              <Text style={styles.listName} numberOfLines={1}>
                {zone.name}
              </Text>
              <Text style={styles.listMeta} numberOfLines={1}>
                {formatDistance(zone.distanceMetres)} · {zone.openTime}–{zone.closeTime}
              </Text>
            </View>
            <Chip
              tone={availabilityTone(zone.availability)}
              label={
                zone.availability === "FULL" ? "Full" : `${zone.available} free`
              }
            />
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

/** Fraction of the screen the sheet occupies at each resting point. */
const SHEET_PEEK = 0.15;
const SHEET_DEFAULT = 0.42;
const SHEET_FULL = 0.86;

/**
 * The drag itself.
 *
 * Built on `Animated` + `PanResponder` — both ship with React Native, so a
 * single draggable sheet does not need `react-native-gesture-handler` and
 * `react-native-reanimated` pulled in just for it, the same call this app
 * already makes about icon packages and other small dependencies.
 *
 * The sheet's height is the animated value, not its position — simpler to
 * reason about than translating a fixed-height panel, and it means the
 * content inside never has to know it is being dragged at all.
 */
function useDraggableSheet() {
  const screenHeight = Dimensions.get("window").height;
  const snaps = React.useMemo(
    () => ({
      peek: Math.round(screenHeight * SHEET_PEEK),
      default: Math.round(screenHeight * SHEET_DEFAULT),
      full: Math.round(screenHeight * SHEET_FULL),
    }),
    [screenHeight],
  );

  const height = React.useRef(new Animated.Value(snaps.default)).current;
  // The value read at the start of a drag, so each move computes from a fixed
  // point rather than compounding against whatever the listener last saw —
  // `Animated.Value` has no synchronous getter, only `stopAnimation`'s callback.
  const startHeight = React.useRef(snaps.default);

  const snapTo = React.useCallback(
    (target: number) => {
      Animated.spring(height, {
        toValue: target,
        useNativeDriver: false,
        bounciness: 4,
        speed: 14,
      }).start();
    },
    [height],
  );

  const panHandlers = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => {
          height.stopAnimation((value) => {
            startHeight.current = value;
          });
        },
        onPanResponderMove: (_evt, gesture) => {
          const next = clamp(startHeight.current - gesture.dy, snaps.peek, snaps.full);
          height.setValue(next);
        },
        onPanResponderRelease: (_evt, gesture) => {
          const released = clamp(startHeight.current - gesture.dy, snaps.peek, snaps.full);
          const nearest = [snaps.peek, snaps.default, snaps.full].reduce((closest, point) =>
            Math.abs(point - released) < Math.abs(closest - released) ? point : closest,
          );
          snapTo(nearest);
        },
      }).panHandlers,
    [height, snapTo, snaps],
  );

  return { height, panHandlers };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colour.mapGround },

  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    padding: theme.space(1.5),
    gap: theme.space(1),
    zIndex: 2,
  },
  search: {
    minHeight: theme.minTouch,
    backgroundColor: theme.colour.bg,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(1.25),
    paddingHorizontal: theme.space(1.75),
    shadowColor: "#0E1726",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  searchGlyph: { fontSize: 17, color: theme.colour.muted },
  searchInput: { flex: 1, fontSize: 15, color: theme.colour.ink, paddingVertical: theme.space(1) },

  finder: {
    minHeight: theme.minTouch,
    backgroundColor: theme.colour.ink,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(1.25),
    paddingHorizontal: theme.space(1.75),
  },
  finderPressed: { opacity: 0.85 },
  finderGlyph: { fontSize: 16, color: "#FFFFFF" },
  finderText: { flex: 1, fontSize: 14.5, fontWeight: "600", color: "#FFFFFF" },
  finderChevron: { fontSize: 20, color: "#FFFFFF", opacity: 0.7 },

  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    backgroundColor: theme.colour.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
    shadowColor: "#0E1726",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },

  // The draggable region — kept separate from the scrollable content below it
  // so a drag started here can never be mistaken for a list scroll, and a
  // list scroll can never accidentally resize the sheet.
  handle: {
    paddingHorizontal: theme.space(2),
    paddingTop: theme.space(1.5),
    paddingBottom: theme.space(1),
    gap: theme.space(1.25),
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colour.line,
    alignSelf: "center",
  },

  sheetBody: {
    flex: 1,
    paddingHorizontal: theme.space(2),
    gap: theme.space(1.25),
  },

  legend: { flexDirection: "row", gap: theme.space(1.5) },
  legendItem: { flexDirection: "row", alignItems: "center", gap: theme.space(0.5) },
  legendLabel: { fontSize: 11.5, fontWeight: "600", color: theme.colour.muted },

  back: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 2,
    marginBottom: theme.space(0.25),
    marginLeft: -theme.space(0.5),
    paddingVertical: theme.space(0.5),
    paddingHorizontal: theme.space(0.5),
    borderRadius: theme.radius.pill,
  },
  backPressed: { backgroundColor: theme.colour.raise },
  backGlyph: { fontSize: 20, fontWeight: "700", color: theme.colour.primary, lineHeight: 20 },
  backLabel: { fontSize: 14.5, fontWeight: "600", color: theme.colour.primary },

  selectedHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.space(1.25),
  },
  selectedText: { flex: 1, gap: 2 },
  selectedName: { ...theme.text.title, color: theme.colour.ink },
  selectedMeta: { fontSize: 13.5, color: theme.colour.muted },

  denied: { fontSize: 12.5, color: theme.colour.muted },
  list: { flex: 1 },
  listContent: { paddingBottom: theme.space(1) },
  listRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space(1.5),
    paddingVertical: theme.space(1),
    borderBottomWidth: 1,
    borderBottomColor: theme.colour.line,
  },
  listRowPressed: { backgroundColor: theme.colour.raise },
  listText: { flex: 1, gap: 2 },
  listName: { fontSize: 15.5, fontWeight: "700", color: theme.colour.ink },
  listMeta: { fontSize: 13, color: theme.colour.muted },

  state: { paddingVertical: theme.space(2), gap: theme.space(1) },
  stateTitle: { ...theme.text.title, color: theme.colour.ink },
  stateBody: { lineHeight: 20 },
});
