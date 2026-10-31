# NAVMAP

Navigation and map for Malaysia, with live flood, weather and earthquake alerts. Find EV chargers, fuel, fast food, toilets, surau and hospitals near you, get driving directions, and see when your route passes near an active alert.

It is a Progressive Web App (PWA): it works in any browser and can be installed to a phone's home screen.

## What works today

| Feature | How | Cost |
|---|---|---|
| Live map | [MapLibre GL](https://maplibre.org) + [OpenFreeMap](https://openfreemap.org) tiles (OpenStreetMap data) | Free, no key |
| Place search | [Photon](https://photon.komoot.io) geocoder, limited to Malaysia | Free, no key |
| Nearby EV, fuel, fast food, toilets, surau, hospitals | Preloaded for all of Malaysia from OpenStreetMap (`public/data/poi`, refreshed weekly by the *Update places data* GitHub Action), live [Overpass](https://overpass-api.de) as fallback | Free, no key |
| Driving directions + alternatives | [OSRM](https://project-osrm.org) public demo server | Free, demo only (see below) |
| Turn-by-turn guidance with voice (BM / EN) | Browser GPS + built-in speech; auto-reroute when you leave the route; spoken alert warnings | Free |
| Flood alerts | JPS water-level stations via [data.gov.my flood warning API](https://developer.data.gov.my/realtime-api/flood-warning) | Free |
| Weather + earthquake warnings | MetMalaysia via [data.gov.my weather API](https://developer.data.gov.my/realtime-api/weather) | Free |
| Route safety check | Flags routes that pass inside an active alert area and prefers a safer alternative | – |
| Hazard reports (flood, accident, landslide, fallen tree, jam, haze) | Saved on the user's device for 3 hours | – |
| BM / EN | Toggle in the search bar | – |

If the alert feeds cannot be reached, the app shows **clearly labelled sample alerts** instead of failing silently.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
```

The `/api/alerts` function only runs on Vercel (or with `vercel dev`). Locally the app falls back to calling data.gov.my directly from the browser.

## Put it live (Vercel, about 10 minutes)

1. Sign in at [vercel.com](https://vercel.com) with your GitHub account (the free Hobby plan is enough to start).
2. **Add New → Project**, pick the `NAVMAP` repo, keep the detected settings (Framework: Vite, Output: `dist`), press **Deploy**.
3. You get a live URL like `navmap.vercel.app`. Every push to `main` redeploys automatically; every pull request gets its own preview URL.
4. Optional domain: buy `navmap.my` (or similar) from a `.my` registrar such as MYNIC resellers (Exabytes, Shinjiru, etc.), then in Vercel go to **Project → Settings → Domains** and follow the DNS instructions. HTTPS is automatic.

HTTPS matters: browsers only allow GPS location on secure sites.

## Before real public traffic

- **Routing:** the OSRM demo server is for testing only and may rate-limit. Options: self-host OSRM with the Malaysia/Singapore/Brunei extract from Geofabrik (a small VPS is enough), or use a paid API (Mapbox Directions, Google Routes, GraphHopper). Set `VITE_OSRM_URL` to your server.
- **Tiles:** OpenFreeMap is free with no hard limit, but you can switch with `VITE_MAP_STYLE` (MapTiler, Mapbox, Stadia) if you need an SLA.
- **Search and Overpass:** both are community services with fair-use policies. For high traffic, self-host Photon/Nominatim and Overpass, or move to a paid places API.
- **Shared hazard reports:** reports are local-only right now. Next step is a backend (Supabase or Firebase) with moderation so everyone sees reports, plus push notifications for alerts near saved places.
- **Haze (API/IPU):** not yet connected; DOE does not publish an open API. Possible sources: data.gov.my datasets or an agreement with DOE.
- **Legal:** finish `public/privacy.html` (PDPA 2010 notice, contact email) and keep the "not an official warning service" disclaimer.

## Refresh the places data

GitHub → **Actions → Update places data → Run workflow**. It runs automatically every Monday and commits the new data, which redeploys the site.

## Project layout

```
index.html              app shell
src/main.js             map, UI, state
src/style.css           design tokens and layout (mint system from design.md)
src/lib/alerts-core.js  data.gov.my fetch + normalisers (shared by browser and API)
src/lib/places.js       Overpass queries per category
src/lib/search.js       Photon search
src/lib/routing.js      OSRM routes + BM/EN step text
src/lib/reports.js      local hazard reports
src/lib/i18n.js         BM / EN strings
api/alerts.js           Vercel serverless proxy with 5-minute edge cache
public/                 manifest, service worker, icons, privacy page
```

Map data © OpenStreetMap contributors. NAVMAP is not an official warning service. In an emergency call 999.
