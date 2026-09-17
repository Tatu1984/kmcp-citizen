import * as React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ApiError,
  MISSING,
  formatMoney,
  gapOf,
  slotsWith,
  type CachedTariff,
  type Slot,
  type SlotSummary,
  type SlotType,
} from "@kmcp/api";

import {
  Banner,
  Button,
  Card,
  Chip,
  Loading,
  Row,
  Screen,
  Sub,
  Unavailable,
} from "../../../components/ui";
import { CapacityBar, CapacityKey, TypeLine, type Segment } from "../../../components/availability";
import { availabilityTone, availabilityWord, vehicleTypeWord } from "../../../lib/availability";
import { api } from "../../../lib/api";
import { directionsUrl } from "../../../lib/maps";
import { theme } from "../../../lib/theme";
import { recallZone, toZoneView, type ZoneView } from "../../../lib/zone-cache";

/**
 * One car park.
 *
 * Assembled from three sources with three separate failure modes, and built so
 * that losing any of them costs only the part it feeds:
 *
 *  - the **zone** itself — name, hours, capacity, live availability — which the
 *    map already fetched from the one public endpoint;
 *  - the **bay records**, which are what split "not free" into occupied and
 *    booked, and what say which kind of bay is free;
 *  - the **rate card**, which is what the fare rows are.
 *
 * The last two are guarded by permissions a citizen account does not hold, so
 * today they answer 403 and their sections say so by name. That is deliberate:
 * a driver told "we cannot show you the price" will ask somebody; a driver
 * shown ₹0 will park and then argue with an attendant.
 */
