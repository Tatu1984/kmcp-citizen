import { deriveAvailability } from "./availability";
import type { Availability, CachedZone, GeoPolygon, NearbyZone, Slot, SlotType } from "@kmcp/api";

/**
 * The car parks the map last fetched, kept in memory for the screen after it.
 *
 * This exists for speed, not because of a hole in the API — `GET /zones/nearby`
 * now returns a car park's name, hours, capacity, live availability and its
 * real boundary, everything the detail screen needs. Handing over what the map
 * already fetched is free; a cold start with no map fetch behind it falls
 * through to `zones.byId` (`GET /zones/:id`), which citizens may call too.
 *
 * In memory only, and deliberately. Occupancy is the whole point of these
 * figures, and a stale one sends somebody to a full car park.
 */

/**
 * What a screen needs to know about a car park, from whichever endpoint could
 * answer.
 *
 * Two shapes arrive — `NearbyZone` from the public search, `CachedZone` from
 * the guarded detail route — and they overlap almost entirely. Reconciling them
 * once here means no screen has to know which one it got.
 */
export interface ZoneView {
  id: string;
  code: string;
  name: string;
  centerLat: number;
  centerLng: number;
  capacity: number;
  openTime: string;
  closeTime: string;
  allowedVehicleTypeIds: SlotType[];
  occupied: number;
  available: number;
  availability: Availability;
  /** The real lot outline. Only ever present on the guarded route. */
  boundary: GeoPolygon | null;
}

let remembered = new Map<string, ZoneView>();

export function rememberZones(zones: NearbyZone[]): void {
  remembered = new Map(zones.map((zone) => [zone.id, fromNearby(zone)]));
}

export function recallZone(zoneId: string): ZoneView | null {
  return remembered.get(zoneId) ?? null;
}

function fromNearby(zone: NearbyZone): ZoneView {
  return {
    id: zone.id,
    code: zone.code,
    name: zone.name,
    centerLat: zone.centerLat,
    centerLng: zone.centerLng,
    capacity: zone.capacity,
    openTime: zone.openTime,
    closeTime: zone.closeTime,
    allowedVehicleTypeIds: zone.allowedVehicleTypeIds,
    occupied: zone.occupied,
    available: zone.available,
    availability: zone.availability,
    boundary: zone.boundary,
  };
}

/**
 * The guarded route's shape, reconciled.
 *
 * `CachedZone` carries occupancy only when it came from the server rather than
 * from disk, so the three live figures are optional there. When they are
 * missing the counts fall back to capacity and the verdict is derived — the
 * one place in this app that computes an availability rather than being told
 * one, and only because there is nothing else to show.
 */
export function toZoneView(zone: CachedZone): ZoneView {
  const occupied = zone.occupied ?? 0;
  const available = zone.available ?? Math.max(0, zone.capacity - occupied);
  return {
    id: zone.id,
    code: zone.code,
    name: zone.name,
    centerLat: zone.centerLat,
    centerLng: zone.centerLng,
    capacity: zone.capacity,
    openTime: zone.openTime,
    closeTime: zone.closeTime,
    allowedVehicleTypeIds: zone.allowedVehicleTypeIds,
    occupied,
    available,
    availability: zone.availability ?? deriveAvailability(available, zone.capacity),
    boundary: zone.boundary ?? null,
  };
}

/**
 * The bays the car park screen last loaded, for the bay grid one tap later.
 *
 * Both screens show the same list, and fetching it twice cost a second round
 * trip to a server on another continent. The grid draws these at once and
 * still asks the server, replacing them with its answer — so this only ever
 * saves a wait, never shows a bay status the server has not just confirmed
 * within the last minute.
 */
const SLOTS_FRESH_MS = 60_000;
const rememberedSlots = new Map<string, { at: number; slots: Slot[] }>();

export function rememberSlots(zoneId: string, slots: Slot[]): void {
  rememberedSlots.set(zoneId, { at: Date.now(), slots });
}

export function recallSlots(zoneId: string): Slot[] | null {
  const held = rememberedSlots.get(zoneId);
  if (!held || Date.now() - held.at > SLOTS_FRESH_MS) return null;
  return held.slots;
}
