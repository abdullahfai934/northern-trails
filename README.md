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
5. [Design system](#design-system) · [Screenshots](#screenshots)
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
| **Accounts** | Email/password (with verification and password reset), Google, and phone OTP sign-in. Roles — tourist, operator, admin — kept in Firestore; the avatar menu opens My profile, My bookings, Wishlist and, for staff, the console and dashboard. Clear error messages ("Wrong email or password", "An account already uses this email") | header, everywhere |
| **Tour packages** | Cards with a real destination photo, title, duration, PKR price, rating, operator and a highlight line. *View details* (itinerary, inclusions, exclusions, gallery), *Book now*, *Visit operator website*, *Contact on WhatsApp*, *Save to wishlist*, *Share* | `/explore`, home carousel |
| **Infinite carousel** | Drifts continuously; pauses on hover or focus; drag, swipe and arrow buttons; respects reduced motion | `/` |
| **Booking** | Sign-in required; validated form pre-filled from the profile → stored in PostgreSQL → signed payment callback confirms it | any card |
| **Destination Safety Score** | 0–100 per destination from road status (35), weather (30), earthquakes within 100 km (20) and altitude (15); animated green/yellow/red gauge with the reason | package pages, planner, home |
| **Best places this week** | Destinations ranked by safety, forecast dry days and season | home |
| **Smart alerts** | For upcoming bookings: route closed/restricted, severe weather forecast, M4.5+ earthquake within 100 km. Checked every 3 hours; in-app + browser push (FCM); email when SMTP is set. Each alert sent once | profile → Alerts |
| **AI trip planner** | Days, budget, group, start city, interests → a day-by-day itinerary using only real packages, restaurants and destinations; costs computed from the catalogue. Edit, save, download as PDF | `/plan?mode=ai` |
| **Budget calculator** | Car / jeep / coaster, fuel (real OSRM road distance), hotels, food, permit fees from the route records, guide — as a donut chart with a table | `/budget` |
| **Interactive map** | Leaflet: destinations, packages, road status on real road shapes, recent earthquakes, and restaurants, hotels, hospitals, petrol pumps and police from OpenStreetMap, each a toggle | `/map` |
| **Emergency SOS** | One tap to Rescue 1122, Police 15, Edhi 115; nearest hospitals and police stations with call and directions; share live GPS location on WhatsApp with the saved emergency contact; works offline | `/sos` |
| **Reviews** | After a completed trip: 1–5 stars for the trip and the guide, text and up to 4 photos; admin approves before they appear and count towards the rating | package pages, profile |
| **Nearby restaurants** | Map and list with cuisine, distance and Google Maps directions | package pages |
| **AI assistant** | Grounded in live roads, weather, earthquakes, packages, prices and restaurants; "road to X is closed — consider Y instead"; never invents a package or price | `/assistant` |
| **Developer API** | Public REST API with interactive docs and a live *Try it*; operators create API keys (600 req/min vs 60 anonymous) | `/developers` |
| **Admin dashboard** | Charts (bookings and revenue per month, popular destinations, rating spread, active users) and management of packages, bookings, reviews, road status, users/roles and operators | `/admin` |
| **Operator console** | Operator role only: job queue, bids, availability, own packages and bookings, road-status updates with "last updated by" | `/operator`, `/conditions` |
| **Profile** | Bookings, wishlist, saved plans, reviews, alerts, emergency contact, notification settings | `/profile` |
| **Offline (PWA)** | Installable; opens without signal; keeps booked trips, live data, the last map area and photos cached | phone home screen |
| **English / اردو** | Language toggle with right-to-left layout (i18next) | header |
| **Design** | Photo hero slideshow with Ken Burns and word-by-word headline, glass cards, softened teal/gold, light/dark toggle, scroll reveals, count-ups, shine on primary buttons, skeleton loaders | everywhere |

### Screenshots

| | |
|---|---|
| ![Home](docs/screenshots/home.jpg) Home — photo hero | ![Explore](docs/screenshots/explore.jpg) Explore packages |
| ![Package](docs/screenshots/package.jpg) Package page | ![AI planner](docs/screenshots/ai-planner.jpg) AI trip planner (light theme) |
| ![Map](docs/screenshots/map.jpg) Interactive map | ![Budget](docs/screenshots/budget.jpg) Budget calculator |
| ![Admin](docs/screenshots/admin.jpg) Admin dashboard (light theme) | ![Developers](docs/screenshots/developers.jpg) Developer API |
| ![SOS](docs/screenshots/sos.jpg) Emergency SOS | ![Urdu](docs/screenshots/urdu.jpg) Urdu, right-to-left |
| ![Conditions](docs/screenshots/conditions.jpg) Live conditions | ![Mobile](docs/screenshots/mobile-home.jpg) Mobile |

---

## Architecture

```
┌─────────────────── React SPA on Firebase Hosting (Vite · Tailwind · Framer Motion · Leaflet) ───────────────────┐
│  Home Explore Package Plan/AI Budget Map SOS Instant Conditions Assistant Profile Developers Admin Operator     │
│  lib/auth      Firebase Auth (email, Google, phone) → ID token on every API call; role from /api/me            │
│  lib/store     bootstrap + background retry        lib/i18n   English / Urdu (RTL)                             │
│  public/sw.js  offline cache + FCM push             lib/pdf    trip plan → PDF (jsPDF)                          │
└──────┬─────────────────────────────────────────┬──────────────────────────────────────────────────────────────────┘
       │ HTTPS /api/*   (Bearer ID token)         │ WebSocket /ws/traveler/:id, /ws/operator/:id
┌──────▼─────────────────────────────────────────▼──────────────────────────────────────────────────────────────────┐
│                          FastAPI in Docker on Hugging Face Spaces (backend/app)                                 │
│  auth.py/profiles.py   verify token → Firestore profile → role (tourist · operator · admin)                    │
│  accounts.py           /api/me, bookings, wishlist, notifications, reviews                                      │
│  dashboard.py          stats, bookings, review moderation, users/roles, road status, operators                  │
│  devapi.py             public API rate limits (60 / 600 per min) and operator API keys                           │
│  safety.py             Safety Score and weekly recommendations      alerts.py   3-hourly smart-alert checker     │
│  tripai.py             AI itinerary from real records               assistant.py grounded chat                   │
│  photos.py places.py   Unsplash/Wikimedia photos · Google/Overpass restaurants and POIs                         │
│  matching.py sources/ payments/ db/   dispatch · live pollers · JazzCash/Easypaisa/sandbox · SQLAlchemy+PostGIS  │
└──────┬──────────────────────────────┬────────────────────────────────────────┬────────────────────────────────────┘
       │                              │                                        │
┌──────▼────────────────────┐  ┌──────▼─────────────────────────┐  ┌────────────▼───────────────────────────────────┐
│ Neon PostgreSQL + PostGIS │  │ Firestore  users/{uid}          │  │ Gemini · Open-Meteo · USGS · GDACS · PMD · OSRM │
│ bookings, payments,       │  │ role, operator link, wishlist,  │  │ Wikimedia · Unsplash · Overpass · Google Places │
│ packages, images, reviews,│  │ emergency contact               │  │ Firebase Auth · FCM                             │
│ plans, notifications, keys│  │ (clients read own doc only)     │  │                                                 │
└───────────────────────────┘  └─────────────────────────────────┘  └─────────────────────────────────────────────────┘
```

**Hosting.** The SPA is on Firebase Hosting; the API is a Docker container on a free Hugging
Face Space; data is in Neon (PostgreSQL + PostGIS) and user profiles in Firestore. The SPA is
built with `VITE_API_BASE` pointing at the Space.

**Why not Cloud Functions?** They need the Firebase Blaze (pay-as-you-go) plan with a card.
The same FastAPI backend runs unchanged in a container, which also keeps the WebSocket
matching and the scheduled alert checker (a Function would need Cloud Scheduler).

**Keys stay on the server.** Gemini, Unsplash, Google Places, the Firebase service account,
payment credentials and the admin token are environment secrets on the Space. The browser
only receives results. `VITE_*` variables are public by design (Firebase web config and the
API URL).

**Security rules.** `firestore.rules` lets a signed-in user read only their own
`users/{uid}` document and write nothing; the role field is written by the backend alone, so
nobody can promote themselves. Every API route that reads personal data filters by the uid
in the verified token, never by an id from the request. A verified email is required before
an address in `ADMIN_EMAILS` is granted admin.

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

Operators and admins manage packages from the dashboard; an operator can only touch its own
operator's packages. `ADMIN_TOKEN` (header `X-Admin-Token`) still works for scripts.

- Validation runs in the browser and again on the server (pydantic): known destination and
  operator, PKR 1,000–5,000,000, 1–30 days, one titled itinerary day per day, `https://`
  operator URL, WhatsApp number normalised to wa.me format, at most 8 images.
- Images are resized in the browser to 1600 px, checked by magic bytes and stored **in the
  database** (`package_images`) — a container's disk is wiped on every deploy; a row is not.
- New packages start at rating 0 ("New"); ratings come from approved reviews.

### Accounts and roles

Sign-in is Firebase Authentication in the browser; every API call carries the ID token,
which the backend verifies against Google's certificates. On first sign-in the backend creates
`users/{uid}` in Firestore as a **tourist**. Addresses listed in `ADMIN_EMAILS` become
**admin** once verified; admins promote **operators** (and link them to an operator) from
Users. Protected pages show a sign-in prompt, and an action such as *Book now* resumes after
signing in.

### Safety Score, alerts and the AI planner

- **Safety Score** (`safety.py`): four parts with fixed maximums — road 35 (worst segment),
  weather 30 (storms, snow, rain, wind, cold, visibility over four days), earthquakes 20 (USGS,
  within 100 km, last 7 days: M5.5+ → 0, M4.5+ → 8), altitude 15. A closed road caps the
  score at 45. 75+ is green, 50–74 yellow, below 50 red.
- **Smart alerts** (`alerts.py`): every `ALERT_CHECK_HOURS` (3) for bookings starting within
  three weeks or in progress. Stored in `notifications` with a unique (user, cause) key, so a
  closure is announced once; pushed to the user's devices and emailed if SMTP is configured.
- **AI planner** (`tripai.py`): the destination planner ranks destinations; their packages,
  attractions, restaurants and safety scores become the prompt context; Gemini returns JSON.
  The result is validated — unknown package ids, restaurants and places are dropped — and
  every cost is recalculated from catalogue prices and published daily ground costs. Without
  Gemini, a deterministic builder produces the plan from the same records.

### Developer API

`GET /api/packages`, `/api/packages/{id}`, `/api/destinations`, `/api/conditions/{destination}`
(weather + earthquakes + roads + safety) and `/api/restaurants?lat=&lng=`. Anonymous callers get
60 requests a minute per IP; an operator's key (`X-API-Key`) 600 a minute per key. Responses
carry `X-RateLimit-*` headers; over the limit is 429 with `Retry-After`. Only a key's SHA-256
is stored.

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
| GET | `/api/conditions/{destination}` · `/api/restaurants?lat=&lng=` | Public API: combined conditions · restaurants by point |
| GET | `/api/safety` · `/api/recommendations` | Safety Scores · best places this week |
| GET | `/api/places/pois?kind=&lat=&lng=` | Hospitals, petrol pumps, police, hotels |
| GET/PATCH | `/api/me` · GET `/api/me/bookings` · PUT `/api/me/wishlist` | Profile, bookings, wishlist |
| GET | `/api/me/notifications` · POST `/api/me/notifications/read` | Smart alerts |
| POST | `/api/plan/ai` · GET/POST/DELETE `/api/me/plans` | AI itinerary · saved plans |
| POST | `/api/reviews` · GET `/api/packages/{id}/reviews` | Write a review · approved reviews |
| GET/POST/DELETE | `/api/developer/keys` | Operator API keys |
| GET/PATCH | `/api/admin/stats` `bookings` `reviews` `users` `routes/{id}` `operators/{id}` | Dashboard |

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
| `ADMIN_TOKEN` | package API for scripts (`X-Admin-Token`) | scripts must sign in instead |
| `UNSPLASH_ACCESS_KEY` | destination photos | Wikimedia Commons |
| `GOOGLE_PLACES_API_KEY` | restaurants | OpenStreetMap / Overpass |
| `OPENWEATHER_API_KEY` | second weather opinion | Open-Meteo only |
| `FIREBASE_PROJECT_ID`, `VITE_FIREBASE_*` | sign-in (email, Google, phone) | sign-in hidden |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Firestore profiles/roles and FCM push (file path or raw JSON) | profiles in memory, no push |
| `ADMIN_EMAILS` | verified emails made admin on sign-in | promote admins by hand |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | alert emails | alerts in-app and push only |
| `ALERT_CHECK_HOURS` | how often smart alerts run (default 3) | — |
| `PAYMENTS_PROVIDER`, `JAZZCASH_*`, `EASYPAISA_*` | real payments | sandbox gateway |
| `CORS_ORIGINS` | browser origins allowed to call the API | `*` |
| `VITE_API_BASE` | where the SPA finds the API (build time) | same origin |

---

## Deployment

Nothing runs on a personal machine once deployed.

1. **Database** — a free [Neon](https://neon.tech) PostgreSQL project; paste its *direct*
   connection string as `DATABASE_URL` (not the `-pooler` one: asyncpg's prepared statements
   do not survive PgBouncer). PostGIS, tables, seed data and later column additions are all
   created on boot.
2. **Firebase** — Authentication with Email/Password, Google and Phone switched on; Firestore
   in `asia-south1`; `firebase deploy --only firestore:rules`; a service-account key for the
   backend (`GOOGLE_SERVICE_ACCOUNT_JSON`).
3. **API on Hugging Face Spaces** —
   ```bash
   HF_TOKEN=hf_… backend/.venv/bin/python scripts/deploy_hf.py
   ```
   creates the Docker Space, uploads the backend, sets every secret from `.env` and waits for
   `/api/health`.
4. **Frontend** —
   ```bash
   ./scripts/deploy-web.sh https://<user>-northern-trails-api.hf.space
   ```
   builds the SPA against that API and deploys it to `northern-trails-fyp.web.app`.

A free Space sleeps after 48 hours without visits and wakes on the next request (the site
shows its snapshot with live weather while it wakes). `render.yaml` and `scripts/golive.sh`
(a Cloudflare tunnel to this machine) remain as alternatives.

---

## Testing and quality

```bash
cd backend && .venv/bin/python -m pytest     # 180 tests, no network, no database needed
```

| File | Covers |
|---|---|
| `test_listings.py` | photo filtering/credits/fallback, restaurant sorting/radius widening/rate-limit retry, admin auth + CRUD + validation + image byte checks, booking validation, assistant alternatives / not-covered / no invented prices / restaurant answers |
| `test_accounts.py` | sign-in required for booking, booking privacy, roles only settable by admins, verified-email admin rule, operator scoping, review lifecycle and moderation, API keys and rate limits, conditions/restaurants API, Safety Score parts and caps, smart alerts sent once, operator road updates, AI planner rejecting invented records, dashboard stats |
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
- admin: validation, publish, the new card's WhatsApp and website links, and delete
- signed in, against the real Firebase project and database: sign-up validation, wrong
  password message, sign out and back in, wishlist on the account, booking pre-filled from
  the profile and listed in My bookings, emergency contact, AI plan built, saved and
  downloaded as PDF, developer *Try it*, budget road distance, map layers, SOS location,
  Urdu RTL, admin charts and booking status, review submitted and moderated, operator
  console, API key raising the limit to 600/min, road-status editor

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

- **Sample operators.** The seeded operators are sample data; they have no website or
  WhatsApp number (a made-up one would reach a real stranger). Those buttons appear once a
  package has them.
- **Phone OTP** texts real numbers only on the Firebase Blaze plan; on the free plan the test
  numbers configured in the console work (e.g. `+92 300 1234567`, code `123456`). Email and
  Google sign-in are unaffected.
- **Road status** is set by operators and admins (NHA blocks automated access); each road
  shows who updated it and when, alongside PMD, GDACS and USGS signals.
- **Alert emails** need an SMTP account (`SMTP_*`); without one alerts arrive in-app and by push.
- **Restaurant and POI coverage** is only as good as OpenStreetMap (or Google Places with a key).
- **Emergency numbers** listed are the national ones (1122, 15, 115); tourist-police
  stations come from OpenStreetMap rather than a hand-typed list.
- **PDF export** is in English (the built-in PDF fonts have no Urdu glyphs).

## Credits and data licences

- Destination photos: [Wikimedia Commons](https://commons.wikimedia.org) contributors under the
  licence shown on each photo (mostly CC BY-SA / CC0), or [Unsplash](https://unsplash.com)
  photographers when an Unsplash key is configured. Credits are shown on the photo.
- Map data and restaurant listings: © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors (ODbL); map tiles © OpenStreetMap.
- Weather: [Open-Meteo](https://open-meteo.com) (CC BY 4.0) and OpenWeatherMap. Earthquakes:
  [USGS](https://earthquake.usgs.gov). Hazards: [GDACS](https://www.gdacs.org). Advisories: PMD.
  Routing: [OSRM](https://project-osrm.org).
