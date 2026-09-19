import * as React from "react";
import { Pressable, StyleSheet } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { NearbyZone } from "@kmcp/api";

import { availabilityColour } from "../lib/availability";
import type { Fix } from "../lib/location";
import { theme } from "../lib/theme";

/**
 * The map of car parks.
 *
 * Leaflet, over OpenStreetMap tiles, inside a `WebView` — the same "host the
 * real web SDK, talk to it over `postMessage`" idiom `components/razorpay-
 * checkout.tsx` already uses for the gateway checkout, applied to a map
 * instead of a payment sheet. This replaced a `react-native-maps` (Google
 * Maps on Android) implementation that needed a paid-tier API key and a
 * custom native build just to render — OpenStreetMap needs neither, so the
 * map works in plain Expo Go, for every citizen, with no key to configure,
 * expire, or bill against.
 *
 * The page loads once and is never reloaded: zones, the selection and the
 * centre are pushed into the already-running page with `injectJavaScript`
 * after it signals it is ready, rather than by re-rendering `source.html` —
 * a full reload would flash blank and lose the person's pan/zoom on every
 * nearby-zones refresh.
 *
 * **The footprint.** Each car park draws its real GeoJSON boundary when one
 * exists, falling back to a small, deliberately modest circle at the centre
 * point when it does not — the circle says "the car park is here" and does
 * not pretend to be the shape or size of anything.
 *
 * **The badge.** Every car park carries its free-bay count on the pin, which
 * is what a driver actually reads; colour is a second channel on the same
 * fact, never the only one.
 *
 * One trade against `react-native-maps`: a screen reader cannot read out a
 * WebView-hosted Leaflet marker the way it could a native one, so the badge
 * text itself — not just its colour — is what has to carry the information,
 * same as before.
 */

export function ParkMap({
  centre,
  zones,
  selectedId,
  onSelect,
  followsUser,
}: {
  centre: Fix;
  zones: NearbyZone[];
  selectedId: string | null;
  onSelect: (zoneId: string) => void;
  /** False when we are showing the city centre rather than the person. */
  followsUser: boolean;
}) {
  const webviewRef = React.useRef<WebView>(null);
  const ready = React.useRef(false);

  const html = React.useMemo(() => buildMapHtml(centre), []); // eslint-disable-line react-hooks/exhaustive-deps

  const push = React.useCallback((script: string) => {
    webviewRef.current?.injectJavaScript(`${script}; true;`);
  }, []);

  const recenter = React.useCallback(() => {
    push(`window.__recenter(${centre.lat}, ${centre.lng})`);
  }, [push, centre.lat, centre.lng]);

  // The page loads centred on whatever `centre` was at the moment it was
  // built — usually the Kolkata fallback, since a real GPS fix rarely lands
  // before the first paint. Once the live fix comes in, this snaps the view
  // to it exactly once, the same courtesy `showsUserLocation` gave for free
  // on the native map this replaced; after that first snap, the person is
  // trusted to pan the map themselves, and the button above is how they get
  // back.
  const autoRecentred = React.useRef(false);

  const pushState = React.useCallback(() => {
    push(
      `window.__setZones(${JSON.stringify(zones.map(toMapZone))}, ${JSON.stringify(selectedId)})`,
    );
    push(`window.__setUser(${followsUser ? JSON.stringify({ lat: centre.lat, lng: centre.lng }) : "null"})`);
    if (followsUser && !autoRecentred.current) {
      autoRecentred.current = true;
      recenter();
    }
  }, [push, zones, selectedId, followsUser, centre.lat, centre.lng, recenter]);

  // Re-sent every time any of these change — cheap (a redraw of a couple of
  // dozen markers at most), and the page's own `__setZones` clears its layer
  // group before redrawing rather than accumulating stale pins.
  React.useEffect(() => {
    if (ready.current) pushState();
  }, [pushState]);

  const handleMessage = (event: WebViewMessageEvent) => {
    let data: { type?: string; zoneId?: string };
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (data.type === "ready") {
      ready.current = true;
      pushState();
    } else if (data.type === "select" && data.zoneId) {
      onSelect(data.zoneId);
    }
  };

  return (
    <>
      <WebView
        ref={webviewRef}
        source={{ html }}
        onMessage={handleMessage}
        style={StyleSheet.absoluteFill}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
        // The tile requests themselves are the map; nothing here needs to
        // remember state between screens.
        cacheEnabled
      />

      {followsUser ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Centre the map on your location"
          onPress={recenter}
          style={({ pressed }) => [styles.recenter, pressed && styles.recenterPressed]}
        >
          {/*
           * Material Design's `my_location` — the icon asked for as
           * `MdOutlineMyLocation` from `react-icons/md`. `react-icons` renders
           * DOM `<svg>` elements and so cannot be used here; `@expo/vector-icons`
           * serves the same Material glyph natively, and works in plain Expo Go.
           */}
          <MaterialIcons name="my-location" size={22} color={theme.colour.primary} />
        </Pressable>
      ) : null}
    </>
  );
}

