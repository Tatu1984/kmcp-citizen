import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ApiError, formatPlate, gapOf, normalisePlate, type MyVehicle } from "@kmcp/api";

import { Banner, Button, Card, Field, Label, Loading, Plate, Screen, Sub } from "../components/ui";
import { ClaimSession } from "../components/claim-session";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { theme } from "../lib/theme";

/**
 * The number plates this person says are theirs.
 *
 * A citizen never starts a parking session — an attendant does, at the kerb —
 * so a plate is the usual handle the app has on "my car". Registering one is
 * what makes the "find my car" path work by itself, for every session on that
 * car from now on.
 *
 * Which is why the session code lives at the bottom of this screen too. This is
 * where the map sends somebody who has no plate registered, and some of them
 * are standing at a car that is parked *right now* — asking them to type a
 * plate correctly before they can see their own bay is a worse deal than
 * letting them read the code off the ticket. A claim takes ownership of the
 * plate as well, so the two doors lead to the same place.
 */
export default function Vehicles() {
  const router = useRouter();
  const { user } = useSession();

  const [vehicles, setVehicles] = React.useState<MyVehicle[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [input, setInput] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setVehicles(await api.me.vehicles());
      setLoadError(null);
    } catch (cause) {
      // `/me/vehicles` is built and needs no permission, so a failure here is
      // either this account being refused or the connection being down —
      // `gapOf` tells those apart, and neither of them means the garage is
      // empty. An empty list shown for a failed read is how somebody concludes
      // the app has forgotten their car.
      setLoadError(
        gapOf(cause)
          ? "Your vehicles could not be read for this account. Signing in again usually fixes it."
          : cause instanceof ApiError
            ? cause.message
            : "Could not load your vehicles. Check your connection and try again.",
      );
    }
  }, []);

  React.useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    void (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, load]);

  const plateNumbers = React.useMemo(() => new Set(vehicles?.map((v) => v.plateNumber) ?? []), [
    vehicles,
  ]);
  const canAdd = looksLikePlate(input) && !plateNumbers.has(normalisePlate(input));

  const addVehicle = React.useCallback(async () => {
    if (!canAdd) return;
    setError(null);
    setAdding(true);
    try {
      const created = await api.me.addVehicle(normalisePlate(input), "CAR");
      setVehicles((current) => (current ? [...current, created] : [created]));
      setInput("");
    } catch (cause) {
      // The server's own message is the useful one here: it is what says the
      // plate already belongs to another account, and it deliberately does not
      // say whose.
      setError(
        cause instanceof ApiError ? cause.message : "That vehicle could not be added.",
      );
    } finally {
      setAdding(false);
    }
  }, [canAdd, input]);

  const removeVehicle = React.useCallback(async (vehicle: MyVehicle) => {
    setError(null);
    setRemovingId(vehicle.id);
    try {
      await api.me.removeVehicle(vehicle.id);
      setVehicles((current) => (current ? current.filter((v) => v.id !== vehicle.id) : current));
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "That vehicle could not be removed.",
      );
    } finally {
      setRemovingId(null);
    }
  }, []);

  if (!user) {
    return (
      <Screen>
        <Card raise>
          <Label>Sign in first</Label>
          <Sub style={styles.body}>
            Your vehicles belong to your account. Sign in with your mobile number to see them.
          </Sub>
        </Card>
        <Button label="Sign in" onPress={() => router.push("/sign-in")} />
      </Screen>
    );
  }

  if (loading) return <Loading label="Loading your vehicles" />;

  return (
    <Screen>
      <Card raise>
        <Label>Your vehicles</Label>
        <Sub style={styles.body}>
          Add your number plate once. We use it to find your car when an attendant starts a parking
          session for it — and the parking already recorded against that plate becomes yours.
        </Sub>
      </Card>

      {loadError ? (
        <>
          <Banner tone="crit" title="Could not load your vehicles" body={loadError} />
          <Button label="Try again" variant="ghost" size="medium" onPress={() => void load()} />
        </>
      ) : null}

      {error ? <Banner tone="crit" title="That did not go through" body={error} /> : null}

      <Field
        label="Number plate"
        value={input}
        onChangeText={setInput}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="WB 02 AB 1234"
        maxLength={14}
        style={styles.plateInput}
        onSubmitEditing={() => void addVehicle()}
        returnKeyType="done"
      />

      <Button
        label="Add this plate"
        disabled={!canAdd}
        busy={adding}
        onPress={() => void addVehicle()}
      />

      {vehicles && vehicles.length > 0 ? (
        <View style={styles.list}>
          {vehicles.map((vehicle) => (
            <View key={vehicle.id} style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Find the car with plate ${formatPlate(vehicle.plateNumber)}`}
                onPress={() => router.push(`/parked/${vehicle.plateNumber}`)}
                style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
              >
                <Plate>{formatPlate(vehicle.plateNumber)}</Plate>
                <Text style={styles.rowHint}>
                  {vehicle.makeModel ?? "Tap to see whether it is parked"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${formatPlate(vehicle.plateNumber)}`}
                onPress={() => void removeVehicle(vehicle)}
                disabled={removingId === vehicle.id}
                style={({ pressed }) => [
                  styles.remove,
                  pressed && styles.rowPressed,
                  removingId === vehicle.id && styles.rowDisabled,
                ]}
              >
                <Text style={styles.removeGlyph}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* The other way in, for somebody whose car is parked this minute and
          whose plate is not the thing they can most reliably produce. */}
      <ClaimSession
        onClaimed={(claimed) => {
          void load();
          router.replace(`/parked/${claimed.plateNumber}`);
        }}
      />
    </Screen>
  );
}

/**
 * Whether a string looks like an Indian registration.
 *
 * Permissive on purpose. This only decides whether the "Add" button is
 * enabled; the server is what decides whether a plate exists, and a
 * validator here that is stricter than reality would lock somebody out of
 * their own car over a series it has never heard of — Bharat series, defence
 * plates, older formats.
 */
function looksLikePlate(plate: string): boolean {
  const clean = normalisePlate(plate);
  return clean.length >= 6 && clean.length <= 12 && /^[A-Z]{2}/.test(clean);
}

const styles = StyleSheet.create({
  body: { fontSize: 13.5, lineHeight: 19 },
  plateInput: { fontSize: 22, letterSpacing: 2 },

  list: { gap: theme.space(1) },
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.space(1),
  },
  rowMain: {
    flex: 1,
    minHeight: theme.minTouch + 12,
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: theme.space(2),
    borderWidth: 1,
    borderColor: theme.colour.line,
    borderRadius: theme.radius.md,
  },
  rowPressed: { backgroundColor: theme.colour.raise },
  rowDisabled: { opacity: 0.5 },
  rowHint: { fontSize: 12.5, color: theme.colour.muted },
  remove: {
    width: theme.minTouch,
    minHeight: theme.minTouch,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colour.line,
    borderRadius: theme.radius.md,
  },
  removeGlyph: { fontSize: 22, color: theme.colour.muted, lineHeight: 26 },
});
