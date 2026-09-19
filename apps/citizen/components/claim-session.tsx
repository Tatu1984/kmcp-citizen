import * as React from "react";
import { StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ApiError, type MySession } from "@kmcp/api";

import { Banner, Button, Card, Field, Label, Sub } from "./ui";
import { api } from "../lib/api";

/**
 * Claiming a parking session from the code an attendant can read out.
 *
 * The app finds "your car" by matching a registered plate against the sessions
 * attendants have started, which leaves one person with no way in at all: the
 * driver who never registered a plate, or registered it with a typo, or whose
 * attendant typed it with one. Their bay, their timer and their fare all exist
 * on the server and belong to nobody, and until now the app's answer was an
 * empty screen.
 *
 * The code on the ticket is the way in, because it is the one thing the person
 * standing at the car can definitely read. It is also why this is a component
 * rather than a screen: it is mounted wherever somebody gets stuck — the dead
 * end on the parked screen, and the garage they are sent to when they have no
 * plate at all — and the three refusals below are written once instead of
 * drifting into two versions of the same bad news.
 *
 * There are two doors onto that code now. The attendant's app shows it as a QR
 * code, so pointing a camera at it is the ordinary way in and typing it is what
 * is left when the camera is refused or will not focus. Both go through
 * `useClaim`, and deliberately so: two doors onto one request is a shared path
 * with a second entrance, whereas two requests would be two sets of refusal
 * copy that agree today and disagree in six months.
 */
export function ClaimSession({
  onClaimed,
  title = "Parked already? Use the code",
  scan = true,
}: {
  onClaimed: (session: MySession) => void;
  title?: string;
  /** Off on the scanner itself, where a button back to the camera is a loop. */
  scan?: boolean;
}) {
  const router = useRouter();
  const [input, setInput] = React.useState("");
  const { claim, busy, refusal } = useClaim(onClaimed);

  const code = normaliseCode(input);

  const submit = React.useCallback(() => {
    if (code) void claim(code);
  }, [code, claim]);

  return (
    <Card>
      <Label>{title}</Label>
      <Sub style={styles.body}>
        The attendant can read out the code on your ticket, or show you the QR code that carries
        it. Claiming it also registers the number plate to your account, so the next time this car
        is parked it shows up here on its own.
      </Sub>

      <Field
        label="Session code"
        value={input}
        onChangeText={setInput}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="KMCP-8F3K2Q"
        maxLength={16}
        style={styles.input}
        onSubmitEditing={submit}
        returnKeyType="done"
        hint="Six characters after the dash."
      />

      <Button label="Find this session" disabled={!code} busy={busy} onPress={submit} />

      {scan ? (
        <Button
          label="Scan the QR code instead"
          variant="ghost"
          size="medium"
          disabled={busy}
          onPress={() => router.push("/scan")}
        />
      ) : null}

      {refusal ? <Banner tone="crit" title={refusal.title} body={refusal.body} /> : null}
    </Card>
  );
}

/** What went wrong, and what the driver can do about it. */
export type Refusal = { title: string; body: string };

/**
 * The one path a session code takes, whichever door it came through.
 *
 * Typing a code and scanning it are two ways of reading the same characters off
 * the same ticket, so they get one request and one set of refusals. The moment
 * each has its own, they start telling two stories about one bad code — and the
 * expired-ticket and wrong-account cases below are precisely the ones somebody
 * would forget to copy across.
 *
 * Resolves true when the session was claimed. The scanner needs that answer:
 * it latches the camera shut on the first accepted code and only opens it again
 * when this comes back false.
 */
