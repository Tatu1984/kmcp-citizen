import * as React from "react";
import { Alert, Linking, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { ApiError } from "@kmcp/api";

import { Banner, Button, Card, Label, Row, Screen, Sub } from "../../components/ui";
import { PRIVACY_POLICY_URL } from "../../lib/links";
import { useSession } from "../../lib/session";
import { theme } from "../../lib/theme";

/**
 * Who is signed in, the privacy policy, and the way out — signing out, or
 * deleting the account outright.
 *
 * Deleting is here, in the app, and not only an email address in the policy,
 * because both stores require an account created in the app to be deletable
 * from it. It is behind one confirmation that says what goes and what stays:
 * the server keeps the sessions and payments as tax records with nothing that
 * identifies the person, and somebody deleting their account deserves to know
 * that before they press the button, not after.
 *
 * The privacy policy is reachable signed out too, since it is most useful to
 * somebody deciding whether to sign in at all.
 */
export default function Account() {
  const router = useRouter();
  const { user, signOut, deleteAccount } = useSession();
  const [busy, setBusy] = React.useState<"signOut" | "delete" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const privacy = (
    <Button
      label="Privacy policy"
      variant="ghost"
      size="medium"
      onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
    />
  );

  if (!user) {
    return (
      <Screen>
        <Card raise>
          <Label>Not signed in</Label>
          <Sub style={styles.body}>
            Sign in with your email address to see your account, your vehicles and your parking.
          </Sub>
        </Card>
        <Button label="Sign in" onPress={() => router.push("/sign-in")} />
        {privacy}
      </Screen>
    );
  }

  const named = Boolean(user.name && user.name !== "Citizen");

  async function runSignOut() {
    setBusy("signOut");
    setError(null);
    try {
      await signOut();
    } finally {
      setBusy(null);
    }
  }

  async function runDelete() {
    setBusy("delete");
    setError(null);
    try {
      await deleteAccount();
      Alert.alert("Account deleted", "Your account and the personal data linked to it have been deleted.");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not reach the server. Check your connection and try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Delete your account?",
      "Your email address, name, vehicles and sign-in history are deleted, and you are signed out " +
        "on every phone. Your past parking sessions and payments are kept as tax records, without " +
        "anything that identifies you. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete account", style: "destructive", onPress: () => void runDelete() },
      ],
    );
  }

  return (
    <Screen>
      {error ? <Banner tone="crit" title={error} /> : null}

      <Card raise>
        <Label>Signed in as</Label>
        <Row label="Email" value={user.email ?? "—"} last={!named} />
        {named ? <Row label="Name" value={user.name} last /> : null}
      </Card>

      {privacy}

      <Button
        label="Sign out"
        variant="dark"
        onPress={() => void runSignOut()}
        busy={busy === "signOut"}
        disabled={busy !== null}
      />

      <Card style={styles.danger}>
        <Label>Delete account</Label>
        <Sub style={styles.body}>
          Permanently delete your account and the personal data linked to it.
        </Sub>
        <Button
          label="Delete my account"
          variant="ghost"
          size="medium"
          onPress={confirmDelete}
          busy={busy === "delete"}
          disabled={busy !== null}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 13.5, lineHeight: 19, marginTop: theme.space(0.5) },
  danger: { marginTop: theme.space(2), gap: theme.space(1) },
});
