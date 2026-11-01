# NAVMAP

Navigation and map for Malaysia, with live flood, weather and earthquake alerts. Find EV chargers, fuel, fast food, toilets, surau and hospitals near you, get driving directions, and see when your route passes near an active alert.

It is a Progressive Web App (PWA): it works in any browser and can be installed to a phone's home screen.

## What works today

| Feature | How | Cost |
|---|---|---|
| Live map | [MapLibre GL](https://maplibre.org) + [OpenFreeMap](https://openfreemap.org) tiles (OpenStreetMap data) | Free, no key |
| Satellite view | Layers button → Satellite: [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) raster under the OpenFreeMap labels (hybrid). Choice saved in `localStorage` | Free with attribution; for commercial or high-volume use, get an ArcGIS Location Platform key or swap `SAT_TILES` in `src/main.js` |
| Home & Work | `src/lib/saved.js`: saved on the device only (`localStorage` `navmap.saved`). Set from the current location or any place card ("Save as Home/Work"); one tap routes there | Free |
| Play view | Layers button → Play: bright blocky style (stepped 3D buildings in toy colours, block-character avatar, tilted camera) restyled client-side from the same OpenFreeMap tiles (`src/lib/play.js`). Points and badges for pinning hazards and starting trips, kept in `localStorage` only (`src/lib/score.js`) | No extra service |
| Place search | [Photon](https://photon.komoot.io) geocoder, limited to Malaysia | Free, no key |
| Nearby EV, fuel, fast food, toilets, surau, hospitals | Preloaded for all of Malaysia from OpenStreetMap (`public/data/poi`, refreshed weekly by the *Update places data* GitHub Action), live [Overpass](https://overpass-api.de) as fallback | Free, no key |
| Driving directions + alternatives | [OSRM](https://project-osrm.org) public demo server | Free, demo only (see below) |
| Turn-by-turn guidance with voice (BM / EN) | Browser GPS + built-in speech; auto-reroute when you leave the route; spoken alert warnings | Free |
| Flood alerts | JPS water-level stations via [data.gov.my flood warning API](https://developer.data.gov.my/realtime-api/flood-warning) | Free |
| Weather + earthquake warnings | MetMalaysia via [data.gov.my weather API](https://developer.data.gov.my/realtime-api/weather) | Free |
| Route safety check | Flags routes that pass inside an active alert area and prefers a safer alternative | – |
| Live weather (now, hourly, 7-day, UV, air quality) | [Open-Meteo](https://open-meteo.com) | Free, no key |
| Animated rain radar | [RainViewer](https://www.rainviewer.com/api.html) | Free, no key |
| Community pins (rain, heavy rain, storm, flood, wind, haze, landslide, fallen tree, hot, clear, accident, jam) | `api/pins.js` + Upstash Redis; only the device that pinned can remove it; pins expire after 1–12 h; 20 pins/hour per IP | Free tier |
| Pollution index (0 clean to 300+ worst, 6 levels, PM2.5/PM10/O₃/NO₂/SO₂/CO, 24 h peak) | [Open-Meteo air quality](https://open-meteo.com/en/docs/air-quality-api) (CAMS model, US AQI scale); official DOE readings linked | Free, no key |
| Emergency calls (SOS button): Government, Car problem, NGOs, plus your coordinates | `src/lib/hotlines.js`, numbers checked Oct 2026 | – |
| Nature & climate news (Malaysia + world, topic filters) | `api/news.js` reads public RSS feeds (Google News EN/BM, Malay Mail, The Star, Guardian, BBC, UN News, Mongabay), 15-min edge cache | Free |
| Email updates sign-up (unticked PDPA consent box, unsubscribe) | `api/subscribe.js` → Upstash hash `navmap:subs`; owner export: set `ADMIN_KEY` in Vercel, then open `/api/subscribe?export=csv&key=<ADMIN_KEY>` | Free tier |
| Visitor analytics (cookieless) | Vercel Web Analytics script in `index.html`; turn on in Vercel → Project → Analytics | Free (Hobby limits) |
| Public visitor counter | `api/stats.js`: daily HyperLogLog in the same Upstash Redis (`navmap:v:<date>`, Malaysia time, kept 40 days). Shows "N visitors today · N live pins" above the footer. Stores no IP or identifier; skips bots and browsers sending Do Not Track / GPC | Free |
| Car workshops & tyre shops nearby | Overpass (`shop=car_repair`/`tyres`) | Free, no key |
| Emergency places: police, Bomba, evacuation shelters | Overpass (`amenity=police`, `amenity=fire_station`; shelters = `emergency=assembly_point`/`evacuation_centre`, `social_facility=shelter`, or names with "Pusat Pemindahan"). Also "Nearest help" buttons in the SOS sheet, plus a link to InfoBencana JKM for relief centres open during floods | Free, no key |
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
- **Legal:** `public/terms.html` and `public/privacy.html` (PDPA 2010) are templates written for this app; have a Malaysian lawyer review them. Contact on both pages: muhdyusry.abdullah@gmail.com.

## Turn on shared community pins (one time)

Until this is done, pins are saved on each person's own device only.

1. Vercel → your **navmap** project → **Storage** → **Create Database** → **Upstash for Redis** (free plan) → connect it to the navmap project.
2. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Redeploy (Deployments → ⋯ → Redeploy).
3. The Weather tab then shows **Live · shared** under Community weather.

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
public/                 manifest, service worker, icons, Terms of Service and Privacy Policy pages
```

Map data © OpenStreetMap contributors. NAVMAP is not an official warning service. In an emergency call 999.

## Copyright

© 2026 Yush Abdullah. All rights reserved. See [LICENSE](LICENSE). Map, weather and alert data remain the property of their providers (OpenStreetMap contributors, Open-Meteo, RainViewer, data.gov.my).
