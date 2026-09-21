# Northern Trails

**AI-powered tour marketplace & live conditions assistant for Northern Pakistan.**

A hybrid booking platform for Gilgit-Baltistan and Chitral that runs two booking models over one
verified-operator network, on top of a live road / weather / permit layer that also grounds the
AI assistant.

---

## The problem it addresses

Tourists planning trips to Hunza, Skardu, Chitral and Gilgit-Baltistan rely on scattered,
unverified sources — Facebook groups, random forum posts, word of mouth — to check road status,
weather, permits and tour operator legitimacy. Roads close frequently (landslides, snowfall,
glacial lake outburst floods), and there is no centralised way to get current, trustworthy
information or compare operators transparently.

## What this builds

| Capability | Where it lives |
|---|---|
| Browse & compare multi-day packages (price, duration, pickup, destination) | `/explore` |
| Real-time request-and-match for on-demand jeeps, transfers, guides and porters | `/instant` |
| Live road status, weather, permits, hazards and GLOF alerts per route | `/conditions` |
| AI assistant answering **only** from those live records, with citations | `/assistant` |
| Operator-side console: accept/reject jobs, bid, toggle availability | `/operator` |
| Verified-operator vetting against tourism-department registration | throughout |
| Phone-OTP sign-in (Firebase), push notifications (FCM) | `/` header, `/conditions` |
| Card/wallet checkout via JazzCash, Easypaisa or a sandbox gateway | `/explore/:id` → `/pay/return` |

---

## Architecture

```
┌──────────────── React SPA (Vite + Tailwind + Framer Motion) ────────────────┐
│  Explore   Instant match   Conditions   Assistant   Operator console        │
└──────┬──────────────────────────────┬───────────────────────────────────────┘
       │ REST /api/*                  │ WebSocket /ws/traveler/:id, /ws/operator/:id
┌──────▼──────────────────────────────▼───────────────────────────────────────┐
│                          FastAPI (backend/app)                              │
│  main.py       REST surface, SPA hosting, socket endpoints                  │
│  matching.py   dispatch hub: fan-out, response window, offers, tracking     │
│  assistant.py  retrieve → context pack → answer → citations                 │
│  data.py       seeded baseline: routes, alerts, weather, operators, packages│
│  auth.py       Firebase ID-token verification (phone OTP)                   │
│  push.py       Firebase Cloud Messaging (HTTP v1)                           │
│  sources/      scheduled pollers → OpenWeatherMap, GDACS, PMD, NHA          │
│  payments/     JazzCash · Easypaisa · sandbox, one provider interface       │
│  db/           PostgreSQL + PostGIS models, seeding, spatial queries        │
└──────┬──────────────────────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────────────────┐
│  PostgreSQL 16 + PostGIS 3.4 — geography columns, ST_Distance dispatch      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Fallback-first

Every integration is optional and every one degrades instead of failing. With an
empty `.env` the whole app runs on its seeded data layer and in-memory store — clone,
install, run. Add a credential and that one subsystem switches to live; the rest stay
as they were. `GET /api/health` reports the real mode of each:

```json
{"database":"postgis","weather":"seeded","hazards":"gdacs","roads":"nha+pmd",
 "auth":"disabled","push":"disabled","payments":{"provider":"mock","mode":"sandbox/mock"}}
