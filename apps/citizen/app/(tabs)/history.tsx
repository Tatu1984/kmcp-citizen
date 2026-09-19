import * as React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ApiError,
  formatDuration,
  formatMoney,
  gapOf,
  type MySession,
  type MySpendSummary,
} from "@kmcp/api";

import { Banner, Button, Card, Chip, Empty, Label, Loading, Screen, Sub } from "../../components/ui";
import { FareBreakdown, FareTotals } from "../../components/fare-breakdown";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { theme } from "../../lib/theme";

/**
 * What you have paid for parking, and why.
 *
 * The monthly total is the server's or it is absent. A figure added up here
 * from whatever happened to be fetched would disagree with the receipts the
 * moment a page boundary or a refund got involved, and a person checking their
 * own spending is the last audience to hand a number that is nearly right.
 *
 * Each row opens onto the calculation behind it — the same lines, in the same
 * order, from the same stored quote that the attendant's handset showed at the
 * kerb. A total with nothing behind it is the thing a driver disputes; the
 * breakdown is what answers them, and it is a shared component precisely so
 * that this screen and the parked screen cannot tell two stories about one
 * charge.
 *
 * This screen used to tell citizens their history "is not readable yet" and
 * name the route that would fix it. All of those routes exist now. Copy like
 * that outliving the gap it described is worse than no copy at all: it tells
 * somebody their money is unaccounted for while the server is answering with
 * the account.
 */
