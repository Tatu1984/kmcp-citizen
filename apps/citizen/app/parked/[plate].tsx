import * as React from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ApiError,
  formatDuration,
  formatMoney,
  formatPlate,
  formatTime,
  gapOf,
  normalisePlate,
  type MySession,
  type SessionQuote,
  type WalletBalance,
} from "@kmcp/api";

import {
  Banner,
  Button,
  Card,
  Chip,
  Empty,
  Label,
  Loading,
  Plate,
  Screen,
  Sub,
} from "../../components/ui";
import { ClaimSession } from "../../components/claim-session";
import { FareBreakdown, FareTotals } from "../../components/fare-breakdown";
import { api } from "../../lib/api";
import { useRazorpayCheckout } from "../../lib/checkout";
import { elapsedMinutesSince, useNow } from "../../lib/elapsed";
import { useSession } from "../../lib/session";
import { theme } from "../../lib/theme";

/**
 * Where your car is, how long it has been there, and what it is costing.
 *
 * A citizen never starts a parking session — an attendant does, at the kerb,
 * allocating a bay — so this screen finds their car by matching a registered
 * plate against their own sessions. That is the join, and it is the reason the
 * app asks for a number plate at all.
 *
 * Three things about it were wrong in a way worth recording, because all three
 * came from the same instinct to under-promise:
 *
 *  - It refused to show a running fare, on the grounds that a handset must not
 *    invent a price. The grounds were right and the conclusion is now obsolete:
 *    `GET /sessions/:id/quote` prices a live session with the server's own fare
 *    engine, so the figure on screen is one the server stands behind. It is
 *    labelled provisional because it will keep growing, not because anybody is
 *    guessing.
 *  - It showed no bay, which is the one thing the person reading this screen
 *    actually wants. "Bay A-12" is the answer to their question; the fare is
 *    the answer to the next one.
 *  - It never refetched and never ticked, so the timer sat frozen and the
 *    unpark never arrived. Somebody walking back to their car watched a dead
 *    screen.
 *
 * The rule the attendant app is built on still holds, and is what makes the
 * running fare safe to show: the server prices, the handset counts minutes and
 * says so.
 */

/**
 * Twenty seconds for the session itself.
 *
 * This poll exists for exactly one event: the attendant marking the vehicle
 * unparked. That is the moment the screen has to change from a running timer to
 * a settled total, it is triggered by somebody else tapping a button a few
 * metres away, and the driver is very often standing there watching for it. A
 * minute's lag on that reads as an app that has not noticed. Twenty seconds is
 * three small scoped reads a minute — cheap against a citizen's data, and the
 * poll stops the moment the session settles, because a session that has stopped
 * running does not start again.
 */
const SESSION_POLL_MS = 20_000;

/**
 * A minute for the fare.
 *
 * Three times slower than the session poll, deliberately. The quote is the more
 * expensive of the two calls — the server resolves a tariff, walks its rules and
 * looks for a valid pass — and it is the slower-moving answer: fares step at
 * increment boundaries measured in fifteens of minutes, never in seconds, so a
 * minute bounds how stale the figure can be to well inside one step of it.
 * Between refreshes the ticking clock beside it is what tells the driver the
 * screen is alive, which is the job a faster fare poll would otherwise be doing
 * at four times the cost.
 *
 * A settled session is never polled at all. Its fare was decided when it ended
 * and re-asking cannot change it.
 */
const QUOTE_POLL_MS = 60_000;

