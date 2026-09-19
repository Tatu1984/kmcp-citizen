import * as React from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { type MySession } from "@kmcp/api";

import { Banner, Button, Card, Label, Loading, Screen, Sub } from "../components/ui";
import { ClaimSession, codeFromScan, useClaim } from "../components/claim-session";
import { useSession } from "../lib/session";
import { theme } from "../lib/theme";

/**
 * Pointing the camera at the code on the attendant's screen.
 *
 * An attendant parks the car and their app puts the session code up as a QR
 * code; this reads it and claims the session, which is the same thing typing
 * the code does and is the reason there is no second request in here. The
 * driver standing at a barrier in the sun, holding a phone in one hand, should
 * not be asked to transcribe six characters off somebody else's screen.
 *
 * Nothing about the camera is treated as an error. A refused camera is an
 * ordinary answer — some people never grant it, and a government app is the
 * last one that should argue — so the refusal states below all keep the typed
 * code on screen underneath. There is no path through this screen that ends in
 * somebody stuck, which is the whole point of it existing alongside the field
 * rather than instead of it.
 */
export default function Scan() {
  const router = useRouter();
  const { user } = useSession();

  // Requested on mount rather than behind another button: the only way onto
  // this screen is tapping "Scan the QR code", so the permission sheet is the
  // expected next thing rather than an interruption. Already-granted and
  // permanently-denied both resolve without showing anything.
  const [permission, requestPermission] = useCameraPermissions({ request: true });

  const [notACode, setNotACode] = React.useState(false);

  /**
   * Straight to the car, and `replace` so that going back from it lands on
   * whatever sent them here rather than on a camera pointed at nothing.
   *
   * The same destination the typed code has always had — a claim takes
   * ownership of the plate as well as returning the session, so from here on
   * this car finds itself.
   */
  const onClaimed = React.useCallback(
    (claimed: MySession) => {
      router.replace(`/parked/${claimed.plateNumber}`);
    },
    [router],
  );

  const { claim, busy, refusal, setRefusal } = useClaim(onClaimed);

  /**
   * Two latches, because `onBarcodeScanned` fires for every frame a code is in
   * view — tens of times a second, for as long as the phone is held still.
   *
   * `claiming` is the one that matters: without it a single QR code held in
   * front of the lens becomes dozens of claim requests before the first one
   * answers. It closes on the first accepted code and opens again only when
   * that attempt has resolved, and never on success, because by then the
   * screen is already being replaced.
   *
   * `handled` stops the other repeat. A payload that has been dealt with —
   * claimed, refused, or rejected here as not a parking code — is ignored
   * until a different one comes into frame, so a receipt lying on the
   * passenger seat produces one message rather than a flicker. Keying it on
   * the payload rather than on a timer is what lets the driver simply move the
   * phone onto the right code and have it work, with nothing to dismiss.
   */
  const claiming = React.useRef(false);
  const handled = React.useRef<string | null>(null);

  const onScanned = React.useCallback(
    ({ data }: { data: string }) => {
      if (claiming.current || data === handled.current) return;
      handled.current = data;

      const code = codeFromScan(data);
      if (!code) {
        setNotACode(true);
        return;
      }

      setNotACode(false);
      claiming.current = true;
      void claim(code).finally(() => {
        claiming.current = false;
      });
    },
    [claim],
  );

  /** Lets the same code be tried again after a refusal that trying again can fix. */
  const scanAgain = React.useCallback(() => {
    handled.current = null;
    setNotACode(false);
    setRefusal(null);
  }, [setRefusal]);

  if (!user) {
    return (
      <Screen>
        <Card raise>
          <Label>Sign in first</Label>
          <Sub style={styles.body}>
            A claimed session is attached to an account, so we need to know whose car this is
            before the code means anything.
          </Sub>
        </Card>
        <Button label="Sign in" onPress={() => router.push("/sign-in")} />
      </Screen>
    );
  }

  if (!permission) return <Loading label="Checking the camera" />;

  if (!permission.granted) {
    return (
      <Screen>
        <Card raise>
          <Label>The camera is not available</Label>
          <Sub style={styles.body}>
            {permission.canAskAgain
              ? "This app cannot use the camera, so there is nothing to scan with. Nothing is recorded or sent when it is on — the picture is only read for a code and thrown away."
              : "The camera has been turned off for this app, which can only be changed in your phone's settings. It is not needed: the code underneath does exactly the same thing."}
          </Sub>
        </Card>

        {permission.canAskAgain ? (
          <Button label="Allow the camera" onPress={() => void requestPermission()} />
        ) : null}

        {/* The way through, always. A refused camera must not be a dead end —
            the code on the ticket was the original door and still works. */}
        <ClaimSession onClaimed={onClaimed} title="Type the code instead" scan={false} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card raise>
        <Label>Scan the attendant's screen</Label>
        <Sub style={styles.body}>
          Hold the code inside the square. It claims the session the moment it reads, and registers
          the number plate to your account with it.
        </Sub>
      </Card>

      <View style={styles.stage}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScanned}
        />

        {/* A sibling and not a child: `CameraView` renders a native preview
            surface and anything nested inside it is dropped on the floor. The
            reticle is decoration, so it must not swallow taps either. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.reticle} />
        </View>
      </View>

      {busy ? <Banner tone="info" title="Found a code — claiming that session" /> : null}

      {refusal ? (
        <>
          <Banner tone="crit" title={refusal.title} body={refusal.body} />
          <Button label="Scan again" variant="ghost" size="medium" onPress={scanAgain} />
        </>
      ) : notACode ? (
        <Banner
          tone="warn"
          title="That is not a KMCP parking code"
          body="Whatever that code is, it is not one of ours. The session code starts with KMCP — ask the attendant to show you the one for your car."
        />
      ) : null}

      {/* Kept underneath rather than on another screen: a camera that focuses
          but never reads is the failure nobody can diagnose at a barrier, and
          the answer to it should be one scroll away. */}
      <ClaimSession onClaimed={onClaimed} title="Or type the code" scan={false} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 13.5, lineHeight: 20 },

  /**
   * Square, and framed like a card rather than bled to the edges. A full-screen
   * viewfinder would leave nowhere for the typed code to live, and this screen
   * is only useful because that is always one scroll below it.
   */
  stage: {
    aspectRatio: 1,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colour.ink,
    overflow: "hidden",
  },
  reticle: {
    alignSelf: "center",
    marginTop: "18%",
    width: "64%",
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: theme.colour.bg,
    borderRadius: theme.radius.md,
  },
});
