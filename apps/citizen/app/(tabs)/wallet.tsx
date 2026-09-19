import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  ApiError,
  formatMoney,
  gapOf,
  type Paise,
  type WalletBalance,
  type WalletEntry,
} from "@kmcp/api";

import {
  Banner,
  Button,
  Card,
  Label,
  Loading,
  Money,
  Screen,
  Sub,
  Unavailable,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useRazorpayCheckout } from "../../lib/checkout";
import { useSession } from "../../lib/session";
import { theme } from "../../lib/theme";

/**
 * The wallet.
 *
 * All of this exists on the server now: `me/wallet` is its own controller under
 * the `/me` tree — balance, ledger, top-ups and session payments — and like the
 * rest of that tree it needs no permission, because the token is the scope. The
 * balance it answers with is derived from the ledger rather than stored, which
 * is what makes a disputed figure answerable at all.
 *
 * This screen used to say none of that was built, and name the route that would
 * fix it. Copy like that outliving the gap it described is worse than no copy:
 * it tells somebody their money is nowhere while the server is answering with
 * the balance. So a failure here is now written as what it is — a failure —
 * with a way to try again.
 *
 * The one rule that has not changed is the one worth keeping: nothing on this
 * screen is rendered as a confident zero. A balance of ₹0.00 and an empty list
 * of transactions is a specific claim about somebody's finances, not an absence
 * of data, and it is only ever shown when the server actually said so.
 *
 * Still worth knowing, because shipping the routes did not settle it: holding
 * citizens' money — even small amounts, even with no cash-out — makes KMC a
 * prepaid instrument issuer under RBI's rules. That is a decision for whoever
 * owns the contract, not a thing to put in front of a driver on a bad
 * connection.
 */

/** The top-up amounts on the chips. Fixed, and in paise like everything else. */
const TOP_UPS: Paise[] = [20_000, 50_000, 100_000];

