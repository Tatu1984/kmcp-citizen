import * as React from "react";
import { AppState } from "react-native";

/**
 * A clock the screens can read.
 *
 * Every elapsed figure the API sends is an integer worked out when the row was
 * serialised, so a duration rendered straight from it sits frozen at "43m"
 * until something refetches. On the attendant's handset that is merely
 * unhelpful; here it is the whole screen. A driver who opens this app is
 * watching their own car's timer, and a timer that does not move is a timer
 * they assume is broken — followed by a refresh, and then a doubt about the
 * fare beside it. So this holds the current time as state and lets each screen
 * derive its own durations from `startAt`: one interval keeps a whole screen
 * honest rather than one timer per card.
 *
 * Two things it deliberately does not do.
 *
 * It does not decide whether a car is overstaying. That threshold is zone
 * configuration held on the server, and a handset that guessed at it would warn
 * a driver about a penalty the server is not charging — or, worse, stay quiet
 * about one it is. `isOverstay` from the API remains the only authority; only
 * the displayed duration comes from here.
 *
 * And it does not price anything. The minutes on screen are counted here and
 * labelled as counted here; the money beside them is always the server's, asked
 * for over `GET /sessions/:id/quote`. This is the same division the attendant
 * app runs on and the reason a disputed charge can be reconciled at all.
 */

/**
 * Fifteen seconds.
 *
 * The finest thing any of these displays renders is a whole minute, so a
 * one-second tick would spend sixty renders to change one glyph — and on this
 * app the thing being re-rendered may be sitting on top of a live map. Fifteen
 * bounds how stale a minute label can get to a quarter of the minute it is
 * showing, which is well inside what someone glancing between their phone and
 * their watch would notice, at four renders a minute.
 */
const TICK_MS = 15_000;

/**
 * The current time, moving.
 *
 * `active` exists so a screen that has no live session — the map, most of the
 * time — is not paying for a timer it has nothing to show from.
 */
export function useNow(active = true): number {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      // Catch up before the first tick. A phone that spent the walk back to the
      // car in a pocket would otherwise show the time it was put away for up to
      // fifteen seconds after it comes back out, which is precisely the moment
      // the number is being read most carefully.
      setNow(Date.now());
      timer ??= setInterval(() => setNow(Date.now()), TICK_MS);
    };

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    // Nothing reads a clock on a screen that is off, and a timer firing in a
    // pocket is battery spent for nobody — which matters more here than on a
    // depot handset, because this app is on a phone the owner also needs to
    // last the day.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") start();
      else stop();
    });

    // Started outright rather than gated on `AppState.currentState`: this hook
    // runs because a screen is being rendered, and the platform reports
    // "unknown" often enough at mount that checking it would leave the clock
    // stopped until the app was next backgrounded and reopened.
    start();

    return () => {
      subscription.remove();
      stop();
    };
  }, [active]);

  return now;
}

/**
 * Minutes between a server timestamp and a moment on this handset.
 *
 * Floored, because 43m59s is "43m" everywhere else in this platform and a
 * duration that rounded up would show a driver a minute they have not used —
 * next to a fare, that reads as being charged for it. Clamped at zero, because
 * a phone whose clock is behind the server's would otherwise report a negative
 * duration for a car that has only just been parked. Null when either end of
 * the arithmetic is unusable, so the caller can fall back to the server's own
 * figure rather than render a confident nonsense.
 */
export function elapsedMinutesSince(startAt: string, now: number): number | null {
  const started = Date.parse(startAt);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - started) / 60_000));
}
