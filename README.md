# Northern Trails

**Tours, live travel-safety conditions and a grounded AI assistant for Northern Pakistan.**

A web platform for Gilgit-Baltistan and Chitral: travelers compare and book multi-day
tour packages, match with a driver or guide in real time, check live road, weather and
earthquake conditions, find restaurants near a destination, and ask an AI assistant that
answers only from the app's own live data.

- **Live site:** https://northern-trails-fyp.web.app
- **API reference (Swagger):** `<API URL>/api/docs`
- Final Year Project — the sections below double as the technical write-up.

---

## Contents

1. [The problem it addresses](#the-problem-it-addresses)
2. [Features](#features)
3. [Architecture](#architecture)
4. [How the key features work](#how-the-key-features-work)
5. [Design system](#design-system)
6. [API reference](#api-reference)
7. [Running locally](#running-locally)
8. [Environment variables](#environment-variables)
9. [Deployment](#deployment)
10. [Testing and quality](#testing-and-quality)
11. [Live-conditions layer, rides, accounts, payments](#the-live-conditions-layer)
12. [Known limitations](#known-limitations)
13. [Credits and data licences](#credits-and-data-licences)

---

## The problem it addresses

Tourists planning trips to Hunza, Skardu, Chitral and the rest of Gilgit-Baltistan rely on
scattered, unverified sources — Facebook groups, forum posts, word of mouth — for road
status, weather, permits and operator legitimacy. Roads close often (landslides, snowfall,
glacial lake outburst floods), and there is no one place to get current, trustworthy
information or to compare operators transparently.

## Features

| Area | What the traveler gets | Where |
|---|---|---|
| **Tour packages** | Cards with a real destination photo, title, duration, PKR price, rating, operator and a highlight line. Actions: *View details* (modal with day-by-day itinerary, inclusions, exclusions and a photo gallery), *Book now*, *Visit operator website*, *Contact on WhatsApp* (pre-filled message), *Save to wishlist* and *Share* | `/explore`, home carousel |
| **Infinite carousel** | Featured packages drift continuously; pauses on hover or focus, drag or swipe on mobile, arrow buttons, respects reduced-motion | `/` |
| **Booking** | Validated form (name, phone, email, date, group size, notes) → booking stored in PostgreSQL as `pending_payment` → signed payment callback confirms it. Route warnings attached at booking time | from any card or detail page |
| **Package admin** | Token-protected form: name, destination, operator, price, duration, day-by-day itinerary, inclusions/exclusions, operator website URL, WhatsApp number, image upload or URLs. Edit and delete | `/admin` |
| **Nearby restaurants** | Leaflet map plus a list: name, cuisine, distance, phone/website when known, and a *Get directions* button that opens Google Maps | each package page |
| **Wishlist** | Heart any package; saved per browser with a live count in the header | `/wishlist` |
| **AI assistant** | Answers from live roads, weather, earthquakes/hazards, packages, prices and restaurants. Says "the road to X is closed — consider Y instead", refuses to invent packages or prices, says plainly when a place (e.g. Naran) is not covered. Typing indicator, retry on error, history kept across reloads | `/assistant` |
| **Live conditions** | Road status, weather (Open-Meteo, optionally cross-checked by OpenWeatherMap), USGS earthquakes, GDACS hazards, PMD advisories, each with source and timestamp | `/conditions` |
| **Trip planner** | Compares every destination against budget, days, group, interests and date, with a transparent Travel Condition Score | `/plan` |
| **Instant match** | Request a jeep, guide or transfer; nearby operators bid over WebSockets; accept and track | `/instant`, `/operator` |
| **Design** | Photo hero, glass cards, Poppins + Inter, light/dark toggle (follows the OS until chosen), scroll reveals, hover lift, animated counters, page transitions, skeleton loaders, fully responsive | everywhere |

---

## Architecture

```
┌──────────────────── React SPA (Vite · Tailwind · Framer Motion · Leaflet) ────────────────────┐
│  Home  Explore  Package  Plan  Instant  Conditions  Assistant  Operator  Wishlist  Admin      │
│  lib/store     bootstrap + background retry, snapshot while the API wakes                    │
│  lib/photos    photo lookup → API → Wikimedia direct → gradient placeholder (cached 7 days)   │
│  lib/places    restaurants → API → Overpass direct                                            │
└──────┬──────────────────────────────────────┬─────────────────────────────────────────────────┘
       │ REST /api/*                          │ WebSocket /ws/traveler/:id, /ws/operator/:id
┌──────▼──────────────────────────────────────▼─────────────────────────────────────────────────┐
│                                FastAPI (backend/app)                                          │
│  main.py        REST surface, validation, SPA hosting, socket endpoints                       │
│  assistant.py   retrieve → context pack (roads, weather, alerts, packages, restaurants,       │
│                 alternatives) → Gemini or offline composer → citations                        │
│  photos.py      Unsplash (key) → Wikimedia Commons, credited, cached 24 h                     │
│  places.py      Google Places (key) → OpenStreetMap Overpass, widening radius, cached 12 h    │
│  admin.py       token-guarded package CRUD + image upload                                     │
│  planner.py     Travel Condition Score and destination comparison                             │
│  matching.py    dispatch hub: fan-out, response window, offers, tracking                      │
│  sources/       scheduled pollers → Open-Meteo, OpenWeatherMap, GDACS, USGS, PMD, NHA         │
│  payments/      JazzCash · Easypaisa · sandbox behind one interface                           │
│  db/            PostgreSQL + PostGIS models, idempotent migrations, seeding, spatial queries  │
└──────┬────────────────────────────────────────────────────────────────────────────────────────┘
       │
┌──────▼───────────────────────────────────┐   ┌───────────────────────────────────────────────┐
│ PostgreSQL 16 + PostGIS 3.4              │   │ External: Gemini · Open-Meteo · USGS · GDACS  │
│ bookings, payments, packages, images,    │   │ Wikimedia · Unsplash · Overpass · Google      │
│ trips, users, devices, spatial columns   │   │ Places · OSRM · Firebase Auth/FCM             │
└──────────────────────────────────────────┘   └───────────────────────────────────────────────┘
```

**Hosting.** The SPA is served by Firebase Hosting. The API runs as a Docker web service
(Render blueprint in `render.yaml`) with PostgreSQL + PostGIS (Neon or any Postgres 16).
The SPA is built with `VITE_API_BASE` pointing at the API.

**Keys stay on the server.** Every secret — Gemini, Unsplash, Google Places, payment
credentials, the admin token — is read by the backend from environment variables. The
browser only ever receives results. The `VITE_*` variables are public by design (Firebase
web config and the API URL) and contain no secrets.

### Fallback-first

Every integration is optional and degrades instead of failing. With an empty `.env` the whole
app runs on its seeded data layer and in-memory store. Add a credential and that one
subsystem switches to live. `GET /api/health` reports the real mode of each:

```json
{"assistant": "gemini:gemini-3.6-flash", "database": "postgis", "weather": "open-meteo",
 "hazards": "gdacs+usgs", "photos": "wikimedia", "restaurants": "openstreetmap",
 "admin": "enabled", "payments": {"provider": "mock", "mode": "sandbox/mock"}}
```

The frontend follows the same rule. If the API is slow to answer (a free instance waking
from idle), the pages draw from a bundled snapshot after 3.5 s, fetch weather and
earthquakes straight from Open-Meteo and USGS, and keep retrying the API in the background.
When it answers, its data replaces the snapshot in place. Every record carries its own
timestamp, so nothing is presented as fresher than it is.

---

## How the key features work

### Destination photos

`GET /api/photos?q=Hunza%20Valley&count=6`

1. **Unsplash** search when `UNSPLASH_ACCESS_KEY` is set (landscape, content-filtered).
2. **Wikimedia Commons** otherwise — free, keyless, every image freely licensed. Results are
   filtered to landscape photos at least 1000 px wide, and titles that are usually not scenery
   (maps, diagrams, paintings, archive scans) are rejected.
3. Each result carries author, licence and source link, shown as a credit on large photos.
4. Cached per query for 24 h (memory plus a JSON file), with stale-if-error.

In the browser, `PlacePhoto` shows an animated shimmer, fades the image in, moves to the next
photo if one fails, and ends on a styled gradient card with the place name. A broken image is
never shown. If the API is unreachable, the browser queries Wikimedia directly. Search terms
are curated per destination (`photo_query`), because the bare name often returns maps or
portraits.

### Nearby restaurants

`GET /api/places/restaurants?destination=Hunza`

1. **Google Places API (New)** Nearby Search when `GOOGLE_PLACES_API_KEY` is set.
2. **OpenStreetMap via Overpass** otherwise — named restaurants, cafés and fast food.
3. The radius widens 2.5 km → 8 km → 25 km until something is found, and the radius used is
   reported. Coverage is honest: Karimabad has 17 mapped places, the Deosai plains have none,
   and the UI says so rather than inventing one.
4. Every item has a Google Maps directions URL built from its coordinates.
5. Overpass rate-limits bursts, so each mirror gets a second try after a short wait, then
   the next mirror is used. Results are cached for 12 h.

The page shows a Leaflet map (OpenStreetMap tiles, darkened with a CSS filter in dark mode)
and a list. Choosing a list item flies the map to it.

### Grounded AI assistant

`POST /api/assistant/chat {message, history}`

```
question ──► retrieve()
               ├─ whole-word matches on routes, alerts, weather, packages, operators
               ├─ destinations named (Hunza, Karimabad, K2, Kalash…) + their roads & packages
               ├─ places the app does not cover (Naran, Swat, Murree…) → NOT-COVERED line
               ├─ food intent + destination → places.nearby() → RESTAURANT lines
               └─ a closed road, or a restricted one asked about by name
                  → ALTERNATIVE destinations that are reachable now (Travel Condition Score)
                    with their real packages and prices
          ──► build_context()   typed lines with stable ids: [skardu-road] ROAD | …
          ──► Gemini (system rules below)   or   the deterministic offline composer
          ──► answer + citations (the record ids it was given)
```

The system instruction forbids anything outside the context. It must never mention a
package, price, operator or restaurant that isn't there, it must lead with a closure and
then offer the listed alternatives, and it must say "not covered" instead of guessing.
Without `GEMINI_API_KEY`, or if Gemini fails, times out or is rate-limited (it is retried
twice on 429/503), the offline composer writes the same grounded answer from the same
context. The key is sent in a header, never a URL, so it cannot leak into logs.

Examples, verified in `tests/test_listings.py`:

| Question | Answer shape |
|---|---|
| *Can I still cross Shandur Pass to Chitral?* | Closed at Langar, reroute via Lowari; **consider instead** Skardu (K2 trek, PKR 310,000) or Fairy Meadows (3 days, PKR 41,000) |
| *Is the road to Naran open?* | No data for Naran — Gilgit-Baltistan and Chitral only; lists reachable destinations |
| *Any cheap package to Chitral under 20k?* | Nothing in the catalogue under PKR 20,000; gives the nearest real option and its price |
| *Where can I eat near Karimabad?* | Nearest restaurants from OpenStreetMap with distances, plus the active GLOF alert |

### Package admin

`/admin` asks for `ADMIN_TOKEN`, which the server checks with a constant-time comparison.
The token is kept for the browser tab only, never in the bundle. With no token configured,
the admin API answers 503, so a fresh deploy is never open.

- Validation runs in the browser and again on the server (pydantic). Rules include: known
  destination and operator, PKR 1,000–5,000,000, 1–30 days, one titled itinerary day per
  day, `https://` operator URL, WhatsApp number normalised to wa.me format (`0300-1234567`
  → `923001234567`), and at most 8 images.
- Images are resized in the browser to 1600 px, uploaded, checked by magic bytes (not
  filename) and stored **in the database** as `package_images` rows. A container's disk is
  wiped on every deploy; a row is not. They are served at `/api/images/{id}` with immutable
  caching.
- New packages start at rating 0 ("New"), because ratings come from travelers, not the form.
- Sample (seeded) packages can be edited but not deleted. A package that already has
  bookings is archived instead of deleted, so booking history still resolves.

### Booking and validation

The booking form validates name, phone (`+92 300 1234567`), optional email, a start date
that is not in the past and 1–20 travelers. The server repeats every check and returns
per-field errors, which appear under the matching input. The booking is written to
PostgreSQL (`bookings`) with any current route warnings. It becomes `confirmed` only when
a payment callback passes signature verification.

### Real-time matching

1. Traveler posts a request (`POST /api/trips/request`).
2. The dispatcher ranks operators by proximity, rating and response time.
3. Each candidate receives `job.offered` over WebSocket, staggered ~1.6 s apart.
4. Operators bid (`price`, `ETA`, `message`); offers stream to the traveler as `offer.received`.
5. The traveler accepts; the winner gets `job.confirmed`, everyone else `job.taken`.
6. Trip stages (`driver_enroute → arrived → in_progress → completed`) stream as `trip.update`.
7. Unanswered requests expire after a 45-second response window.

Operators with no live socket connected are simulated so the flow is demonstrable solo. Connect a
real operator socket (open `/operator` in a second tab) and the simulation for that operator stops.

---

## Design system

- **Type:** Poppins for headings, Inter for text, JetBrains Mono for figures and ids.
- **Colour:** tokens defined once as CSS variables (`--ink-*` surfaces, `--frost-*` text,
  `--overlay` tints, accents `glacier`, `amberz`, `rose`) and mapped into Tailwind. The
  light/dark toggle swaps the variables, so every component follows without per-component
  `dark:` classes. Copy over photos uses a fixed light treatment (`.on-photo`) in both themes.
  The saved or system theme is applied by an inline script before first paint, so there is
  no flash.
- **Surfaces:** glass cards (translucent fill, backdrop blur, inner highlight), `shadow-glow` on hover.
- **Motion (Framer Motion):** scroll-triggered fade/slide reveals, staggered grids, card hover
  lift, spring page transitions, animated counters, Ken Burns hero photos, typing indicator.
  All of it respects `prefers-reduced-motion`.
- **Loading:** skeleton shimmer for every data-driven region, and error states with a retry button.
- **Responsive:** tested at 390 px (phone) and 1440 px; bottom tab bar on mobile; no
  horizontal overflow (grids use `minmax(0,1fr)` so wide content cannot stretch a column).

---

## API reference

Interactive docs at `/api/docs`. The main endpoints:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Live/fallback mode of every integration |
| GET | `/api/bootstrap` | Packages, operators, routes, alerts, weather, destinations in one call |
| GET | `/api/packages` · `/api/packages/{id}` | List with filters and sort · detail with route conditions, alerts, destination coordinates |
| GET | `/api/photos?q=&count=` | Credited destination photos |
| GET | `/api/places/restaurants?destination=` | Restaurants near a destination, nearest first |
| POST | `/api/bookings` · GET `/api/bookings/{id}` | Create (validated) · read a booking |
| POST | `/api/payments/start` · `/api/payments/callback` | Hosted checkout · signed callback |
| POST | `/api/assistant/chat` | Grounded answer with citations |
| GET | `/api/conditions` · `/api/conditions/sources` | Roads, alerts, weather · live-source status |
| POST | `/api/plan` · GET `/api/destinations` | Trip planner · destinations with Travel Condition Score |
| POST | `/api/trips/request` · WS `/ws/traveler/{id}` | On-demand request · live offers |
| GET | `/api/admin/status` · POST `/api/admin/verify` | Is admin enabled · check a token |
| POST/PUT/DELETE | `/api/admin/packages[/{id}]` | Package CRUD (`X-Admin-Token`) |
| POST | `/api/admin/images` · GET `/api/images/{id}` | Upload (JPEG/PNG/WebP, ≤ 3 MB) · serve |

---

## Running locally

Requires Node 18+ (20+ for the Firebase CLI) and Python 3.11+.

```bash
# one-time
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
cp .env.example .env            # fill in only what you have

# optional: PostgreSQL + PostGIS
docker compose up -d db         # then DATABASE_URL=postgresql://northern:northern@localhost:5432/northern_trails

# run
./scripts/api.sh                # FastAPI → http://localhost:8000  (docs at /api/docs)
./scripts/web.sh                # Vite    → http://localhost:5173  (proxies /api and /ws)
```

To watch a live match end to end, open `/instant` in one tab and `/operator` in another,
post a request, then bid from the operator tab.

After changing seeded data in `backend/app/data.py`, regenerate the SPA's bundled snapshot:

```bash
backend/.venv/bin/python scripts/snapshot.py
```

---

## Environment variables

All of them are optional; `.env.example` documents each one. One `.env` at the repo root
feeds both the API and the Vite build.

| Variable | Used by | Without it |
|---|---|---|
| `DATABASE_URL` | PostgreSQL + PostGIS | in-memory; bookings and admin packages reset on restart |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | assistant phrasing | deterministic grounded composer |
| `ADMIN_TOKEN` | `/admin` package screen | admin switched off (503) |
| `UNSPLASH_ACCESS_KEY` | destination photos | Wikimedia Commons |
| `GOOGLE_PLACES_API_KEY` | restaurants | OpenStreetMap / Overpass |
| `OPENWEATHER_API_KEY` | second weather opinion | Open-Meteo only |
| `FIREBASE_PROJECT_ID`, `VITE_FIREBASE_*` | phone OTP sign-in | sign-in hidden |
| `FCM_SERVICE_ACCOUNT_JSON`, `VITE_FIREBASE_VAPID_KEY` | push notifications | push disabled |
| `PAYMENTS_PROVIDER`, `JAZZCASH_*`, `EASYPAISA_*` | real payments | sandbox gateway |
| `CORS_ORIGINS` | browser origins allowed to call the API | `*` |
| `VITE_API_BASE` | where the SPA finds the API (build time) | same origin |

---

## Deployment

The live setup needs nothing running on a personal machine.

**1. Database.** Create a free PostgreSQL project on [Neon](https://neon.tech) (it does not
expire), run `CREATE EXTENSION postgis;` once, and copy the connection string. Tables and
seed data are created on first boot; later column additions are applied by idempotent
migrations in `db/session.py`.

**2. API on Render.** Render dashboard → **New → Blueprint** → this repository. `render.yaml`
defines the Docker web service. Paste `DATABASE_URL`, `GEMINI_API_KEY` and any optional keys
when prompted. `ADMIN_TOKEN` is generated for you; read it from the service's
**Environment** tab. Check `https://<service>.onrender.com/api/health`.

**3. Frontend on Firebase Hosting.**

```bash
./scripts/deploy-web.sh https://<service>.onrender.com
```

This builds the SPA against that API and deploys to `northern-trails-fyp.web.app`. Run it
again only if the API URL changes.

**Free-tier note.** A free Render instance sleeps after 15 minutes idle and takes up to a
minute to wake. The site stays usable meanwhile — it shows the snapshot with live weather
and earthquakes and swaps in live data when the API answers — but to avoid the wait, point
a free uptime monitor (e.g. UptimeRobot) at `/api/health` every 10 minutes.

**Alternative for a quick demo:** `./scripts/golive.sh` exposes the API on this machine
through a Cloudflare quick tunnel and deploys the SPA against it. It only lives while the
machine and the tunnel do, and the URL changes on every restart.

The same Docker image also serves the built SPA itself, so the Render URL alone is a
complete deployment too (`docker compose up` runs the same thing locally).

---

## Testing and quality

```bash
cd backend && .venv/bin/python -m pytest     # 155 tests, no network, no database needed
```

| File | Covers |
|---|---|
| `test_listings.py` | photo filtering/credits/fallback, restaurant sorting/radius widening/rate-limit retry, admin auth + CRUD + validation + image byte checks, booking validation, assistant alternatives / not-covered / no invented prices / restaurant answers |
| `test_planner.py` | Travel Condition Score components, weights and destination fit |
| `test_api.py` | region guard, booking lifecycle, double payment, grounded citations |
| `test_payments.py` | JazzCash/Easypaisa signing, forged-callback rejection |
| `test_auth.py` | Firebase token signature, audience, issuer, expiry |
| `test_sources.py`, `test_geo.py`, `test_operators.py` | pollers, parsers, spatial attribution, operator console |

External calls are served by `httpx.MockTransport` and caches point at a throwaway directory,
so the suite is hermetic.

**Frontend checks.** Every route was loaded in headless Chromium at 1440 px (dark) and
390 px (light) with console errors, warnings, failed requests, HTTP errors and horizontal
overflow collected: **zero issues**. A scripted end-to-end run covers:
- the carousel drifts and pauses on hover
- details modal and booking, including validation errors and a real saved booking
- wishlist count and page, share-to-clipboard, and the theme toggle
- restaurant directions links
- the assistant: typing indicator, grounded answer, and history kept across a reload
- admin: wrong-token rejection, validation, publish, the new card's WhatsApp and website
  links, and delete

---

## The live-conditions layer

Four adapters in `backend/app/sources/`, each on its own schedule, each reporting
`live`, `fallback` or `disabled` rather than pretending. `GET /api/conditions/sources`
exposes the state, and the Conditions page renders it — so what is real is never
ambiguous.

| Source | What it gives | Status from a server |
|---|---|---|
| **Open-Meteo** | Current conditions, 3-day forecast and elevation for 6 towns | **Live** — no key needed (the primary) |
| **GDACS** (JRC/UN) | Worldwide hazard feed, filtered to a GB/Chitral bounding box | **Live** — no key needed |
| **USGS** | Earthquakes M4.0+ within 150 km of a tracked road | **Live** — no key needed |
| **PMD** `weather.gov.pk/nwfc/tourist` | Tourist-region advisory, mapped to routes | **Live** — no key needed |
| **OSRM** | Real driving distance and duration for ride pricing | **Live** — no key needed |
| **OpenWeatherMap** | A second, independent reading of the same six towns | Cross-check; active when `OPENWEATHER_API_KEY` is set |
| **NHA** `nha.gov.pk` | Road open/closed/restricted | **Blocked** — WAF returns 403 to any automated request |

Five of these need no account, no key and no billing, so a fresh clone has genuinely
live weather, hazards, seismic activity, advisories and road distances immediately.

### Two weather providers, not one

With `OPENWEATHER_API_KEY` set, OpenWeatherMap runs **alongside** Open-Meteo rather
than replacing it, and the two readings for each town are compared:

| Temperature gap | Confidence | Shown as |
|---|---|---|
| ≤ 1 °C | 0.95 | *Confirmed by a second provider* |
| ≤ 3 °C | 0.88 | *Confirmed by a second provider* |
| > 3 °C | 0.62 | *Providers disagree by N° — treat with caution* |

This is worth the extra call because forecast models diverge most over steep terrain,
which is precisely where the reading matters and where a single number is least
trustworthy. Saying so is more useful than quietly picking one.
Earthquakes matter here because they trigger the rockfall that shuts the KKH, so a
tremor near a route is a reason to treat that road with caution.

NHA is the honest caveat. The site refuses server-side requests over both HTTP and
HTTPS regardless of user agent, so the adapter reports `fallback` and the seeded road
statuses stand. The parser itself is real and tested — point `NHA_URL` at a reachable
mirror, a district-administration page of the same shape, or a saved snapshot, and it
produces live rows. Everything downstream is already wired for it.

Merge policy matters as much as the fetching:

* A live source never deletes a seeded row. Sources go dark; the app degrades to the
  baseline rather than to an empty screen.
* Every record carries `origin` — `seed`, `gdacs`, `pmd`, `nha` or `openweathermap`.
* Live hazards re-sync each cycle, so a cleared event disappears; seeded ones never do.
* A road status that actually *changes* fires a push to devices watching that route and
  a `condition.change` broadcast to connected operator sockets.

---

---

## On-demand rides

A ride is a real record, not an animation.

**Real pricing.** The fare comes from the actual road route via OSRM, not a lookup
table. Gilgit→Skardu is 138 km straight-line but **209 km and 2.6 h of road**, and the
fare reflects the road. Guides and porters are day-rated, so distance does not inflate
them. `GET /api/trips/quote` returns the fare together with the evidence
(`distance_km`, `duration_min`, `route_method`), and the UI shows a **measured route**
or **estimated** badge accordingly — a fallback estimate is never dressed up as measured.

**Real records.** Every request, offer, acceptance and stage change is persisted to
`trip_requests`, so rides survive a restart and appear in `GET /api/trips/history/{id}`
with their agreed price. The Instant page renders that history from the database.

**Northern Pakistan only.** Requests outside the tracked network are refused with a 400
rather than quoted for a route the platform cannot serve.

**The one thing that cannot be real.** There are no human drivers connected to this
deployment. An operator with no live socket is answered by a stand-in so a solo demo
does not simply time out — but every such offer carries `simulated: true` and the UI
labels it **stand-in**. Open `/operator` in a second tab and that operator's stand-in
stops immediately; you bid for real. Nothing simulated is ever presented as a real
driver.

---

---

## Accounts and notifications

### Running it locally without Firebase billing

The Firebase **Auth emulator** runs the real Firebase Auth software on your machine.
The full phone-OTP flow works against it with no SMS, no billing and no console
setup — which is also how the flow is tested here.

```bash
./scripts/emulator.sh        # Auth emulator on :9099, UI on :4000
```

Then set both halves in `.env` and restart the API and Vite:

```
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099        # backend
VITE_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099   # frontend
```

`/api/health` will report `"auth": "firebase-emulator"`. Codes are not texted — read
them in the Emulator UI at <http://localhost:4000/auth>, or:

```bash
curl localhost:9099/emulator/v1/projects/$PROJECT/verificationCodes
```

Emulator ID tokens are deliberately unsigned, so `verify_id_token` skips the signature
check on that path only — audience, issuer and expiry are still enforced. The branch is
unreachable unless `FIREBASE_AUTH_EMULATOR_HOST` is set, so production verification is
untouched.

### Going live on a real Firebase project

Three things must be done in the console; everything else is already wired:

1. **Authentication → Get started**, then enable the **Phone** provider. (The API path
   for this requires billing-enabled Identity Platform; the free tier needs the click.)
2. **Authentication → Settings → Authorized domains**: add the domain you deploy to.
   `localhost` is there by default.
3. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair**,
   and put that key in `VITE_FIREBASE_VAPID_KEY`. For push you also need a
   service-account JSON in `FCM_SERVICE_ACCOUNT_JSON`.

While testing, **Authentication → Sign-in method → Phone → Test phone numbers** lets you
add a number and a fixed code, so you can demo repeatedly without spending SMS quota.

**Phone OTP** — the SMS round trip happens in the browser via the Firebase JS SDK; the
backend verifies the returned ID token against Google's published x509 certificates.
No service-account key is needed for auth, only the public project id. Tokens are
checked for signature, audience, issuer and expiry; all four rejections are tested.

The Firebase SDK is lazily imported, so the ~190 KB bundle is only fetched by users who
actually open the sign-in sheet.

**Push (FCM HTTP v1)** — a signed-in device registers an FCM token against the routes it
follows. When a road status changes, `notify_condition_change()` fans a notification out
to every watching device. Requires a service-account JSON; without one the module is
inert and logs what it would have sent.

---

---

## Payments

One provider interface, three implementations, selected by `PAYMENTS_PROVIDER`.

| Provider | Signing | Notes |
|---|---|---|
| **JazzCash** | HMAC-SHA256 over the integrity salt + every non-empty field, ordered by key | Amount in paisa; hosted checkout redirect |
| **Easypaisa** | AES-128-ECB + base64 over the ordered parameter string | Hosted checkout redirect |
| **Sandbox** | HMAC-SHA256 | Runs offline; same signed-callback flow |

A booking is created as `pending_payment` and only becomes `confirmed` when a callback
**passes signature verification**. A forged callback claiming success is recorded as
`payment_failed` and the booking is never confirmed — the return page says so explicitly
rather than trusting the `paid=true` in its own query string.

Real gateway credentials are requested from the provider as a merchant; without them the
sandbox runs the identical flow.

---

---

## Known limitations

- **Sample operators.** The five seeded operators and their registration numbers are sample
  data for the prototype. They deliberately have no website or WhatsApp number: a made-up
  URL or phone number would send a traveler to a real stranger. Those two buttons appear as
  soon as a package has them, which is what the admin screen is for.
- **Road status.** NHA blocks automated requests, so road statuses come from the seeded
  baseline plus PMD, GDACS and USGS signals (see above). Each carries its source and time.
- **Restaurant coverage** is only as good as OpenStreetMap (or Google Places with a key).
  Remote areas such as the Deosai plains have none mapped, and the app says so.
- **Free hosting sleeps** after idle. See the deployment note on keeping it warm.
- **Wishlist** is stored per browser, not per account.

## Credits and data licences

- Destination photos: [Wikimedia Commons](https://commons.wikimedia.org) contributors under the
  licence shown on each photo (mostly CC BY-SA / CC0), or [Unsplash](https://unsplash.com)
  photographers when an Unsplash key is configured. Credits are shown on the photo.
- Map data and restaurant listings: © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors (ODbL); map tiles © OpenStreetMap.
- Weather: [Open-Meteo](https://open-meteo.com) (CC BY 4.0) and OpenWeatherMap. Earthquakes:
  [USGS](https://earthquake.usgs.gov). Hazards: [GDACS](https://www.gdacs.org). Advisories: PMD.
  Routing: [OSRM](https://project-osrm.org).