export function useClaim(onClaimed: (session: MySession) => void) {
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<Refusal | null>(null);

  const claim = React.useCallback(
    async (code: string): Promise<boolean> => {
      if (busy) return false;
      setRefusal(null);
      setBusy(true);
      try {
        onClaimed(await api.me.claimSession(code));
        return true;
      } catch (cause) {
        setRefusal(refusalFor(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, onClaimed],
  );

  return { claim, busy, refusal, setRefusal };
}

/**
 * The code, however it was read out.
 *
 * Somebody reading a ticket aloud says the six characters; somebody copying it
 * types the lot, with or without the dash, in whatever case the keyboard gave
 * them. All of that is the same code and none of it should be a refusal — the
 * server matches on the stored string exactly, so putting it back together is
 * this function's job and not the driver's.
 *
 * The prefix is only stripped when there is more than a code's worth of
 * characters in front of it. A body can legitimately begin with those four
 * letters, and a blind `startsWith` would eat them and then refuse the valid
 * code it had just mangled.
 *
 * Null until there are enough characters to be worth sending. Deliberately a
 * length test and nothing more: the alphabet is the server's business, and a
 * validator here that were stricter than the generator would lock somebody out
 * of their own car over a character it had not been told about.
 */
function normaliseCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = clean.length > 6 && clean.startsWith("KMCP") ? clean.slice(4) : clean;
  return body.length >= 6 ? `KMCP-${body}` : null;
}

/**
 * The code out of whatever a QR code actually decoded to, or null.
 *
 * The attendant's app renders the bare code — `KMCP-7PD3RV` — and that is the
 * case worth being sure of. The rest of this is tolerance for the payload
 * drifting later: a decoder that hands back a trailing newline, or a build that
 * wraps the code in a link so the QR also works for somebody without the app.
 * Pulling the code out of those is cheaper than a driver standing at a barrier
 * being told their ticket is not a ticket.
 *
 * Null is the other half of the job, and the reason this is not just a search
 * for six characters: a camera pointed at the world reads receipts, packaging
 * and posters, and every one of those would otherwise be sent to the server as
 * a claim and come back as a refusal about a code the driver never typed. The
 * `KMCP` prefix is the one thing that tells a parking code from the rest of it,
 * so it is required, and a payload without it is refused here by name.
 *
 * The separator is optional only when the code is the whole payload. Inside a
 * longer string it is required, because without it `kmcparking.example.com`
 * reads as a code — and a scanner that turns a domain name into a claim is
 * worse than one that asks for six characters.
 */
export function codeFromScan(payload: string): string | null {
  const text = payload.trim();

  // The separator is required here, not optional, even when the code is the
  // whole payload. `generateSessionCode` always emits `KMCP-` with the dash, so
  // no QR this app is meant to read can lack one — while making it optional let
  // any `KMCP`-initial string through: `KMCPARKING7PD3RV` came back as the code
  // `KMCP-ARKING7PD3RV` and went to the server as a real claim. Typing stays
  // forgiving; `normaliseCode`, which the manual field uses directly, still
  // accepts a dashless code from someone reading one off a ticket.
  if (/^KMCP[-_ ][A-Z0-9]{6,}$/i.test(text)) return normaliseCode(text);

  const carried = /(?:^|[^A-Z0-9])(KMCP[-_ ][A-Z0-9]{6,})/i.exec(text);
  return carried ? normaliseCode(carried[1]!) : null;
}

/**
 * Each refusal in words the driver can act on.
 *
 * The server distinguishes three, and they want three different things done
 * about them — check the characters, register the plate instead, or sort out
 * whose account the car is on. Collapsing them into "that didn't work" would
 * leave somebody retyping a code that is never going to be accepted.
 */
function refusalFor(cause: unknown): Refusal {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case "NOT_FOUND":
        return {
          title: "That code isn't recognised",
          body: "Check the six characters after the dash and ask the attendant to read them out again — a single character read wrong is the usual cause.",
        };
      case "SESSION_NOT_ACTIVE":
        return {
          title: "That code has expired",
          body: "A code works while the car is parked and for a few hours after it leaves. Add the number plate to your account instead: the history follows the plate, so this session comes with it.",
        };
      case "DUPLICATE_RESOURCE":
        return {
          title: "That plate is already registered to another account",
          body: "We will not say which one. If the car is yours, remove the plate from that account first, or sign in as that account instead.",
        };
      default:
        return { title: "That code could not be used", body: cause.message };
    }
  }
  return {
    title: "That code could not be used",
    body: "The server could not be reached. Check your connection and try again.",
  };
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 19 },
  input: { fontSize: 20, letterSpacing: 1.5 },
});