export default function ZoneDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [zone, setZone] = React.useState<ZoneView | null>(() => (id ? recallZone(id) : null));
  const [summary, setSummary] = React.useState<SlotSummary | null>(null);
  const [slots, setSlots] = React.useState<Slot[] | null>(null);
  const [tariff, setTariff] = React.useState<CachedTariff | null>(null);
  const [tariffLoading, setTariffLoading] = React.useState(true);
  const [loading, setLoading] = React.useState(true);
  const [zoneError, setZoneError] = React.useState<string | null>(null);
  const [favourited, setFavourited] = React.useState(false);
  const [favouriteBusy, setFavouriteBusy] = React.useState(false);
  const [favouriteNote, setFavouriteNote] = React.useState<string | null>(null);

  /**
   * The zone itself, only when the map did not already hand it over.
   *
   * Kept in its own effect and keyed on the id alone, so that setting `zone`
   * from the response cannot re-trigger the fetch that produced it.
   */
  React.useEffect(() => {
    if (!id || recallZone(id)) return;
    let cancelled = false;

    void api.zones
      .byId(id)
      .then((found) => {
        if (!cancelled) setZone(toZoneView(found));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setZoneError(
          gapOf(cause) === "NOT_PERMITTED"
            ? MISSING.zoneDetail!.because
            : "Could not load this car park.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * The bay records. Settled rather than awaited together — the summary and the
   * list answer different questions and one being shut must not blank the
   * other, nor the zone figures above them.
   */
  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;

    void (async () => {
      const [summaryResult, slotsResult] = await Promise.allSettled([
        api.slots.summary(id),
        api.slots.list(id),
      ]);
      if (cancelled) return;

      if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
      if (slotsResult.status === "fulfilled") setSlots(slotsResult.value);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * The rate card, for the vehicle type most people here are asking about.
   *
   * A car park allows several types and each has its own tariff, so there is no
   * single "the price". This asks for CAR when the zone allows it and the first
   * allowed type otherwise, and the card names the type it is quoting — a
   * two-wheeler rider shown a car's rate is a worse answer than no rate at all.
   */
  const quotedType: SlotType = React.useMemo(() => {
    const allowed = zone?.allowedVehicleTypeIds ?? [];
    if (allowed.includes("CAR")) return "CAR";
    return allowed[0] ?? "CAR";
  }, [zone]);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setTariffLoading(true);
    void api.tariffs
      .applicable(id, quotedType)
      .then((found) => {
        if (!cancelled) setTariff(found);
      })
      .catch(() => {
        // Left null. The fare card renders its own explanation rather than
        // putting an error banner over the whole screen — the availability
        // figures above it are still worth reading.
      })
      .finally(() => {
        if (!cancelled) setTariffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, quotedType]);

  /**
   * Whether this zone is already saved.
   *
   * Left unfavourited on failure rather than blocking the rest of the screen —
   * a citizen should still see a car park's details even when the favourites
   * door happens to be shut.
   */
  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void api.me
      .favourites()
      .then((found) => {
        if (!cancelled) setFavourited(found.some((f) => f.zoneId === id));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggleFavourite = React.useCallback(async () => {
    if (!id || favouriteBusy) return;
    setFavouriteNote(null);
    setFavouriteBusy(true);
    const was = favourited;
    try {
      if (was) {
        await api.me.removeFavourite(id);
        setFavourited(false);
      } else {
        await api.me.addFavourite(id);
        setFavourited(true);
      }
    } catch (cause) {
      setFavouriteNote(
        gapOf(cause)
          ? `${MISSING.favourites!.because}\n\nNeeds: ${MISSING.favourites!.route}`
          : cause instanceof ApiError
            ? cause.message
            : `That car park could not be ${was ? "unsaved" : "saved"}.`,
      );
    } finally {
      setFavouriteBusy(false);
    }
  }, [id, favourited, favouriteBusy]);

  /** Free and total per vehicle type. Only the bay list can answer this. */
  const byType = React.useMemo(() => {
    if (!slots) return null;
    const totals = new Map<SlotType, { free: number; total: number }>();
    for (const slot of slots) {
      const entry = totals.get(slot.type) ?? { free: 0, total: 0 };
      entry.total += 1;
      if (slot.status === "AVAILABLE") entry.free += 1;
      totals.set(slot.type, entry);
    }
    return [...totals.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [slots]);

  if (loading && !zone) return <Loading label="Loading this car park" />;

  if (!zone) {
    return (
      <Screen>
        <Unavailable
          title="This car park cannot be opened on its own"
          body={`${zoneError ?? MISSING.zoneDetail!.because}\n\nOpen it from the map instead. That list comes from the one endpoint a citizen may call.`}
        />
        <Button label="Back to the map" variant="ghost" onPress={() => router.replace("/(tabs)")} />
      </Screen>
    );
  }

  /* ---------------------------------------------------------- the figures */

  const bayFree = slotsWith(summary, "AVAILABLE");
  const bayBooked = slotsWith(summary, "RESERVED");
  // OUT_OF_SERVICE is folded into occupied. To somebody looking for somewhere
  // to leave a car, a coned-off bay and a bay with a car in it are the same
  // answer; the distinction belongs to whoever maintains the car park.
  const bayOccupied = slotsWith(summary, "OCCUPIED") + slotsWith(summary, "OUT_OF_SERVICE");
  const mapped = summary?.mappedAgainstCapacity.mapped ?? 0;

  /**
   * Two ways of counting, which can legitimately disagree.
   *
   * `zone.available` comes from live sessions against the priced capacity; the
   * bay counts come from painted, recorded bays. A car park can be running more
   * sessions than it has bays on record. The headline uses the zone figure —
   * it is the one the server itself calls availability — and the bar below uses
   * the bays where there are any, because "booked" exists nowhere else.
   */
  const segments: Segment[] = summary
    ? [
        { key: "free", label: "Free", count: bayFree, colour: theme.colour.good },
        { key: "busy", label: "Occupied", count: bayOccupied, colour: theme.colour.occupied },
        { key: "booked", label: "Booked", count: bayBooked, colour: theme.colour.warn },
      ]
    : [
        { key: "free", label: "Free", count: zone.available, colour: theme.colour.good },
        { key: "busy", label: "Occupied", count: zone.occupied, colour: theme.colour.occupied },
      ];

  return (
    <Screen>
      <Stack.Screen options={{ title: zone.name }} />

      {/* ------------------------------------------------------- headline */}
      <View style={styles.hero}>
        <View>
          <Text style={styles.heroCount}>{zone.available}</Text>
          <Sub style={styles.heroCaption}>bays free of {zone.capacity}</Sub>
        </View>
        <Chip
          tone={availabilityTone(zone.availability)}
          label={availabilityWord[zone.availability]}
        />
      </View>

      {/* ------------------------------------------------- capacity split */}
      <View style={styles.capacity}>
        <CapacityBar segments={segments} />
        <CapacityKey segments={segments} />
        {!summary ? (
          <Sub style={styles.note}>
            Free and occupied come from live sessions. Booked bays are counted separately and are
            not public yet — needs {MISSING.slotSummary!.route}.
          </Sub>
        ) : mapped < zone.capacity ? (
          // Said out loud rather than quietly totalled to the wrong number: a
          // car park priced for 48 vehicles with 30 bays recorded has a bar
          // that does not add up to its capacity, and that is correct.
          <Sub style={styles.note}>
            {mapped} of {zone.capacity} bays are individually recorded. The rest are counted by
            capacity alone.
          </Sub>
        ) : null}
      </View>

      {/* ---------------------------------------------- breakdown by type */}
      {loading ? (
        <Loading label="Checking bay types" />
      ) : byType && byType.length > 0 ? (
        <Card style={styles.tight}>
          {byType.map(([type, counts], index) => (
            <TypeLine
              key={type}
              name={vehicleTypeWord[type] ?? type}
              free={counts.free}
              total={counts.total}
              last={index === byType.length - 1}
            />
          ))}
        </Card>
      ) : (
        <Unavailable
          title="Which kind of bay is free"
          body={`${MISSING.slotList!.because}\n\nNeeds: ${MISSING.slotList!.route}`}
        />
      )}

      {/* ------------------------------------------------------- the fare */}
      <Card raise style={styles.tight}>
        {tariff ? (
          <>
            <Row label={`First ${describeMinutes(tariff.baseMinutes)}`} value={formatMoney(tariff.baseAmount)} />
            <Row
              label={`Then, each ${describeMinutes(tariff.incrementMinutes)}`}
              value={formatMoney(tariff.incrementAmount)}
            />
            {tariff.dailyCapAmount ? (
              <Row label="Most you will pay in a day" value={formatMoney(tariff.dailyCapAmount)} />
            ) : null}
            <Row label="Open" value={`${zone.openTime} – ${zone.closeTime}`} last />
          </>
        ) : (
          <Row label="Open" value={`${zone.openTime} – ${zone.closeTime}`} last />
        )}
      </Card>

      {tariffLoading ? (
        <Loading label="Checking the rate card" />
      ) : tariff ? (
        <Sub style={styles.note}>
          Rates for {(vehicleTypeWord[quotedType] ?? quotedType).toLowerCase()}. The server prices
          every session — this is what it will charge, not a figure worked out on this phone.
        </Sub>
      ) : (
        <Unavailable
          title="What it costs is not public yet"
          body={`${MISSING.tariff!.because}\n\nNeeds: ${MISSING.tariff!.route}`}
        />
      )}

      {/* --------------------------------------------------------- actions */}
      <Button
        label="See the bays"
        variant="ghost"
        size="medium"
        onPress={() => router.push(`/zone/${zone.id}/bays`)}
      />

      <View style={styles.actions}>
        <Button
          label="Directions"
          size="medium"
          onPress={() => {
            void Linking.openURL(directionsUrl(zone.centerLat, zone.centerLng, zone.name));
          }}
          style={styles.grow}
        />
        <Button
          label={favourited ? "★" : "☆"}
          variant={favourited ? "dark" : "ghost"}
          size="medium"
          busy={favouriteBusy}
          onPress={() => void toggleFavourite()}
          style={styles.star}
        />
      </View>

      {favouriteNote ? (
        <Banner tone="crit" title="That did not go through" body={favouriteNote} />
      ) : null}

      <Sub style={styles.footnote}>
        Bays cannot be reserved in this release. What is here tells you where the space is before
        you turn in off the road.
      </Sub>
    </Screen>
  );
}

/**
 * "2 hours", "45 minutes" — a rate card read the way somebody says it.
 *
 * Anything that is not a whole number of hours stays in minutes rather than
 * becoming "1.5 hours", because a tariff of 90 minutes is a real thing and
 * rounding it for the sake of the sentence would misstate what is charged.
 */
function describeMinutes(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? "hour" : `${hours} hours`;
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: theme.space(1.5),
  },
  heroCount: {
    fontSize: 44,
    fontWeight: "700",
    letterSpacing: -1.5,
    lineHeight: 48,
    color: theme.colour.ink,
    fontVariant: ["tabular-nums"],
  },
  heroCaption: { marginTop: 3 },

  capacity: { gap: theme.space(1) },
  note: { fontSize: 12.5, lineHeight: 18 },

  tight: { paddingVertical: theme.space(0.5), gap: 0 },

  actions: { flexDirection: "row", gap: theme.space(1.125) },
  grow: { flex: 1 },
  star: { width: 56, flexGrow: 0 },

  footnote: { fontSize: 13, lineHeight: 19, marginTop: theme.space(0.5) },
});
