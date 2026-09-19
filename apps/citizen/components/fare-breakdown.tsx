import * as React from "react";
import { StyleSheet, View } from "react-native";
import { formatDuration, formatMoney, type MySession, type Quote } from "@kmcp/api";

import { Card, Chip, Label, Row, Sub } from "./ui";
import { theme } from "../lib/theme";

/**
 * How a parking charge was arrived at.
 *
 * This is the screen a disputed fare is settled on, which is why it is a
 * component and not a block of JSX inside one route: the parked screen shows it
 * the moment a car is released, the History screen shows it again three weeks
 * later, and the two must not be able to drift into two different accounts of
 * the same charge. The attendant app renders the same lines in the same order
 * from the same stored quote, so a driver and the person who took their money
 * are reading one document.
 *
 * Every figure here is the server's. Nothing on this page is computed on the
 * handset — not the tax, not the total, and not the percentage the tax is
 * labelled with.
 */

/**
 * The full calculation, line by line, from a `Quote` the server stands behind.
 *
 * Used for a settled session's stored `fareBreakdown` and for a live session's
 * provisional quote, because they are the same shape and the same engine
 * produced both. What differs is the title and the note, which is the caller's
 * job: this component will not decide for you whether a number is final.
 */
export function FareBreakdown({
  quote,
  title = "How this is worked out",
  note,
  totalLabel = "Total",
}: {
  quote: Quote;
  title?: string;
  note?: string;
  totalLabel?: string;
}) {
  const flags = quote.waivedByPass || quote.cappedByDailyLimit;

  return (
    <Card>
      <Label>{title}</Label>
      {note ? <Sub style={styles.note}>{note}</Sub> : null}

      {/* The tariff's own lines, in the order the engine produced them — a
          base charge, then each increment or peak rule that applied. Rendered
          verbatim and never reordered or merged: the labels are written
          server-side precisely so that a driver and an attendant can point at
          the same one. */}
      <View style={styles.rows}>
        {quote.lines.map((line, index) => (
          <Row key={`${line.code}-${index}`} label={line.label} value={formatMoney(line.amount)} />
        ))}

        {quote.discountAmount > 0 ? (
          <Row label="Discount" value={`− ${formatMoney(quote.discountAmount)}`} />
        ) : null}
        {quote.penaltyAmount > 0 ? (
          <Row label="Overstay penalty" value={formatMoney(quote.penaltyAmount)} />
        ) : null}
        {/* The rate comes from the quote, never from a constant here. GST on
            parking is 18% today and has been other numbers before; a hardcoded
            18 would keep printing "18%" beside an amount worked out at some
            other rate, which is the one thing a tax line must never do. */}
        {quote.taxAmount > 0 ? (
          <Row label={`Tax (${quote.taxPercent}%)`} value={formatMoney(quote.taxAmount)} />
        ) : null}

        <Row label={totalLabel} value={formatMoney(quote.payableAmount)} emphasis last />
      </View>

      {flags ? (
        <View style={styles.chips}>
          {quote.waivedByPass ? <Chip tone="good" label="Covered by your pass" /> : null}
          {quote.cappedByDailyLimit ? <Chip tone="good" label="Daily cap applied" /> : null}
        </View>
      ) : null}

      <Sub style={styles.tariff}>{tariffLine(quote)}</Sub>
    </Card>
  );
}

/**
 * What a session came to, when the server kept no record of how.
 *
 * `fareBreakdown` is null on a session that was never priced — a cancelled one
 * — and on completed rows recorded before the breakdown was persisted. The
 * amounts are still there, so they are shown; what is not done is dressing four
 * columns up as a calculation. A "Parking" line invented from `grossAmount`
 * would look exactly like a real tariff line and could not be checked against
 * anything, and a driver who later found the real breakdown did not agree with
 * it would be right to stop trusting the rest of this screen.
 */
export function FareTotals({
  session,
  title = "What this came to",
  totalLabel = "Total",
}: {
  session: MySession;
  title?: string;
  totalLabel?: string;
}) {
  const nothingCharged = session.payableAmount === null && session.grossAmount === null;

  return (
    <Card>
      <Label>{title}</Label>

      {nothingCharged ? (
        <Sub style={styles.note}>
          Nothing was charged for this session, so there is no calculation behind it.
        </Sub>
      ) : (
        <>
          <Sub style={styles.note}>
            This session was recorded before the calculation behind a fare was kept, so these are
            the amounts it was charged — not the lines they were built from.
          </Sub>

          <View style={styles.rows}>
            {session.grossAmount !== null ? (
              <Row label="Parking before tax" value={formatMoney(session.grossAmount)} />
            ) : null}
            {session.discountAmount > 0 ? (
              <Row label="Discount" value={`− ${formatMoney(session.discountAmount)}`} />
            ) : null}
            {session.penaltyAmount > 0 ? (
              <Row label="Overstay penalty" value={formatMoney(session.penaltyAmount)} />
            ) : null}
            {/* No percentage beside this one, because this session carries no
                record of the rate it was worked out at. */}
            {session.taxAmount > 0 ? (
              <Row label="Tax" value={formatMoney(session.taxAmount)} />
            ) : null}
            <Row label={totalLabel} value={formatMoney(session.payableAmount)} emphasis last />
          </View>

          {session.durationMinutes !== null ? (
            <Sub style={styles.tariff}>
              Charged on {formatDuration(session.durationMinutes)}.
            </Sub>
          ) : null}
        </>
      )}
    </Card>
  );
}

/**
 * The line that settles an argument.
 *
 * Almost every dispute about a parking charge is a dispute about the grace
 * period: the driver counts from the minute they arrived, the tariff counts from
 * the minute the free ones ran out, and the two numbers are different. Printing
 * both — what the car was parked for, and what it was charged for — is what
 * lets that be reconciled at the kerb instead of over a phone call.
 */
function tariffLine(quote: Quote): string {
  const parked = formatDuration(quote.durationMinutes);
  const charged = formatDuration(quote.chargeableMinutes);
  const grace =
    quote.gracePeriodMin > 0 ? `, after ${formatDuration(quote.gracePeriodMin)} free` : "";
  return `${quote.tariffName} · charged on ${charged} of ${parked} parked${grace}`;
}

const styles = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 19 },

  // Gap zero so the rows' own hairlines meet, rather than the card's gap
  // opening a gutter between each line of a calculation that should read as
  // one block.
  rows: { gap: 0 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.space(0.75) },
  tariff: { fontSize: 12.5, lineHeight: 18 },
});