export default function Wallet() {
  const router = useRouter();
  const { user, online } = useSession();

  const [balance, setBalance] = React.useState<WalletBalance | null>(null);
  const [entries, setEntries] = React.useState<WalletEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [chosen, setChosen] = React.useState<Paise>(TOP_UPS[1]!);
  const [topUpBusy, setTopUpBusy] = React.useState(false);
  const [topUpError, setTopUpError] = React.useState<string | null>(null);
  const [topUpSuccess, setTopUpSuccess] = React.useState<string | null>(null);

  const { open, modal } = useRazorpayCheckout();

  const load = React.useCallback(async () => {
    const [balanceResult, entriesResult] = await Promise.allSettled([
      api.wallet.balance(),
      api.wallet.entries(),
    ]);

    if (balanceResult.status === "fulfilled") setBalance(balanceResult.value);
    if (entriesResult.status === "fulfilled") setEntries(entriesResult.value);

    if (balanceResult.status === "rejected") {
      // `gapOf` still earns its keep: a definite refusal from a server that
      // answered is a different problem from a dead connection, and only one of
      // them is worth trying again. What it no longer means is "not built".
      const reason = balanceResult.reason;
      setError(
        gapOf(reason)
          ? "Your wallet could not be read for this account. Signing in again usually fixes it."
          : reason instanceof ApiError
            ? reason.message
            : "Could not load your wallet. Check your connection and try again.",
      );
    } else {
      setError(null);
    }
  }, []);

  /** The retry behind the failure state: the spinner comes back while it runs. */
  const reload = React.useCallback(async () => {
    setLoading(true);
    await load();
    setLoading(false);
  }, [load]);

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

  const startTopUp = React.useCallback(async () => {
    setTopUpError(null);
    setTopUpSuccess(null);
    setTopUpBusy(true);
    try {
      const topUp = await api.wallet.topUp(chosen);
      const result = await open({
        gatewayKeyId: topUp.gatewayKeyId,
        gatewayOrder: topUp.gatewayOrder,
        description: `Add ${formatMoney(topUp.amount, { decimals: false })} to your wallet`,
      });

      if (result.status === "cancelled") {
        setTopUpBusy(false);
        return;
      }
      if (result.status === "error") {
        setTopUpError(result.message);
        setTopUpBusy(false);
        return;
      }

      await api.payments.verify(topUp.id, {
        razorpayOrderId: result.razorpayOrderId,
        razorpayPaymentId: result.razorpayPaymentId,
        razorpaySignature: result.razorpaySignature,
      });

      await load();
      setTopUpSuccess(`Added ${formatMoney(topUp.amount, { decimals: false })} to your wallet.`);
    } catch (cause) {
      // Deliberately says nothing about whether money moved. This catch covers
      // the whole attempt, checkout included, so a refusal can land after the
      // gateway has taken the payment — and the credit is written by the
      // webhook either way. Guessing here is how a screen tells somebody their
      // money is gone when it is merely late.
      setTopUpError(
        gapOf(cause)
          ? "That top-up was refused for this account. Signing in again usually fixes it."
          : cause instanceof ApiError
            ? cause.message
            : "That top-up could not be completed. Check your connection and try again.",
      );
    } finally {
      setTopUpBusy(false);
    }
  }, [chosen, open, load]);

  if (!user) {
    return (
      <Screen>
        <Card raise>
          <Label>Sign in first</Label>
          <Sub style={styles.body}>
            A wallet belongs to an account. The map works without one; this does not.
          </Sub>
        </Card>
        <Button label="Sign in" onPress={() => router.push("/sign-in")} />
      </Screen>
    );
  }

  if (loading) return <Loading label="Loading your wallet" />;

  // No balance means the read failed, not that the wallet is missing. Nothing
  // is shown in its place — a zero here would be a claim about this person's
  // money that the server never made.
  if (!balance) {
    return (
      <Screen>
        <Unavailable
          title="Your wallet could not be loaded"
          body={
            error ??
            "The balance did not come back just now. Check your connection and try again — nothing about your wallet has changed."
          }
        />

        <Button label="Try again" variant="ghost" size="medium" onPress={() => void reload()} />

        <Sub style={styles.body}>
          Paying by UPI does not go through the wallet, so a car that is parked can still be paid
          for from its own screen.
        </Sub>
      </Screen>
    );
  }

  return (
    <Screen>
      {!online ? (
        <Banner
          tone="warn"
          title="You are offline"
          body="This balance was last read when you had signal. It may have moved since."
        />
      ) : error ? (
        // A balance is already on screen, so this is a refresh that did not
        // land rather than a screen that failed — the figure stays, labelled.
        <Banner tone="warn" title="This balance may be a moment out of date" body={error} />
      ) : null}

      <Card raise style={styles.balanceCard}>
        <Label>Balance</Label>
        <Money>{formatMoney(balance.balance)}</Money>
      </Card>

      <Card onPress={() => router.push("/passes")} accessibilityLabel="Buy a pass">
        <View style={styles.passRow}>
          <View style={styles.passRowText}>
            <Text style={styles.passRowTitle}>Buy a pass</Text>
            <Sub style={styles.body}>A season ticket for a vehicle, paid once.</Sub>
          </View>
          <Text style={styles.chevron}>›</Text>
        </View>
      </Card>

      <Button
        label={`Add ${formatMoney(chosen, { decimals: false })}`}
        busy={topUpBusy}
        onPress={() => void startTopUp()}
      />

      <View style={styles.chips}>
        {TOP_UPS.map((amount) => {
          const on = amount === chosen;
          return (
            <Pressable
              key={amount}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Add ${formatMoney(amount, { decimals: false })}`}
              onPress={() => setChosen(amount)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                {formatMoney(amount, { decimals: false })}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {topUpSuccess ? <Banner tone="good" title={topUpSuccess} /> : null}
      {topUpError ? <Banner tone="crit" title="That top-up did not go through" body={topUpError} /> : null}

      {modal}

      <Label>Recent</Label>
      {entries === null ? (
        <Unavailable
          title="The ledger could not be read"
          body="Your transactions did not come back just now. Check your connection and try again — the balance above is unaffected."
        />
      ) : entries.length === 0 ? (
        <Sub style={styles.body}>
          Nothing has moved through this wallet yet. Money you add and parking you pay for both
          appear here, each as its own row.
        </Sub>
      ) : (
        <View style={styles.ledger}>
          {entries.map((entry, index) => (
            <LedgerRow key={entry.id} entry={entry} last={index === entries.length - 1} />
          ))}
        </View>
      )}
    </Screen>
  );
}

/**
 * One ledger row.
 *
 * The sign on the amount comes from the amount itself, never from the kind —
 * a new entry kind added on the server cannot silently be totalled the wrong
 * way round here, and the arrow glyph and the colour both follow the same
 * single source.
 */
function LedgerRow({ entry, last }: { entry: WalletEntry; last: boolean }) {
  const credit = entry.amount >= 0;
  return (
    <View style={[styles.led, last && styles.ledLast]}>
      <View style={[styles.ledIcon, credit ? styles.ledIconIn : styles.ledIconOut]}>
        <Text style={[styles.ledGlyph, credit ? styles.ledGlyphIn : styles.ledGlyphOut]}>
          {credit ? "+" : "P"}
        </Text>
      </View>
      <View style={styles.ledText}>
        <Text style={styles.ledTitle} numberOfLines={1}>
          {entry.description}
        </Text>
        <Text style={styles.ledMeta} numberOfLines={1}>
          {new Date(entry.createdAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
          })}
        </Text>
      </View>
      <Text style={[styles.ledAmount, credit && styles.ledAmountIn]}>
        {credit ? "+" : "−"}
        {formatMoney(Math.abs(entry.amount))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 13.5, lineHeight: 20 },

  balanceCard: { alignItems: "flex-start", gap: theme.space(0.5) },

  passRow: { flexDirection: "row", alignItems: "center", gap: theme.space(1.5) },
  passRowText: { flex: 1, gap: 2 },
  passRowTitle: { fontSize: 16, fontWeight: "700", color: theme.colour.ink },
  chevron: { fontSize: 22, color: theme.colour.muted },

  chips: { flexDirection: "row", gap: theme.space(1) },
  chip: {
    flex: 1,
    minHeight: theme.minTouch,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: theme.colour.line,
    borderRadius: theme.radius.md,
  },
  chipOn: { borderColor: theme.colour.primary, backgroundColor: theme.colour.primaryWash },
  chipLabel: {
    fontSize: 17,
    fontWeight: "600",
    color: theme.colour.ink,
    fontVariant: ["tabular-nums"],
  },
  chipLabelOn: { color: theme.colour.primary },

  ledger: { },
  led: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space(1.5),
    paddingVertical: theme.space(1.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.colour.line,
  },
  ledLast: { borderBottomWidth: 0 },
  ledIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  ledIconIn: { backgroundColor: theme.colour.goodWash },
  ledIconOut: { backgroundColor: theme.colour.raise },
  ledGlyph: { fontSize: 16, fontWeight: "700" },
  ledGlyphIn: { color: theme.colour.good },
  ledGlyphOut: { color: theme.colour.muted },
  ledText: { flex: 1, minWidth: 0, gap: 1 },
  ledTitle: { fontSize: 15, fontWeight: "600", color: theme.colour.ink },
  ledMeta: { fontSize: 12.5, color: theme.colour.muted },
  ledAmount: {
    fontSize: 15.5,
    fontWeight: "700",
    color: theme.colour.ink,
    fontVariant: ["tabular-nums"],
  },
  ledAmountIn: { color: theme.colour.good },
});