export default function Parked() {
  const { plate } = useLocalSearchParams<{ plate: string }>();
  const router = useRouter();
  const { user } = useSession();

  const [session, setSession] = React.useState<MySession | null>(null);
  const [quote, setQuote] = React.useState<SessionQuote | null>(null);
  const [wallet, setWallet] = React.useState<WalletBalance | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [quoteNote, setQuoteNote] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [payNote, setPayNote] = React.useState<string | null>(null);
  const [paySuccess, setPaySuccess] = React.useState<string | null>(null);
  const [payingWallet, setPayingWallet] = React.useState(false);
  const [payingGateway, setPayingGateway] = React.useState(false);

  const { open, modal } = useRazorpayCheckout();

  const wanted = normalisePlate(plate ?? "");
  const live = session !== null && session.endAt === null;
  const settled = session !== null && session.endAt !== null;

  // Read by the pollers, which must not be torn down and rebuilt every time a
  // fetch lands — a poll whose interval restarts on each result either fires
  // continuously or never fires again.
  //
  // This effect is declared above the pollers on purpose. `useFocusEffect` is an
  // ordinary `useEffect` underneath and runs its callback straight away when the
  // screen is already focused, so the commit in which a session first arrives
  // runs this sync first and the quote poll second — which is the only reason
  // that first quote request has a session id to ask about.
  const sessionRef = React.useRef<MySession | null>(null);
  React.useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /**
   * This plate's session: the live one, or failing that the most recent.
   *
   * `me.activeSessions()` rather than `me.sessions("ACTIVE")`, because the
   * overstay sweep promotes a running session from ACTIVE to OVERSTAY without
   * warning and the single-valued `?status=` filter then loses it — the app
   * used to watch a car vanish off this screen six hours into a stay. And no
   * fallback to `sessions.lookup`: that route is staff-only, returns any
   * vehicle's session to whoever asks, and refuses a citizen every time, so the
   * old code path could only ever produce a 403.
   *
   * The history call is the fallback rather than the first choice so that a
   * session which ended thirty seconds ago still renders its total instead of
   * an empty screen.
   */
  const refresh = React.useCallback(
    async (force = false): Promise<void> => {
      if (!wanted) return;

      const parked = (await api.me.activeSessions()).find(
        (candidate) => normalisePlate(candidate.plateNumber) === wanted,
      );
      if (parked) {
        setSession(parked);
        return;
      }

      // Nothing live. If a settled session for this plate is already on screen
      // there is nothing to go and ask — so the history call is spent once, on
      // the transition out of ACTIVE, and not on every poll. `force` is for
      // after a payment, which does change a settled row.
      const held = sessionRef.current;
      if (!force && held !== null && held.endAt !== null) return;

      const recent = (await api.me.sessions()).find(
        (candidate) => normalisePlate(candidate.plateNumber) === wanted,
      );
      setSession(recent ?? null);
    },
    [wanted],
  );

  const loadSession = React.useCallback(
    async (force = false): Promise<void> => {
      try {
        await refresh(force);
        setError(null);
      } catch (cause) {
        // Whatever is already on screen stays there. Figures a few seconds old
        // are a great deal more use to somebody standing next to their car than
        // a screen wiped clean because one request timed out.
        setError(
          cause instanceof ApiError ? cause.message : "Could not check on your car just now.",
        );
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  /**
   * What the session costs if the car left this minute.
   *
   * Read off the ref rather than the rendered `session` so that the poller does
   * not have to be rebuilt each time a session lands, and guarded on `endAt`
   * so a tick that arrives in the same breath as an unpark cannot re-ask for a
   * quote that is no longer provisional.
   */
  const loadQuote = React.useCallback(async (): Promise<void> => {
    const current = sessionRef.current;
    if (current === null || current.endAt !== null) return;

    try {
      setQuote(await api.sessions.quote(current.id));
      setQuoteNote(null);
    } catch (cause) {
      // The last good figure is left where it is: it is already labelled as
      // provisional and dated, so a minute-old total is honest, whereas
      // blanking it would trade a good number for none.
      setQuoteNote(
        gapOf(cause) === "NOT_PERMITTED"
          ? "The server would not price this session for this account. If the car is yours, sign in again."
          : cause instanceof ApiError
            ? cause.message
            : "Could not fetch the running cost just now.",
      );
    }
  }, []);

  // Polled while there is something that can still change: a live session, or
  // no session yet — somebody who has just handed their keys over is watching
  // this screen for one to appear.
  usePollWhileVisible(loadSession, SESSION_POLL_MS, Boolean(user) && wanted !== "" && !settled);
  usePollWhileVisible(loadQuote, QUOTE_POLL_MS, live);

  // Nothing to wait for when there is nobody to look up, or no plate to look up.
  React.useEffect(() => {
    if (!user || !wanted) setLoading(false);
  }, [user, wanted]);

  const refreshWallet = React.useCallback(async () => {
    try {
      setWallet(await api.wallet.balance());
    } catch {
      // Left null, and deliberately not turned into an error on this screen.
      // The balance is a convenience beside the pay button, not the reason
      // somebody opened this — and a wallet that did not answer must not be
      // drawn as a zero, which is a claim about their money rather than an
      // absence of one. UPI is unaffected either way.
    }
  }, []);

  React.useEffect(() => {
    if (!user) return;
    void refreshWallet();
  }, [user, refreshWallet]);

  // One interval for the whole screen, stopped while the app is backgrounded,
  // and only running at all while there is a clock worth moving.
  const now = useNow(live);

  if (loading) return <Loading label="Looking for your car" />;

  // Finding a specific person's car means knowing which person is asking. The
  // map does not need an account; this does, and says so rather than returning
  // an empty answer that reads as "your car is not parked".
  if (!user) {
    return (
      <Screen>
        <Card raise>
          <Label>Sign in first</Label>
          <Sub style={styles.footnote}>
            {`We match ${formatPlate(plate ?? "")} against the sessions attendants have started. That needs an account, so we know whose car to look for.`}
          </Sub>
        </Card>
        <Button label="Sign in" onPress={() => router.push("/sign-in")} />
        <Button
          label="Back to the map"
          variant="ghost"
          size="medium"
          onPress={() => router.replace("/(tabs)")}
        />
      </Screen>
    );
  }

  /**
   * Lands the citizen on the session they just claimed.
   *
   * Set here as well as navigated to, because a code very often belongs to the
   * plate this screen is already showing — the driver mistyped it when they
   * registered, or the attendant did at the kerb — and in that case `replace`
   * with the same path is a no-op that would leave them staring at the
   * not-found state they just escaped.
   */
  const onClaimed = (claimed: MySession) => {
    setSession(claimed);
    setQuote(null);
    setError(null);
    setLoading(false);
    if (normalisePlate(claimed.plateNumber) !== wanted) {
      router.replace(`/parked/${claimed.plateNumber}`);
    }
  };

  if (!session) {
    return (
      <Screen>
        <Stack.Screen options={{ title: plate ? formatPlate(plate) : "Your car" }} />

        {error ? (
          <Banner tone="crit" title="Could not check on your car" body={error} />
        ) : null}

        <Empty
          title="This car is not parked right now"
          body={`No live session for ${formatPlate(plate ?? "")}, and nothing earlier on it either. When an attendant starts one, it appears here on its own.`}
        />

        {/* The dead end, which is exactly where the code belongs: somebody
            standing at their car being told it is not parked is holding a
            ticket that says otherwise, and the plate we matched on is the
            likeliest thing to be wrong. */}
        <ClaimSession onClaimed={onClaimed} title="Holding a ticket? Use the code" />

        <Button
          label="Back to the map"
          variant="ghost"
          onPress={() => router.replace("/(tabs)")}
        />
      </Screen>
    );
  }

  /**
   * How long the car has been there.
   *
   * Counted on this handset from the `startAt` the server recorded, so it moves
   * while somebody is looking at it rather than sitting frozen at whatever the
   * last response said. Once the session has stopped running the server's own
   * figure stands, because that is the one the fare was worked out against.
   */
  const parkedMinutes = live
    ? (elapsedMinutesSince(session.startAt, now) ?? session.elapsedMinutes)
    : session.elapsedMinutes;

  // Live: the server's provisional figure, or nothing until it lands — never a
  // number worked out here. Settled: what the session was actually charged.
  const owed = live ? (quote?.payableAmount ?? null) : session.payableAmount;

  return (
    <Screen>
      <Stack.Screen options={{ title: formatPlate(session.plateNumber) }} />

      {error ? (
        <Banner tone="warn" title="This may be a moment out of date" body={error} />
      ) : null}

      {/* ------------------------------------------------ where the car is */}
      <Card raise style={styles.where}>
        <Label>{live ? "Where your car is" : "Where your car was"}</Label>

        {session.slot ? (
          <Text style={styles.bay}>Bay {session.slot.code}</Text>
        ) : (
          <>
            <Text style={styles.bay}>{session.zone.name}</Text>
            <Sub style={styles.footnote}>
              No bay number for this one — the car park has no numbered spaces recorded, so your
              car is booked to the car park itself rather than to a bay in it.
            </Sub>
          </>
        )}

        <View style={styles.whereMeta}>
          <Plate>{formatPlate(session.plateNumber)}</Plate>
          <Sub>
            {session.slot ? `${session.zone.name} · ` : ""}
            {session.vehicleType.label} · started {formatTime(session.startAt)}
          </Sub>
        </View>

        {/* Worth showing: it is what an attendant asks for, and what somebody
            else would need to pull this session onto their own account. */}
        <Sub style={styles.code}>Session {session.code}</Sub>
      </Card>

      {/* ------------------------------------------------ the two figures */}
      <View style={styles.hero}>
        <View style={styles.heroCell}>
          <Label>Parked for</Label>
          <Text style={styles.figure}>{formatDuration(parkedMinutes)}</Text>
          <Sub style={styles.heroSub}>since {formatTime(session.startAt)}</Sub>
        </View>

        <View style={styles.heroCell}>
          <Label>{live ? "Costing so far" : "Total"}</Label>
          <Text style={styles.figure}>{formatMoney(owed)}</Text>
          <Sub style={styles.heroSub}>
            {live
              ? "if it left now"
              : session.endAt
                ? `left at ${formatTime(session.endAt)}`
                : "not charged"}
          </Sub>
        </View>
      </View>

      {live ? (
        <Sub style={styles.clockNote}>
          The time is counted on this phone, from the start the attendant recorded. The amount is
          the server's own — it prices your session as though the car left this minute — so it is
          real, and it will keep growing until the attendant marks the car unparked.
        </Sub>
      ) : null}

      {session.isOverstay ? (
        <Chip tone="warn" label="Over the maximum stay — a penalty will apply" />
      ) : null}

      {/* ------------------------------------------------ the calculation */}
      {live ? (
        quote?.quote ? (
          <FareBreakdown
            quote={quote.quote}
            title="If your car left now"
            note={
              quote.quotedAt
                ? `Worked out by the server at ${formatTime(quote.quotedAt)}, and still growing.`
                : "Worked out by the server for this minute, and still growing."
            }
            totalLabel="To pay if it left now"
          />
        ) : (
          <Card>
            <Label>The running cost</Label>
            <Sub style={styles.footnote}>
              {quoteNote ??
                "Asking the server what this session would cost if the car left now. Nothing on this phone works out a fare."}
            </Sub>
          </Card>
        )
      ) : session.fareBreakdown ? (
        <FareBreakdown
          quote={session.fareBreakdown}
          title="What you were charged"
          note="The calculation stored when your car left. It cannot change."
        />
      ) : (
        <FareTotals session={session} title="What you were charged" />
      )}

      {/* ------------------------------------------------------ the money */}
      {session.payment ? (
        <Banner
          tone="good"
          title={`Paid ${formatMoney(session.payableAmount)}`}
          body={
            session.refundedAmount > 0
              ? `${formatMoney(session.refundedAmount)} of this was refunded.${session.receipt ? ` Receipt ${session.receipt.number}.` : ""}`
              : session.receipt
                ? `Receipt ${session.receipt.number}`
                : "Your receipt number will follow shortly."
          }
        />
      ) : (
        <View style={styles.pay}>
          <Button
            label={owed === null ? "Pay from wallet" : `Pay ${formatMoney(owed)} from wallet`}
            busy={payingWallet}
            disabled={payingGateway}
            onPress={() => void payFromWallet(session.id)}
          />

          <Sub style={styles.balance}>
            {wallet
              ? `Balance ${formatMoney(wallet.balance)}${
                  owed === null ? "" : ` — ${formatMoney(wallet.balance - owed)} after this`
                }`
              : "Your balance could not be read just now, so there is no figure to show. Paying from the wallet may still work, and UPI does not depend on it."}
          </Sub>

          <Button
            label="Pay by UPI instead"
            variant="ghost"
            size="medium"
            busy={payingGateway}
            disabled={payingWallet}
            onPress={() => void payByGateway(session.id)}
          />

          {paySuccess ? <Banner tone="good" title={paySuccess} /> : null}
          {payNote ? (
            <Banner tone="crit" title="That payment did not go through" body={payNote} />
          ) : null}
        </View>
      )}

      {modal}

      <Sub style={styles.disclaimer}>
        Whatever you pay, the amount is the server's. Nothing on this phone decides what parking
        costs — it asks, reports the answer, and counts the minutes.
      </Sub>
    </Screen>
  );

  /** Pays for `sessionId` straight out of the wallet balance. Captures immediately, no checkout. */
  async function payFromWallet(sessionId: string): Promise<void> {
    setPayNote(null);
    setPaySuccess(null);
    setPayingWallet(true);
    try {
      await api.wallet.paySession(sessionId);
      await Promise.all([loadSession(true), refreshWallet()]);
      setPaySuccess("Paid from your wallet.");
    } catch (cause) {
      setPayNote(
        gapOf(cause)
          ? "That payment was refused for this account. Signing in again usually fixes it, and paying by UPI does not depend on the wallet."
          : cause instanceof ApiError
            ? cause.message
            : "That payment did not go through. Check your connection and try again.",
      );
    } finally {
      setPayingWallet(false);
    }
  }

  /** Pays for `sessionId` through the gateway checkout sheet, then confirms it server-side. */
  async function payByGateway(sessionId: string): Promise<void> {
    setPayNote(null);
    setPaySuccess(null);
    setPayingGateway(true);
    try {
      const payment = await api.payments.payOwnSession(sessionId);

      if (payment.gatewayKeyId && payment.gatewayOrder) {
        const result = await open({
          gatewayKeyId: payment.gatewayKeyId,
          gatewayOrder: payment.gatewayOrder,
          description: `Parking — ${formatMoney(payment.amount)}`,
        });

        if (result.status === "cancelled") {
          setPayingGateway(false);
          return;
        }
        if (result.status === "error") {
          setPayNote(result.message);
          setPayingGateway(false);
          return;
        }

        await api.payments.verify(payment.id, {
          razorpayOrderId: result.razorpayOrderId,
          razorpayPaymentId: result.razorpayPaymentId,
          razorpaySignature: result.razorpaySignature,
        });
      }

      await loadSession(true);
      setPaySuccess("Payment received.");
    } catch (cause) {
      setPayNote(
        cause instanceof ApiError ? cause.message : "That payment could not be started.",
      );
    } finally {
      setPayingGateway(false);
    }
  }
}

/**
 * Runs something on focus, then on an interval — but only while this screen is
 * the one on top and the app is in the foreground.
 *
 * All three conditions matter and each was a real failure. Without the focus
 * gate, every screen the citizen had ever opened would keep polling behind the
 * one they are looking at. Without the `AppState` gate, a phone in a pocket
 * would spend the walk back to the car making requests nobody reads. And
 * without the immediate call on focus and on returning to the foreground, the
 * driver would be shown whatever was true when they put the phone away, for up
 * to a whole interval — which on this screen is the difference between "still
 * parked" and a fare to pay.
 */
function usePollWhileVisible(tick: () => Promise<void>, intervalMs: number, enabled: boolean) {
  // Held in a ref so that a callback which changes identity on every render
  // does not tear down and restart the interval. That restart is how a poll
  // ends up firing on every render, or silently never firing at all.
  const latest = React.useRef(tick);
  React.useEffect(() => {
    latest.current = tick;
  }, [tick]);

  useFocusEffect(
    React.useCallback(() => {
      if (!enabled) return;

      let timer: ReturnType<typeof setInterval> | null = null;

      const start = () => {
        void latest.current();
        timer ??= setInterval(() => void latest.current(), intervalMs);
      };

      const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
      };

      const subscription = AppState.addEventListener("change", (next) => {
        if (next === "active") start();
        else stop();
      });

      start();

      return () => {
        subscription.remove();
        stop();
      };
    }, [enabled, intervalMs]),
  );
}

const styles = StyleSheet.create({
  where: { gap: theme.space(0.75) },
  /** The answer to "where is my car". The largest thing on the screen, by intent. */
  bay: { fontSize: 34, fontWeight: "700", letterSpacing: -0.6, color: theme.colour.ink },
  whereMeta: { gap: 2, marginTop: theme.space(0.25) },
  code: { fontSize: 12.5, fontVariant: ["tabular-nums"] },

  // Side by side rather than one hero, because neither figure is the answer on
  // its own: the minutes are counted here and the money is the server's, and
  // giving one of them the whole width would suggest it was the more reliable
  // of the two.
  hero: { flexDirection: "row", gap: theme.space(1.5), paddingVertical: theme.space(1) },
  heroCell: { flex: 1, gap: theme.space(0.375) },
  figure: {
    fontSize: 30,
    fontWeight: "700",
    letterSpacing: -0.8,
    color: theme.colour.ink,
    fontVariant: ["tabular-nums"],
  },
  heroSub: { fontSize: 13 },
  clockNote: { fontSize: 12.5, lineHeight: 18, marginTop: -theme.space(0.75) },

  pay: { marginTop: "auto", gap: theme.space(1.125), paddingTop: theme.space(2) },
  balance: { textAlign: "center", fontSize: 13, marginTop: -theme.space(0.5) },

  footnote: { fontSize: 13, lineHeight: 19 },
  disclaimer: { fontSize: 12.5, lineHeight: 18, textAlign: "center" },
});