```

This is deliberate: a demo must never break because a government website is down.

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

### Assistant grounding

`retrieve()` does whole-word matching against route, alert, weather, package and operator records,
plus whole-word intent detection (permit / road / safety / weather / package / operator). A topic
keyword only pulls in defaults when the question named nothing of that kind — so "permits for
Khunjerab" never drags in an unrelated closure. Matched records become a typed context pack with
stable ids; the answer may only phrase what that pack contains, and each reply returns the record
ids it used.

If `GEMINI_API_KEY` is set, phrasing goes through Gemini under a strict system instruction. Without
a key, a deterministic composer produces the same grounded answer offline — **the retrieval,
citations and refusal behaviour are identical either way**. A question the data layer does not
cover returns an explicit refusal rather than a guess.


---

## The live-conditions layer

Four adapters in `backend/app/sources/`, each on its own schedule, each reporting
`live`, `fallback` or `disabled` rather than pretending. `GET /api/conditions/sources`
exposes the state, and the Conditions page renders it — so what is real is never
ambiguous.

| Source | What it gives | Status from a server |
|---|---|---|
| **Open-Meteo** | Current conditions, 3-day forecast and elevation for 6 towns | **Live** — no key needed (the default) |
| **GDACS** (JRC/UN) | Worldwide hazard feed, filtered to a GB/Chitral bounding box | **Live** — no key needed |
| **USGS** | Earthquakes M4.0+ within 150 km of a tracked road | **Live** — no key needed |
| **PMD** `weather.gov.pk/nwfc/tourist` | Tourist-region advisory, mapped to routes | **Live** — no key needed |
| **OSRM** | Real driving distance and duration for ride pricing | **Live** — no key needed |
| **OpenWeatherMap** | Same as Open-Meteo | Optional upgrade; takes over when a key is set |
| **NHA** `nha.gov.pk` | Road open/closed/restricted | **Blocked** — WAF returns 403 to any automated request |

Five of these need no account, no key and no billing, so a fresh clone has genuinely
live weather, hazards, seismic activity, advisories and road distances immediately.
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

## Data layer

`DATABASE_URL` unset → in-memory dicts, zero infrastructure. Set → PostgreSQL 16 with
PostGIS 3.4; tables and seed data are created on first boot.

Geometry is stored in `geography` columns so `ST_Distance` returns metres over the
spheroid with no projection step:

* `operators.location` — POINT, the base of operations
* `routes.path` — LINESTRING, the drivable corridor
* `alerts.location`, `weather.location` — POINT

This replaces the hand-written proximity table in the dispatcher. `_candidates_async()`
ranks operators with a real spatial query and falls back to the adjacency list if there
is no database — dispatch never fails because of the storage layer.

```
Karimabad (Hunza)  ->  op-hunza-guides 0.0km · op-karakoram 54.2km · op-nanga 98.3km
Skardu             ->  op-baltistan 0.0km · op-nanga 96.6km · op-karakoram 138.1km
```

Adding an operator now needs a coordinate, not a new row in a lookup table.

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

## Testing

```bash
backend/.venv/bin/python -m pytest        # from backend/
```

71 tests, no network and no database required — the suite runs anywhere,
which is why CI needs no secrets.

| Area | What it covers |
|---|---|
| `test_geo.py` | route/city coordinate coverage, hazard-to-road attribution, region bounds |
| `test_sources.py` | NHA parsing and status grading, PMD severity, WMO codes, graceful degradation |
| `test_payments.py` | JazzCash and Easypaisa signing, callback forgery rejection, reference uniqueness |
| `test_auth.py` | token signature, audience, issuer, expiry and forgery rejection |
| `test_api.py` | region guard, booking lifecycle, double-payment, grounded citations |

Several are regression tests for bugs found during development, and each one
says so in its docstring:

- a flood in **Thailand** was attributed to a Deosai road, because
  `nearest_routes` had no distance ceiling
- an authority's stated road status of **"Caution"** was overridden to
  `restricted` by the phrase *"single lane"* elsewhere in the row
- **transaction references collided within 200 draws** — 4 hex characters of
  entropy on the payments-table primary key
- a **forged payment callback** must never confirm a booking
- the bundled offline snapshot shipped **without the package→operator join**,
  which blanked the entire site

CI (`.github/workflows/ci.yml`) runs the backend suite, a production frontend
build and a Docker image build on every push.

---

## Running locally

Requires Node 18+ and Python 3.11+.

```bash
# one-time
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cd frontend && npm install && cd ..

# run (two terminals, or use the scripts)
./scripts/api.sh          # FastAPI  → http://localhost:8000
./scripts/web.sh          # Vite     → http://localhost:5173
```

Open **http://localhost:5173**. The dev server proxies `/api` and `/ws` to port 8000.

- API docs (Swagger): http://localhost:8000/api/docs
- Health: http://localhost:8000/api/health

**To watch a live match end to end:** open `/instant` in one tab and `/operator` in another,
post a request, then bid from the operator tab.

### Turning integrations on

Copy the template and fill in only what you have — each key is independent.

```bash
cp .env.example .env
./scripts/api.sh          # the API reads .env on startup
```

| Want | Set | Where to get it |
|---|---|---|
| Live weather | *(nothing — Open-Meteo is on by default)* | optional: `OPENWEATHER_API_KEY` from openweathermap.org |
| PostgreSQL + PostGIS | `DATABASE_URL` | `docker compose up db`, then `postgresql://northern:northern@localhost:5432/northern_trails` |
| Phone OTP sign-in | `FIREBASE_PROJECT_ID` + the `VITE_FIREBASE_*` keys | Firebase console → enable **Phone** auth |
| Push notifications | `FCM_SERVICE_ACCOUNT_JSON` + `VITE_FIREBASE_VAPID_KEY` | Firebase console → Cloud Messaging |
| Gemini phrasing | `GEMINI_API_KEY` | aistudio.google.com |
| Real payments | `PAYMENTS_PROVIDER` + that gateway's credentials | JazzCash / Easypaisa merchant onboarding |

