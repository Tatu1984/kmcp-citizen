import * as React from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { ApiError } from "@kmcp/api";

import { Banner, Button, Card, Field, H1, Label, Screen, Sub } from "../components/ui";
import { useSession } from "../lib/session";
import { theme } from "../lib/theme";

/**
 * Signing in with an email address and a six-digit code sent to it.
 *
 * Two steps, on one screen, because they are two acts that fail for different
 * reasons: the address can be wrong, and separately the code can be wrong, and
 * telling somebody "that didn't work" without saying which would make a typo in
 * an address take three attempts to find.
 *
 * There is no password and no sign-up. The address is the account — the server
 * creates a `CITIZEN` user on the first successful verification. And, unlike
 * the attendant app, this handset is not bound to the account: an attendant's
 * login is tied to one device because that is what stops it being passed around
 * a depot, and a citizen replacing a broken phone is not a fraud case.
 */
export default function SignIn() {
  const router = useRouter();
  const { user, pendingEmail, devCode, requestCode, verifyCode, cancelCode } = useSession();

  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [expiresIn, setExpiresIn] = React.useState(0);

  /**
   * A visible countdown rather than a button that can be pressed forever.
   *
   * The server refuses a second code for the same address inside thirty
   * seconds, and more than five requests in five minutes. A person tapping
   * "resend" into that limit gets locked out of their own account for reasons
   * nothing on screen explains, so the screen counts down instead of letting
   * them.
   */
  React.useEffect(() => {
    if (expiresIn <= 0) return;
    const timer = setInterval(() => setExpiresIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [expiresIn]);

  if (user) return <Redirect href="/(tabs)" />;

  // Loose on purpose: the server decides what an address is, and whether mail
  // arrives is the only test that matters. This only stops an obvious slip.
  const canSend = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && !busy;
  const canVerify = /^\d{6}$/.test(code) && !busy;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await requestCode(email);
      setExpiresIn(30);
      setCode("");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await verifyCode(code);
      router.replace("/(tabs)");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "That code did not work. Check it and try again.",
      );
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen contentStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.brand}>Smart Parking</Text>
          <H1>Parking in Kolkata</H1>
          <Sub>
            Find a government bay, see what is free, and pay without looking for change.
          </Sub>
        </View>

        {error ? <Banner tone="crit" title={error} /> : null}

        {pendingEmail === null ? (
          <>
            <Field
              label="Email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              placeholder="you@example.com"
              maxLength={254}
              editable={!busy}
              onSubmitEditing={() => canSend && void send()}
              returnKeyType="send"
            />

            <Button
              label="Send me a code"
              onPress={() => void send()}
              disabled={!canSend}
              busy={busy}
            />

            <Sub style={styles.footnote}>
              We email you a six-digit code. No password to remember, and no account to create —
              your email address is the account.
            </Sub>
          </>
        ) : (
          <>
            <Field
              label="Six-digit code"
              value={code}
              onChangeText={(next) => setCode(next.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              placeholder="000000"
              maxLength={6}
              editable={!busy}
              autoFocus
              style={styles.codeInput}
              onSubmitEditing={() => canVerify && void verify()}
              returnKeyType="go"
              hint={`Sent to ${pendingEmail}. Check your spam folder if it is not in your inbox.`}
            />

            {/* Shown only because a development server volunteered it, and
                labelled as what it is. Filling the field in silently would
                make a broken build look like a working one. */}
            {devCode ? (
              <Banner
                tone="info"
                title={`Test code: ${devCode}`}
                body="This is a development server, so it returned the code as well as sending it."
              />
            ) : null}

            <Button
              label="Verify and sign in"
              onPress={() => void verify()}
              disabled={!canVerify}
              busy={busy}
            />

            <View style={styles.secondary}>
              <Button
                label={expiresIn > 0 ? `Send again in ${expiresIn}s` : "Send the code again"}
                variant="ghost"
                size="medium"
                onPress={() => void send()}
                disabled={expiresIn > 0 || busy}
                style={styles.grow}
              />
              <Button
                label="Different email"
                variant="ghost"
                size="medium"
                onPress={() => {
                  cancelCode();
                  setCode("");
                  setError(null);
                }}
                disabled={busy}
                style={styles.grow}
              />
            </View>
          </>
        )}

        <Card raise style={styles.vehicles}>
          <Label>Your vehicles</Label>
          <Sub style={styles.vehiclesBody}>
            Add your number plate once. We use it to find your car when an attendant starts a
            parking session for it.
          </Sub>
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colour.bg },
  content: { padding: theme.space(3), gap: theme.space(2.25) },
  header: { gap: theme.space(0.75), paddingTop: theme.space(4) },
  brand: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 2,
    color: theme.colour.primary,
  },
  footnote: { fontSize: 13, lineHeight: 19 },
  codeInput: { fontSize: 26, letterSpacing: 8, textAlign: "center" },
  secondary: { flexDirection: "row", gap: theme.space(1.125) },
  grow: { flex: 1 },
  vehicles: { marginTop: "auto" },
  vehiclesBody: { fontSize: 13.5, lineHeight: 19 },
});