export default function History() {
  const router = useRouter();
  const { user } = useSession();

  const [sessions, setSessions] = React.useState<MySession[] | null>(null);
  const [summary, setSummary] = React.useState<MySpendSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async (): Promise<void> => {
    const [sessionsResult, summaryResult] = await Promise.allSettled([
      api.me.sessions("COMPLETED"),
      api.me.summary(),
    ]);

    if (sessionsResult.status === "fulfilled") setSessions(sessionsResult.value);
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);

    if (sessionsResult.status === "rejected") {
      // `gapOf` still earns its keep: a definite refusal from a server that
      // answered is a different problem from a dead connection, and only one of
      // them is worth trying again. What it no longer means is "not built".
      const reason = sessionsResult.reason;
      setError(
        gapOf(reason)
          ? "Your parking could not be read for this account. Signing in again usually fixes it."
          : reason instanceof ApiError
            ? reason.message
            : "Could not load your parking history. Check your connection and try again.",
      );
    } else {
      setError(null);
    }

    setLoading(false);
  }, []);

  // On focus, not just on mount: a session that ended while this tab was open
  // behind the map would otherwise never appear, and the walk from the parked
  // screen to this one is exactly when somebody looks for it.
  useFocusEffect(
    React.useCallback(() => {
      if (!user) {
        setLoading(false);
        return;
      }
      let cancelled = false;
      void (async () => {
        if (!cancelled) await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [user, load]),
  );

  if (!user) {
    return (
      <Screen>
        <Card raise>
          <Label>Sign in first</Label>
          <Sub style={styles.body}>
            Your parking history belongs to your account. Sign in with your mobile number to see it.
          </Sub>
        </Card>
        <Button label="Sign in" onPress={() => router.push("/sign-in")} />
      </Screen>
    );
  }

  if (loading) return <Loading label="Loading your parking" />;

  return (
    <Screen>
      {error ? (
        <>
          <Banner tone="crit" title="Could not load your parking" body={error} />
          <Button label="Try again" variant="ghost" size="medium" onPress={() => void load()} />
        </>
      ) : null}

      {/* --------------------------------------------------- this month */}
      {summary ? (
        <Card raise style={styles.summary}>
          <View>
            <Label>This month</Label>
            <Text style={styles.summaryValue}>{formatMoney(summary.totalPaid)}</Text>
          </View>
          <View style={styles.summaryRight}>
            <Label>Sessions</Label>
            <Text style={styles.summaryValue}>{summary.sessions}</Text>
          </View>
        </Card>
      ) : (
        <Card raise>
          <Label>This month</Label>
          <Sub style={styles.body}>
            The monthly total could not be fetched. It is deliberately not added up on this phone —
            a figure that disagrees with your receipts is worse than no figure.
          </Sub>
        </Card>
      )}

      {/* ------------------------------------------------------ sessions */}
      {sessions === null ? null : sessions.length === 0 ? (
        <Empty
          title="No parking yet"
          body="When an attendant starts a session for one of your vehicles, it appears here with its receipt once it is paid."
        />
      ) : (
        sessions.map((session) => <SessionCard key={session.id} session={session} />)
      )}
    </Screen>
  );
}

/**
 * One past session: where, when, how long, what it came to — and, on a tap, how
 * that total was reached.
 *
 * Collapsed by default because most rows are never questioned, and a screen of
 * open calculations is a screen nobody reads. The tap target is the whole card,
 * so the affordance costs no chrome.
 */
function SessionCard({ session }: { session: MySession }) {
  const [open, setOpen] = React.useState(false);

  const refunded = session.refundedAmount > 0;
  const cancelled = session.status === "CANCELLED";

  const when = new Date(session.startAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

  /**
   * `durationMinutes` first, because on a priced session that is the span the
   * fare was charged on and therefore the honest thing to print next to the
   * amount. `elapsedMinutes` covers the rows that were never priced — a
   * cancelled session, and older completed ones — where it is the wall clock
   * and the only duration there is.
   */
  const span =
    session.endAt === null
      ? "still parked"
      : `${time(session.startAt)}–${time(session.endAt)} · ${formatDuration(
          session.durationMinutes ?? session.elapsedMinutes,
        )}`;

  return (
    <>
      <Card
        onPress={() => setOpen((current) => !current)}
        accessibilityLabel={`${session.zone.name}, ${when}, ${formatMoney(session.payableAmount)}. ${
          open ? "Hide" : "Show"
        } how this was worked out.`}
      >
        <View style={styles.sessionHead}>
          <View style={styles.sessionText}>
            <Text style={styles.sessionName} numberOfLines={1}>
              {session.zone.name}
            </Text>
            <Text style={styles.sessionMeta} numberOfLines={1}>
              {when} · {cancelled ? "cancelled" : span}
              {session.slot ? ` · bay ${session.slot.code}` : ""}
            </Text>
          </View>
          <View style={styles.sessionRight}>
            <Text style={[styles.sessionAmount, refunded && styles.sessionAmountRefunded]}>
              {formatMoney(refunded ? session.refundedAmount : session.payableAmount)}
            </Text>
            {refunded ? (
              <Chip tone="good" label="Refunded" />
            ) : session.receipt ? (
              <Chip label="Receipt" />
            ) : null}
          </View>
        </View>

        {session.receipt ? (
          <Sub style={styles.receipt}>Receipt {session.receipt.number}</Sub>
        ) : null}

        <Sub style={styles.expand}>
          {open ? "Hide the calculation" : "How was this worked out?"}
        </Sub>
      </Card>

      {open ? (
        session.fareBreakdown ? (
          <FareBreakdown quote={session.fareBreakdown} title="How this was worked out" />
        ) : (
          <FareTotals session={session} />
        )
      ) : null}
    </>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

const styles = StyleSheet.create({
  body: { fontSize: 13.5, lineHeight: 20 },

  summary: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryRight: { alignItems: "flex-end" },
  summaryValue: {
    fontSize: 24,
    fontWeight: "700",
    color: theme.colour.ink,
    fontVariant: ["tabular-nums"],
  },

  sessionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.space(1.25),
  },
  sessionText: { flex: 1, gap: 2 },
  sessionName: { fontSize: 16, fontWeight: "700", color: theme.colour.ink },
  sessionMeta: { fontSize: 13, color: theme.colour.muted },
  sessionRight: { alignItems: "flex-end", gap: theme.space(0.5) },
  sessionAmount: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colour.ink,
    fontVariant: ["tabular-nums"],
  },
  sessionAmountRefunded: { color: theme.colour.good },

  receipt: { fontSize: 12.5 },
  expand: { fontSize: 12.5, fontWeight: "600", color: theme.colour.primary },
});
