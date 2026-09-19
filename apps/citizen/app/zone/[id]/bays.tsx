import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { ApiError, gapOf, type Slot, type SlotStatus } from "@kmcp/api";

import { Card, Label, Loading, Screen, Sub, Swatch, Unavailable } from "../../../components/ui";
import { Bay } from "../../../components/availability";
import { vehicleTypeWord } from "../../../lib/availability";
import { api } from "../../../lib/api";
import { theme } from "../../../lib/theme";
import { recallZone } from "../../../lib/zone-cache";

/**
 * Every bay in one car park, as a grid.
 *
 * A grid rather than a plan, because a plan would be a fiction. The `Slot`
 * model holds an id, a zone, a code, a type and a status — no floor, no level,
 * no coordinates — so there is nothing to lay anything out against. Sorting by
 * code and filling left to right puts A01 next to A02, which is the only
 * spatial fact that actually exists, and the codes are the ones painted on the
 * ground so a driver can match what they see.
 *
 * This is not a booking screen. Nothing here is reservable in this release; it
 * tells somebody where the space is before they turn in off the road, which is
 * most of the value and none of the operational risk.
 */
export default function Bays() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const zone = id ? recallZone(id) : null;

  const [slots, setSlots] = React.useState<Slot[] | null>(null);
  const [error, setError] = React.useState<{ title: string; body: string } | null>(null);

  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;

    void api.slots
      .list(id)
      .then((found) => {
        if (cancelled) return;
        // Sorted here rather than trusted from the server: the codes are the
        // layout, and a grid that jumps from B12 to A03 is unreadable.
        setSlots([...found].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // A refusal from a server that answered is worth saying differently
        // from a dead connection: only one of the two is fixed by waiting.
        const gap = gapOf(cause);
        setError(
          gap
            ? {
                title: "The bays could not be read",
                body: "This car park's bays could not be read for this account. Signing in again usually fixes it.",
              }
            : {
                title: "Could not load the bays",
                body:
                  cause instanceof ApiError
                    ? cause.message
                    : "Check your connection and try again.",
              },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const counts = React.useMemo(() => {
    const tally: Record<SlotStatus, number> = {
      AVAILABLE: 0,
      OCCUPIED: 0,
      RESERVED: 0,
      OUT_OF_SERVICE: 0,
    };
    for (const slot of slots ?? []) tally[slot.status] += 1;
    return tally;
  }, [slots]);

  /**
   * The first free bay, named.
   *
   * The mockup calls this out under the grid, and it earns its place: a grid of
   * forty-eight cells is a picture, and "A07 is free" is an instruction. The
   * type comes with it because a free two-wheeler bay is no use to a car.
   */
  const firstFree = slots?.find((slot) => slot.status === "AVAILABLE") ?? null;

  return (
    <Screen>
      <Stack.Screen options={{ title: zone ? `${zone.name} · Bays` : "Bays" }} />

      <View style={styles.legend}>
        <LegendItem colour={theme.colour.good} label="Free" count={slots ? counts.AVAILABLE : null} />
        <LegendItem
          colour={theme.colour.occupied}
          label="Occupied"
          count={slots ? counts.OCCUPIED + counts.OUT_OF_SERVICE : null}
        />
        <LegendItem colour={theme.colour.warn} label="Booked" count={slots ? counts.RESERVED : null} />
      </View>

      {error ? (
        <Unavailable title={error.title} body={error.body} />
      ) : !slots ? (
        <Loading label="Loading the bays" />
      ) : slots.length === 0 ? (
        <Unavailable
          title="No bays are recorded for this car park"
          body="Its capacity is priced and enforced, but individual bays have not been surveyed and numbered yet. The car park screen still shows how many spaces are free."
        />
      ) : (
        <>
          <View style={styles.grid}>
            {slots.map((slot) => (
              <View key={slot.id} style={styles.cell}>
                <Bay code={slot.code} status={slot.status} />
              </View>
            ))}
          </View>

          {firstFree ? (
            <Card raise>
              <Label>{`${firstFree.code} · ${vehicleTypeWord[firstFree.type] ?? firstFree.type}`}</Label>
              <Sub style={styles.body}>
                Free now. Bays are not reservable in this release — this shows you where the
                space is, so you know before you turn in off the road.
              </Sub>
            </Card>
          ) : (
            <Card raise>
              <Label>Nothing free right now</Label>
              <Sub style={styles.body}>
                Every recorded bay is taken or booked. Bay status changes as attendants start and
                end sessions, so it is worth checking again on the way.
              </Sub>
            </Card>
          )}

          {counts.OUT_OF_SERVICE > 0 ? (
            <Sub style={styles.note}>
              {counts.OUT_OF_SERVICE} {counts.OUT_OF_SERVICE === 1 ? "bay is" : "bays are"} out of
              service and shown as occupied — you cannot park there either way.
            </Sub>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function LegendItem({
  colour,
  label,
  count,
}: {
  colour: string;
  label: string;
  count: number | null;
}) {
  return (
    <View style={styles.legendItem}>
      <Swatch colour={colour} />
      <Text style={styles.legendLabel}>{label}</Text>
      {count === null ? null : <Text style={styles.legendCount}>{count}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", flexWrap: "wrap", gap: theme.space(1.75) },
  legendItem: { flexDirection: "row", alignItems: "center", gap: theme.space(0.5) },
  legendLabel: { fontSize: 12.5, fontWeight: "600", color: theme.colour.muted },
  legendCount: {
    fontSize: 12.5,
    fontWeight: "700",
    color: theme.colour.ink,
    fontVariant: ["tabular-nums"],
  },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  // Six across, matching the design. A shade under a sixth each, so that six
  // cells and the five gaps between them fit on one row rather than the last
  // one wrapping alone.
  cell: { flexBasis: "15.2%", flexGrow: 0 },

  body: { fontSize: 13.5, lineHeight: 19 },
  note: { fontSize: 12.5, lineHeight: 18 },
});
