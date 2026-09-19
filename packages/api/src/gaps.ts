import { ApiError } from "./client";

/**
 * Telling a definite refusal apart from a failure worth retrying.
 *
 * This file used to carry a second thing: a table of the routes the citizen app
 * needed and could not have, so that a screen could name the exact endpoint it
 * was waiting on. Every entry in it has since shipped. The `CITIZEN` role holds
 * `zone.read.public` and `session.read.own`, the zone, slot and tariff handlers
 * accept either of those, and the whole `/me` controller — favourites, passes,
 * wallet — carries no permission requirement at all. The table went from
 * cautious to false, and copy that outlives the gap it described is worse than
 * no copy: it tells a driver a feature "is not built" while the server is
 * answering with it. So the table is gone, along with the screens' quotes of it.
 *
 * What remains is the part that is still true. A 403 or a 404 from a server that
 * answered is a different problem from a timeout, a dead connection or a 500,
 * and the two deserve different words on screen. `gapOf` draws that one line.
 * It says nothing about whether a feature exists — only about how this call
 * failed.
 */

/**
 * How a server that answered refused the call.
 *
 * `NOT_PERMITTED` is a 403, `NOT_BUILT` a 404. Read from this side of the wire
 * neither can tell a missing route from a missing record, so neither is safe to
 * put on screen as a claim about the feature. They exist to pick which failure
 * sentence to show.
 */
export type Gap = "NOT_BUILT" | "NOT_PERMITTED";

/**
 * Classifies a failure, or returns null when it was an ordinary one.
 *
 * A timeout, a dead connection or a 500 is *not* a gap — those are transient
 * and deserve "try again". Only a definite refusal from a server that answered
 * counts, and a refusal is the one case where trying again on its own changes
 * nothing: something about this account or this record is wrong, not the line.
 */
export function gapOf(error: unknown): Gap | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 404 || error.code === "NOT_FOUND") return "NOT_BUILT";
  if (error.status === 403 || error.code === "FORBIDDEN") return "NOT_PERMITTED";
  return null;
}