`curl localhost:8000/api/health` confirms what actually switched on. Weather
(Open-Meteo), hazards (GDACS), earthquakes (USGS), the PMD advisory and ride routing
(OSRM) are all live with no key at all.

**To see the conditions layer work:** open `/conditions` and press **Refresh now** in the
Data sources panel.

---

## Putting the whole thing online

```bash
./scripts/golive.sh
```

One command: starts the API if it is not running, opens a public Cloudflare
tunnel to it, rebuilds the SPA against that URL and deploys to Firebase
Hosting. The live site then has a real backend — bookings, payments, the
grounded assistant and live ride matching all work.

**Why a tunnel.** Firebase Hosting serves static files only; it cannot run
FastAPI or WebSockets. Cloud Run can, but needs billing enabled on the GCP
project. A Cloudflare quick tunnel needs no account and does support
WebSockets, so it is the shortest path from "static site" to "working app".

**What it costs you.** The tunnel lives only as long as the machine and the
process do, and its hostname changes on every restart — hence the rebuild
and redeploy each time. It is a demo mechanism, not hosting.

**The permanent version** is `render.yaml`: push the repo, create a
Blueprint on Render (free tier, WebSockets supported), then build once with
`VITE_API_BASE` set to the Render URL and the address stops moving.

---

## Deploying

The Docker image builds the SPA and serves it from the same origin as the API, so there is no
CORS or separate static host to configure.

```bash
docker compose up --build        # → http://localhost:8000
```

This brings up PostGIS alongside the app and points `DATABASE_URL` at it; tables and seed
data are created on first boot. Every other integration stays optional — pass the keys you
have through the environment.

**Render** — push the repo, then *New → Blueprint* and point it at `render.yaml`. It
provisions a free PostgreSQL instance and wires `DATABASE_URL` automatically; run
`CREATE EXTENSION postgis;` once against it if the startup attempt lacks permission.
Secrets are marked `sync: false`, so they are set in the dashboard and never committed.

**Firebase Hosting + Cloud Run** — Firebase Hosting serves static files only and cannot
run the API or WebSockets. Deploy the container to Cloud Run, build the SPA with
`VITE_API_BASE` set to the Cloud Run URL, and host `frontend/dist` on Firebase. Point the
WebSocket straight at Cloud Run rather than through a Hosting rewrite.

**Railway** — `railway up` picks up `railway.json` and builds the same Dockerfile.

Both platforms support WebSockets on their free tiers, which the matching flow requires.

---

## What is still prototype

Stated plainly, because the rest of this README claims a lot:

- **NHA road status is seeded.** The scraper is written and tested against NHA-shaped
  HTML, but the live site blocks servers with a 403. Weather, hazards, earthquakes, the
  PMD advisory and ride routing are genuinely live.
- **No real drivers.** Operator offers come from a labelled stand-in unless a real
  operator app is connected. Ride pricing, distances, records and the matching protocol
  are all real; the humans are not.
- **In-flight trip requests are in-memory.** Completed bookings, payments, users, devices
  and the whole conditions layer persist to PostgreSQL. The dispatcher's open requests do
  not, so it runs single-process; Redis is the next step for multi-worker deployment.
- **Payment credentials are not provisioned.** The JazzCash and Easypaisa signing,
  redirect and callback-verification code is complete and unit-tested against known
  vectors, but a real transaction needs merchant onboarding. The sandbox gateway runs the
  identical flow offline.
- **Traveler reports do not yet move `confidence`.** The field is stored and displayed;
  nothing writes to it from user submissions.
- **No operator-side onboarding.** Operators are seeded and verified by hand rather than
  registering and uploading documents.

## Stack

React 18 · Vite · Tailwind CSS · Framer Motion · Firebase (Auth + FCM) ·
FastAPI · WebSockets · SQLAlchemy 2 · PostgreSQL 16 + PostGIS 3.4 ·
BeautifulSoup · Open-Meteo · GDACS · USGS · OSRM · Gemini ·
JazzCash / Easypaisa · Docker
