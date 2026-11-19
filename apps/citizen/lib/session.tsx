import * as React from "react";
import { Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import type { CitizenProfile } from "@kmcp/api";

import {
  api,
  initialise,
  isConfigured,
  loadTokens,
  onSignedOut,
  saveTokens,
} from "./api";

/**
 * Who is signed in, which plates are theirs, and whether there is a network.
 *
 * All three are needed on more than one screen and none of them is worth
 * fetching twice, so they are resolved once here.
 *
 * Signing in is two steps rather than one, because an OTP is: asking for a code
 * and presenting it are separate acts that fail for different reasons, and a
 * single `signIn(email, code)` would have no way to express "the code was
 * sent, now wait". `pendingEmail` is what the second screen knows.
 */

interface SessionState {
  ready: boolean;
  configured: boolean;
  user: CitizenProfile | null;
  online: boolean;
  /** The address a code was sent to, while one is outstanding. */
  pendingEmail: string | null;
  /**
   * The code, when the server volunteered it.
   *
   * Only ever populated by a development server, which returns the code it
   * generated so sign-in works without a mailbox to hand. It is shown
   * labelled as a test aid, never filled in silently — an app that signs itself
   * in is indistinguishable from one that has stopped checking.
   */
  devCode: string | null;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  cancelCode: () => void;
  signOut: () => Promise<void>;
  /** Erases the account on the server, then forgets it on this phone. */
  deleteAccount: () => Promise<void>;
}

const SessionContext = React.createContext<SessionState | null>(null);

/** One spelling of an address however it was typed — the server's too. */
export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [user, setUser] = React.useState<CitizenProfile | null>(null);
  const [online, setOnline] = React.useState(true);
  const [pendingEmail, setPendingEmail] = React.useState<string | null>(null);
  const [devCode, setDevCode] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      await initialise();
      onSignedOut(() => setUser(null));

      const tokens = await loadTokens();
      if (tokens && isConfigured()) {
        try {
          const me = await api.me.profile();
          if (!cancelled) setUser(me);
        } catch {
          // An expired session on a cold start is ordinary, and so is opening
          // the app on a train with no signal. Neither is worth an error: the
          // map works signed out, so land there and let them sign in when they
          // need to.
        }
      }
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    return unsubscribe;
  }, []);

  const requestCode = React.useCallback(async (email: string) => {
    const normalised = normaliseEmail(email);
    const result = await api.auth.requestOtp(normalised);
    setPendingEmail(normalised);
    setDevCode(result.devCode ?? null);
  }, []);

  const verifyCode = React.useCallback(
    async (code: string) => {
      if (!pendingEmail) throw new Error("No code has been requested.");

      const platform = Platform.OS === "ios" ? "ios" : "android";
      const result = await api.auth.verifyOtp(pendingEmail, code, platform);
      if (!result.tokens) {
        // The OTP path never asks for a second factor, so tokens missing here
        // means the server changed shape rather than that anything is pending.
        throw new Error("The server did not return a sign-in. Try again.");
      }

      await saveTokens(result.tokens);
      setUser(await api.me.profile());
      setPendingEmail(null);
      setDevCode(null);
    },
    [pendingEmail],
  );

  const cancelCode = React.useCallback(() => {
    setPendingEmail(null);
    setDevCode(null);
  }, []);

  const signOut = React.useCallback(async () => {
    const tokens = await loadTokens();
    if (tokens?.refreshToken) await api.auth.logout(tokens.refreshToken).catch(() => undefined);
    await saveTokens(null);
    setUser(null);
  }, []);

  const deleteAccount = React.useCallback(async () => {
    await api.me.deleteAccount();
    // Nothing to log out of: the server has already ended every session of an
    // erased account. What is left is this phone's copy of the tokens.
    await saveTokens(null);
    setUser(null);
  }, []);

  const value: SessionState = {
    ready,
    configured: isConfigured(),
    user,
    online,
    pendingEmail,
    devCode,
    requestCode,
    verifyCode,
    cancelCode,
    signOut,
    deleteAccount,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = React.useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