/** What the web page actually needs — trimmed and pre-shaped on the RN side. */
interface MapZone {
  id: string;
  lat: number;
  lng: number;
  available: number;
  capacity: number;
  full: boolean;
  colour: string;
  /** [lat, lng] pairs, already flipped from GeoJSON's [lng, lat]. */
  boundary: [number, number][] | null;
}

function toMapZone(zone: NearbyZone): MapZone {
  const ring = zone.boundary?.coordinates?.[0];
  return {
    id: zone.id,
    lat: zone.centerLat,
    lng: zone.centerLng,
    available: zone.available,
    capacity: zone.capacity,
    full: zone.availability === "FULL",
    colour: availabilityColour(zone.availability),
    boundary: ring && ring.length >= 3 ? ring.map(([lng, lat]) => [lat, lng]) : null,
  };
}

/**
 * The page, loaded once.
 *
 * Only `centre` — the initial view — is baked in at build time; everything
 * that changes after (`zones`, `selectedId`, the "you are here" dot) arrives
 * later over `injectJavaScript`, read by the `window.__set*` functions
 * defined here.
 */
function buildMapHtml(centre: Fix): string {
  const lat = JSON.stringify(centre.lat);
  const lng = JSON.stringify(centre.lng);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: ${theme.colour.mapGround}; }
      .kmcp-badge {
        display: flex; align-items: center; justify-content: center;
        min-width: 34px; height: 22px; padding: 0 7px;
        border-radius: 11px; border: 1.5px solid #FFFFFF;
        color: #FFFFFF; font: 700 12px/1 -apple-system, system-ui, sans-serif;
        box-shadow: 0 1px 3px rgba(0,0,0,0.35);
        white-space: nowrap;
      }
      .kmcp-badge.selected { border: 2.5px solid ${theme.colour.ink}; height: 26px; min-width: 40px; }
      .kmcp-you {
        width: 16px; height: 16px; border-radius: 8px;
        background: #4285F4; border: 2.5px solid #FFFFFF;
        box-shadow: 0 0 0 4px rgba(66,133,244,0.28);
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      function post(message) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }
      }

      var map = L.map("map", { zoomControl: false, attributionControl: false }).setView([${lat}, ${lng}], 16);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        subdomains: "abc",
      }).addTo(map);

      var zonesLayer = L.layerGroup().addTo(map);
      var userLayer = L.layerGroup().addTo(map);

      function badgeIcon(zone, selected) {
        var label = zone.full ? "FULL" : String(zone.available);
        var cls = "kmcp-badge" + (selected ? " selected" : "");
        return L.divIcon({
          className: "",
          html: '<div class="' + cls + '" style="background:' + zone.colour + '">' + label + "</div>",
          iconSize: [40, 26],
          iconAnchor: [20, 13],
        });
      }

      window.__setZones = function (zones, selectedId) {
        zonesLayer.clearLayers();
        zones.forEach(function (zone) {
          var selected = zone.id === selectedId;
          var weight = selected ? 3 : 2;

          if (zone.boundary) {
            L.polygon(zone.boundary, {
              color: zone.colour,
              weight: weight,
              fillColor: zone.colour,
              fillOpacity: 0.22,
            })
              .addTo(zonesLayer)
              .on("click", function () {
                post({ type: "select", zoneId: zone.id });
              });
          } else {
            L.circle([zone.lat, zone.lng], {
              radius: 40,
              color: zone.colour,
              weight: weight,
              fillColor: zone.colour,
              fillOpacity: 0.22,
            }).addTo(zonesLayer);
          }

          L.marker([zone.lat, zone.lng], { icon: badgeIcon(zone, selected) })
            .addTo(zonesLayer)
            .on("click", function () {
              post({ type: "select", zoneId: zone.id });
            });
        });
      };

      window.__setUser = function (user) {
        userLayer.clearLayers();
        if (!user) return;
        L.marker([user.lat, user.lng], {
          icon: L.divIcon({ className: "", html: '<div class="kmcp-you"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(userLayer);
      };

      window.__recenter = function (lat, lng) {
        map.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: true });
      };

      post({ type: "ready" });
    </script>
  </body>
</html>`;
}

const styles = StyleSheet.create({
  // Floats above the bottom sheet's usual (unselected) height rather than
  // tracking it exactly — the sheet's own height depends on content this
  // component does not see, and a fixed clearance here is the same trade
  // every map app makes for this button.
  recenter: {
    position: "absolute",
    right: theme.space(1.5),
    bottom: 270,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colour.bg,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0E1726",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  recenterPressed: { opacity: 0.8 },
});
