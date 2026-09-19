import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import {
  ApiError,
  formatMoney,
  formatPlate,
  gapOf,
  type MyPass,
  type MyVehicle,
  type PassPlan,
} from "@kmcp/api";

import {
  Banner,
  Button,
  Card,
  Chip,
  Label,
  Loading,
  Money,
  Row,
  Screen,
  Sub,
  Unavailable,
} from "../components/ui";
import { vehicleTypeWord } from "../lib/availability";
import { api } from "../lib/api";
import { useRazorpayCheckout } from "../lib/checkout";
import { useSession } from "../lib/session";
import { theme } from "../lib/theme";

/**
 * Season tickets.
 *
 * A pass is a plan bought against one vehicle: pay once, and every session on
 * that plate is waived up to `validDays` later. Buying one still goes through
 * a gateway order exactly like a wallet top-up does — the plan names the
 * price, the server prices the order, and this screen only ever passes the
 * plan id and plate through unchanged.
 */
export default function Passes() {
  const router = useRouter();
  const { user } = useSession();

  const [plans, setPlans] = React.useState<PassPlan[] | null>(null);
  const [vehicles, setVehicles] = React.useState<MyVehicle[] | null>(null);
  const [passes, setPasses] = React.useState<MyPass[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [selectedPlanId, setSelectedPlanId] = React.useState<string | null>(null);
  const [selectedPlate, setSelectedPlate] = React.useState<string | null>(null);
  const [buyBusy, setBuyBusy] = React.useState(false);
  const [buyError, setBuyError] = React.useState<string | null>(null);
  const [buySuccess, setBuySuccess] = React.useState<string | null>(null);

  const { open, modal } = useRazorpayCheckout();

  const load = React.useCallback(async () => {
    const [plansResult, vehiclesResult, passesResult] = await Promise.allSettled([
      api.passes.plans(),
      api.me.vehicles(),
      api.me.passes(),
    ]);

    if (plansResult.status === "fulfilled") setPlans(plansResult.value);
    if (vehiclesResult.status === "fulfilled") setVehicles(vehiclesResult.value);
    if (passesResult.status === "fulfilled") setPasses(passesResult.value);

    if (plansResult.status === "rejected") {
      // `GET /pass-plans` is public and `POST /me/passes` needs no permission,
      // so a refusal here is a real failure, not a feature waiting to be
      // switched on. It is reported without taking the screen over: somebody's
      // own passes come from a different call and are still worth showing.
      setError(
        gapOf(plansResult.reason)
          ? "Season-ticket plans could not be read for this account. Signing in again usually fixes it."
          : plansResult.reason instanceof ApiError
            ? plansResult.reason.message
            : "Could not load season-ticket plans. Check your connection and try again.",
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

  const buy = React.useCallback(
    async (plan: PassPlan) => {
      if (!vehicles || vehicles.length === 0) {
        setBuyError("Add a vehicle first — a pass is bought against a plate.");
        return;
      }

      const plate = vehicles.length === 1 ? vehicles[0]!.plateNumber : selectedPlate;
      if (!plate) {
        setBuyError("Choose which vehicle this pass is for.");
        return;
      }

      setBuyError(null);
      setBuySuccess(null);
      setBuyBusy(true);
      setSelectedPlanId(plan.id);
      try {
        const bought = await api.passes.purchase(plan.id, plate);

        if (bought.paymentId && bought.gatewayKeyId && bought.gatewayOrder) {
          const result = await open({
            gatewayKeyId: bought.gatewayKeyId,
            gatewayOrder: bought.gatewayOrder,
            description: `${plan.name} — ${formatPlate(plate)}`,
          });

          if (result.status === "cancelled") {
            setBuyBusy(false);
            setSelectedPlanId(null);
            return;
          }
          if (result.status === "error") {
            setBuyError(result.message);
            setBuyBusy(false);
            setSelectedPlanId(null);
            return;
          }

          await api.payments.verify(bought.paymentId, {
            razorpayOrderId: result.razorpayOrderId,
            razorpayPaymentId: result.razorpayPaymentId,
            razorpaySignature: result.razorpaySignature,
          });
        }

        const refreshed = await api.me.passes();
        setPasses(refreshed);
        setBuySuccess(`${plan.name} bought for ${formatPlate(plate)}.`);
      } catch (cause) {
        setBuyError(
          gapOf(cause)
            ? "The server would not complete this purchase for this account. Signing in again usually fixes it."
            : cause instanceof ApiError
              ? cause.message
              : "That purchase could not be completed. Check your connection and try again.",
        );
      } finally {
        setBuyBusy(false);
        setSelectedPlanId(null);
      }
    },
    [vehicles, selectedPlate, open],
  );

  if (!user) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Passes" }} />
        <Card raise>
          <Label>Sign in first</Label>
          <Sub style={styles.body}>A pass is bought against your account. Sign in to continue.</Sub>
        </Card>
        <Button label="Sign in" onPress={() => router.push("/sign-in")} />
      </Screen>
    );
  }

  if (loading) return <Loading label="Loading passes" />;

  const hasMultipleVehicles = (vehicles?.length ?? 0) > 1;

  return (
    <Screen>
      <Stack.Screen options={{ title: "Passes" }} />

      {error ? <Banner tone="crit" title={error} /> : null}

      {passes && passes.length > 0 ? (
        <>
          <Label>Your passes</Label>
          {passes.map((pass) => (
            <Card key={pass.id}>
              <Row label={pass.planName} value={formatPlate(pass.plateNumber)} />
              <Row
                label="Status"
                value={passStatusWord[pass.status] ?? pass.status}
                last={pass.status !== "ACTIVE"}
              />
              {pass.status === "ACTIVE" ? (
                <Row
                  label="Valid until"
                  value={new Date(pass.validTo).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  last
                />
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      <Label>Available plans</Label>

      {vehicles && vehicles.length === 0 ? (
        <Banner
          tone="info"
          title="Add a vehicle to buy a pass"
          body="A pass is bought against a plate. Register one first."
        />
      ) : null}

      {hasMultipleVehicles ? (
        <View style={styles.plateRow}>
          {vehicles!.map((vehicle) => (
            <Pressable
              key={vehicle.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedPlate === vehicle.plateNumber }}
              accessibilityLabel={`Buy for ${formatPlate(vehicle.plateNumber)}`}
              onPress={() => setSelectedPlate(vehicle.plateNumber)}
            >
              <Chip
                tone={selectedPlate === vehicle.plateNumber ? "good" : "flat"}
                label={formatPlate(vehicle.plateNumber)}
              />
            </Pressable>
          ))}
        </View>
      ) : null}

      {plans === null ? (
        <Unavailable
          title="Plans could not be read"
          body="This is most likely a signal problem — try again in a moment."
        />
      ) : plans.length === 0 ? (
        <Sub style={styles.body}>No season-ticket plans are on offer right now.</Sub>
      ) : (
        plans.map((plan) => (
          <Card key={plan.id} raise style={styles.planCard}>
            <View style={styles.planHead}>
              <View style={styles.planText}>
                <Text style={styles.planName}>{plan.name}</Text>
                {plan.description ? <Sub style={styles.body}>{plan.description}</Sub> : null}
              </View>
              <Money style={styles.planAmount}>{formatMoney(plan.amount, { decimals: false })}</Money>
            </View>

            <View style={styles.planMeta}>
              <Chip label={`${plan.validDays} days`} />
              <Chip label={vehicleTypeWord[plan.vehicleType] ?? plan.vehicleType} />
            </View>

            <Button
              label="Buy"
              size="medium"
              busy={buyBusy && selectedPlanId === plan.id}
              disabled={buyBusy && selectedPlanId !== plan.id}
              onPress={() => void buy(plan)}
            />
          </Card>
        ))
      )}

      {buySuccess ? <Banner tone="good" title={buySuccess} /> : null}
      {buyError ? <Banner tone="crit" title="That purchase did not go through" body={buyError} /> : null}

      {modal}
    </Screen>
  );
}

const passStatusWord: Record<MyPass["status"], string> = {
  PENDING_PAYMENT: "Payment pending",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

const styles = StyleSheet.create({
  body: { fontSize: 13.5, lineHeight: 20 },

  plateRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.space(1) },

  planCard: { gap: theme.space(1.125) },
  planHead: { flexDirection: "row", justifyContent: "space-between", gap: theme.space(1.5) },
  planText: { flex: 1, gap: 2 },
  planName: { fontSize: 17, fontWeight: "700", color: theme.colour.ink },
  planAmount: { fontSize: 24 },
  planMeta: { flexDirection: "row", gap: theme.space(1) },
});
