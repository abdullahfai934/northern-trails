"""Seed data layer for Northern Trails.

In production these tables live in PostgreSQL/PostGIS and the live-conditions
rows are refreshed by the NHA/district scraper + OpenWeatherMap poller.
Here they are in-memory so the prototype runs with zero infrastructure.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

NOW = lambda: datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


# --------------------------------------------------------------------------
# Regions / routes that the live-conditions layer tracks
# --------------------------------------------------------------------------
ROUTES = [
    {
        "id": "kkh-gilgit-hunza",
        "name": "KKH: Gilgit → Hunza (Karimabad)",
        "valley": "Hunza",
        "distance_km": 100,
        "drive_hours": 2.5,
        "elevation_m": 2438,
        "status": "open",
        "status_note": "Carriageway clear. Routine maintenance near Rakaposhi View Point, expect 10 min delay.",
        "source": "NHA Road Advisory + 3 traveler reports",
        "source_url": "https://nha.gov.pk/road-conditions",
        "confidence": 0.93,
        "updated_at": iso(NOW() - timedelta(minutes=18)),
        "traveler_reports": 3,
        "permits": [],
        "hazards": [],
    },
    {
        "id": "kkh-hunza-khunjerab",
        "name": "KKH: Hunza → Khunjerab Pass",
        "valley": "Hunza",
        "distance_km": 170,
        "drive_hours": 4.0,
        "elevation_m": 4693,
        "status": "restricted",
        "status_note": "Pass open 09:00 to 16:00 only. Snow walls at Dhee; 4x4 with chains advised after 15:00.",
        "source": "Khunjerab NP control post + OpenWeatherMap",
        "source_url": "https://nha.gov.pk/road-conditions",
        "confidence": 0.88,
        "updated_at": iso(NOW() - timedelta(minutes=42)),
        "traveler_reports": 7,
        "permits": ["Khunjerab National Park entry fee (PKR 800 local / USD 8 foreign)"],
        "hazards": ["Black ice after 16:00", "Altitude sickness above 4,000 m"],
    },
    {
        "id": "skardu-road",
        "name": "Gilgit → Skardu (Skardu Road / S-1)",
        "valley": "Skardu",
        "distance_km": 167,
        "drive_hours": 5.0,
        "elevation_m": 2228,
        "status": "caution",
        "status_note": "Single-lane diversion at Thowar due to rockfall clearance. Convoy released every 30 min, 06:00 to 19:00.",
        "source": "GB District Admin (Skardu) announcement + 11 traveler reports",
        "source_url": "https://gilgitbaltistan.gov.pk",
        "confidence": 0.81,
        "updated_at": iso(NOW() - timedelta(minutes=9)),
        "traveler_reports": 11,
        "permits": [],
        "hazards": ["Rockfall zone km 88 to 92", "No fuel between Jaglot and Thowar"],
    },
    {
        "id": "deosai-plains",
        "name": "Skardu → Deosai Plains → Astore",
        "valley": "Deosai",
        "distance_km": 135,
        "drive_hours": 6.5,
        "elevation_m": 4114,
        "status": "seasonal",
        "status_note": "Open mid-June to mid-October. Currently trafficable; Sheosar Lake track soft after rain, high clearance 4x4 only.",
        "source": "Deosai National Park office",
        "source_url": "https://gilgitbaltistan.gov.pk",
        "confidence": 0.9,
        "updated_at": iso(NOW() - timedelta(hours=2)),
        "traveler_reports": 4,
        "permits": ["Deosai National Park permit (PKR 500 local / USD 12 foreign)"],
        "hazards": ["No mobile coverage for 60 km", "Brown bear habitat, do not camp unattended"],
    },
    {
        "id": "shandur-chitral",
        "name": "Gilgit → Shandur Pass → Chitral",
        "valley": "Chitral",
        "distance_km": 254,
        "drive_hours": 12.0,
        "elevation_m": 3738,
        "status": "closed",
        "status_note": "Closed at Langar. Glacial melt has washed the causeway; NHA estimates 4 to 6 days for repair. Use Lowari Tunnel via Dir instead.",
        "source": "NHA Advisory 21-Sep + District Admin Chitral",
        "source_url": "https://nha.gov.pk/road-conditions",
        "confidence": 0.95,
        "updated_at": iso(NOW() - timedelta(minutes=55)),
        "traveler_reports": 6,
        "permits": [],
        "hazards": ["Causeway washout at Langar", "River crossing unsafe"],
    },
    {
        "id": "fairy-meadows",
        "name": "Raikot Bridge → Tato → Fairy Meadows",
        "valley": "Nanga Parbat",
        "distance_km": 16,
        "drive_hours": 1.5,
        "elevation_m": 3300,
        "status": "caution",
        "status_note": "Jeep track open to Tato. Local jeep union monopoly in force, so private vehicles not permitted past Raikot Bridge.",
        "source": "Raikot Jeep Union + 9 traveler reports",
        "source_url": "https://gilgitbaltistan.gov.pk",
        "confidence": 0.86,
        "updated_at": iso(NOW() - timedelta(minutes=31)),
        "traveler_reports": 9,
        "permits": ["Fairy Meadows community fee (PKR 300)"],
        "hazards": ["Exposed jeep track, no guard rails", "3 km uphill trek after Tato"],
    },
]

# --------------------------------------------------------------------------
# GLOF / hazard alerts (crowd + authority sourced)
# --------------------------------------------------------------------------
ALERTS = [
    {
        "id": "alert-shishper",
        "severity": "high",
        "kind": "GLOF",
        "title": "GLOF watch at Shishper Glacier, Hassanabad (Hunza)",
        "body": "Lake volume rising after 3 days above seasonal average temperature. PMD/GBDMA advise avoiding the Hassanabad nullah bed and the old bridge approach between 12:00 and 18:00.",
        "routes": ["kkh-gilgit-hunza", "kkh-hunza-khunjerab"],
        "source": "GB Disaster Management Authority",
        "issued_at": iso(NOW() - timedelta(hours=5)),
    },
    {
        "id": "alert-langar",
        "severity": "high",
        "kind": "Road closure",
        "title": "Shandur Pass closed at Langar",
        "body": "Causeway washout. All Gilgit to Chitral traffic must reroute via Lowari Tunnel (adds ~9 hours).",
        "routes": ["shandur-chitral"],
        "source": "NHA Advisory 21-Sep",
        "issued_at": iso(NOW() - timedelta(minutes=55)),
    },
    {
        "id": "alert-thowar",
        "severity": "medium",
        "kind": "Rockfall",
        "title": "Convoy-only section at Thowar (Skardu Road)",
        "body": "Rockfall clearance in progress. Plan Gilgit departure before 15:00 to clear the diversion in daylight.",
        "routes": ["skardu-road"],
        "source": "District Admin Skardu",
        "issued_at": iso(NOW() - timedelta(minutes=9)),
    },
]

# --------------------------------------------------------------------------
# Weather (shape mirrors the OpenWeatherMap fields the poller stores)
# --------------------------------------------------------------------------
WEATHER = [
    {"city": "Karimabad (Hunza)", "temp_c": 17, "feels_c": 15, "condition": "Partly cloudy",
     "icon": "cloud-sun", "wind_kmh": 12, "humidity": 38, "visibility_km": 14,
     "forecast": [("Mon", 18, 6, "sun"), ("Tue", 16, 5, "cloud-sun"), ("Wed", 12, 2, "rain")]},
    {"city": "Skardu", "temp_c": 21, "feels_c": 20, "condition": "Clear",
     "icon": "sun", "wind_kmh": 8, "humidity": 24, "visibility_km": 20,
     "forecast": [("Mon", 23, 9, "sun"), ("Tue", 22, 8, "sun"), ("Wed", 19, 7, "cloud-sun")]},
    {"city": "Khunjerab Pass", "temp_c": -2, "feels_c": -9, "condition": "Snow showers",
     "icon": "snow", "wind_kmh": 34, "humidity": 71, "visibility_km": 3,
     "forecast": [("Mon", 0, -11, "snow"), ("Tue", 1, -10, "cloud"), ("Wed", -3, -14, "snow")]},
    {"city": "Chitral", "temp_c": 26, "feels_c": 26, "condition": "Sunny",
     "icon": "sun", "wind_kmh": 6, "humidity": 30, "visibility_km": 18,
     "forecast": [("Mon", 28, 13, "sun"), ("Tue", 27, 12, "sun"), ("Wed", 25, 11, "cloud-sun")]},
    {"city": "Deosai Plains", "temp_c": 4, "feels_c": -1, "condition": "Windy, clear",
     "icon": "wind", "wind_kmh": 29, "humidity": 41, "visibility_km": 25,
     "forecast": [("Mon", 7, -4, "sun"), ("Tue", 6, -5, "cloud-sun"), ("Wed", 3, -8, "snow")]},
    {"city": "Fairy Meadows", "temp_c": 9, "feels_c": 6, "condition": "Light rain",
     "icon": "rain", "wind_kmh": 15, "humidity": 66, "visibility_km": 6,
     "forecast": [("Mon", 11, 2, "rain"), ("Tue", 13, 3, "cloud-sun"), ("Wed", 14, 4, "sun")]},
]

# --------------------------------------------------------------------------
# Verified tour operators
# --------------------------------------------------------------------------
OPERATORS = [
    {
        "id": "op-karakoram",
        "name": "Karakoram Expeditions",
        "base": "Gilgit",
        "rating": 4.8, "trips": 412, "since": 2014,
        "verified": True,
        "verification": {
            "tourism_dept_reg": "GB-TO-2014-0187",
            "verified_on": "2026-03-04",
            "checks": ["GB Tourism Dept. registration", "CNIC of proprietor", "Vehicle fitness (3)", "Driver licence (4)", "Liability insurance"],
        },
        "vehicles": ["Toyota Land Cruiser 4x4", "Toyota Hiace", "Prado"],
        "languages": ["Urdu", "English", "Burushaski"],
        "response_min": 2,
        "avatar_hue": 198,
    },
    {
        "id": "op-baltistan",
        "name": "Baltistan Trails",
        "base": "Skardu",
        "rating": 4.9, "trips": 288, "since": 2017,
        "verified": True,
        "verification": {
            "tourism_dept_reg": "GB-TO-2017-0431",
            "verified_on": "2026-05-19",
            "checks": ["GB Tourism Dept. registration", "CNIC of proprietor", "Vehicle fitness (5)", "Driver licence (5)", "Liability insurance", "First-aid certification"],
        },
        "vehicles": ["Land Cruiser 4x4", "Hilux Revo", "Coaster"],
        "languages": ["Urdu", "English", "Balti"],
        "response_min": 3,
        "avatar_hue": 262,
    },
    {
        "id": "op-hunza-guides",
        "name": "Hunza Valley Guides",
        "base": "Karimabad",
        "rating": 4.7, "trips": 356, "since": 2012,
        "verified": True,
        "verification": {
            "tourism_dept_reg": "GB-TO-2012-0044",
            "verified_on": "2026-01-22",
            "checks": ["GB Tourism Dept. registration", "CNIC of proprietor", "Vehicle fitness (2)", "Driver licence (3)", "Mountain guide licence"],
        },
        "vehicles": ["Prado", "Suzuki APV", "Jeep Willys"],
        "languages": ["Urdu", "English", "Burushaski", "Wakhi"],
        "response_min": 2,
        "avatar_hue": 158,
    },
    {
        "id": "op-chitral",
        "name": "Chitral Highland Tours",
        "base": "Chitral",
        "rating": 4.6, "trips": 174, "since": 2019,
        "verified": True,
        "verification": {
            "tourism_dept_reg": "KP-TO-2019-0912",
            "verified_on": "2026-04-11",
            "checks": ["KP Tourism Dept. registration", "CNIC of proprietor", "Vehicle fitness (2)", "Driver licence (2)"],
        },
        "vehicles": ["Land Cruiser 4x4", "Hiace"],
        "languages": ["Urdu", "English", "Khowar"],
        "response_min": 5,
        "avatar_hue": 28,
    },
    {
        "id": "op-nanga",
        "name": "Nanga Parbat Jeep Co.",
        "base": "Raikot",
        "rating": 4.5, "trips": 521, "since": 2010,
        "verified": True,
        "verification": {
            "tourism_dept_reg": "GB-TO-2010-0009",
            "verified_on": "2026-02-28",
            "checks": ["GB Tourism Dept. registration", "Jeep union membership", "Vehicle fitness (6)", "Driver licence (6)"],
        },
        "vehicles": ["Jeep Willys", "Land Cruiser 4x4"],
        "languages": ["Urdu", "Shina"],
        "response_min": 1,
        "avatar_hue": 340,
    },
]

# --------------------------------------------------------------------------
# Multi-day packages (browse-and-compare flow)
# --------------------------------------------------------------------------
PACKAGES = [
    {
        "id": "pkg-hunza-skardu-5",
        "title": "Hunza & Skardu Grand Circuit",
        "operator_id": "op-karakoram",
        "days": 5,
        "price_pkr": 78000,
        "pickup": "Islamabad",
        "destination": "Hunza",
        "group_size": "4-12",
        "rating": 4.8,
        "reviews": 96,
        "difficulty": "Easy",
        "tags": ["Culture", "Photography", "Road trip"],
        "hero": "hunza",
        "highlight": "Khunjerab Pass at 4,693 m and Shangrila in one loop",
        "photo_query": "Hunza Valley",
        "includes": ["4x4 transport", "3★ hotels", "Breakfast + dinner", "Licensed guide", "Khunjerab permit"],
        "excludes": ["Airfare", "Lunches", "Personal expenses"],
        "routes": ["kkh-gilgit-hunza", "kkh-hunza-khunjerab", "skardu-road"],
        "itinerary": [
            ("Day 1", "Islamabad → Chilas", "Drive the KKH along the Indus. Overnight Chilas."),
            ("Day 2", "Chilas → Karimabad", "Rakaposhi View Point, Hunza sunset from Eagle's Nest."),
            ("Day 3", "Khunjerab Pass", "Attabad Lake, Passu Cones, Pak-China border at 4,693 m."),
            ("Day 4", "Karimabad → Skardu", "Skardu Road via Jaglot. Shangrila in the evening."),
            ("Day 5", "Skardu → Islamabad", "Flight or return drive via Naran."),
        ],
    },
    {
        "id": "pkg-skardu-deosai-4",
        "title": "Skardu, Deosai & Sheosar Lake",
        "operator_id": "op-baltistan",
        "days": 4,
        "price_pkr": 62000,
        "pickup": "Skardu",
        "destination": "Deosai",
        "group_size": "2-8",
        "rating": 4.9,
        "reviews": 61,
        "difficulty": "Moderate",
        "tags": ["Wildlife", "Camping", "Lakes"],
        "hero": "deosai",
        "highlight": "Camp beside Sheosar Lake on the second-highest plateau on earth",
        "photo_query": "Deosai plains",
        "includes": ["High-clearance 4x4", "Camping gear", "All meals", "Deosai permit", "Park ranger escort"],
        "excludes": ["Sleeping bag hire", "Tips"],
        "routes": ["skardu-road", "deosai-plains"],
        "itinerary": [
            ("Day 1", "Arrive Skardu", "Acclimatise. Upper Kachura and Shangrila Lake."),
            ("Day 2", "Skardu → Deosai", "Sadpara Lake, cross onto the Deosai Plains. Camp at Bara Pani."),
            ("Day 3", "Sheosar Lake", "Sunrise over Nanga Parbat, brown-bear spotting with a ranger."),
            ("Day 4", "Deosai → Skardu", "Return via Sadpara, Skardu bazaar, departure."),
        ],
    },
    {
        "id": "pkg-fairy-meadows-3",
        "title": "Fairy Meadows & Nanga Parbat Base Camp",
        "operator_id": "op-nanga",
        "days": 3,
        "price_pkr": 41000,
        "pickup": "Chilas",
        "destination": "Fairy Meadows",
        "group_size": "2-10",
        "rating": 4.5,
        "reviews": 143,
        "difficulty": "Challenging",
        "tags": ["Trekking", "Mountains"],
        "hero": "fairy",
        "highlight": "Wake up facing the north face of Nanga Parbat",
        "photo_query": "Fairy Meadows",
        "includes": ["Raikot jeep", "Wooden hut stay", "All meals", "Trek guide", "Community fee"],
        "excludes": ["Porter", "Trekking poles"],
        "routes": ["fairy-meadows"],
        "itinerary": [
            ("Day 1", "Chilas → Fairy Meadows", "Raikot jeep track to Tato, then a 3 km uphill trek."),
            ("Day 2", "Base Camp trek", "Full-day trek to Nanga Parbat Base Camp (Beyal → View Point)."),
            ("Day 3", "Descend", "Trek to Tato, jeep to Raikot Bridge, onward transfer."),
        ],
    },
    {
        "id": "pkg-chitral-kalash-6",
        "title": "Chitral & Kalash Valleys Cultural Week",
        "operator_id": "op-chitral",
        "days": 6,
        "price_pkr": 88000,
        "pickup": "Islamabad",
        "destination": "Chitral",
        "group_size": "4-14",
        "rating": 4.6,
        "reviews": 38,
        "difficulty": "Easy",
        "tags": ["Culture", "Festival", "Heritage"],
        "hero": "kalash",
        "highlight": "Kalash festivals, Chitral Fort and the Shandur crossing",
        "photo_query": "Bumburet Kalash valley",
        "includes": ["Transport via Lowari Tunnel", "Guest houses", "Breakfast + dinner", "Kalash cultural guide"],
        "excludes": ["Airfare", "Camera fees at festivals"],
        "routes": ["shandur-chitral"],
        "itinerary": [
            ("Day 1", "Islamabad → Dir", "Motorway to Chakdara, overnight Dir."),
            ("Day 2", "Dir → Chitral", "Lowari Tunnel crossing, Chitral Fort and Shahi Masjid."),
            ("Day 3", "Bumburet (Kalash)", "Kalash village, museum, homestay dinner."),
            ("Day 4", "Rumbur & Birir", "Two more Kalash valleys, walnut groves."),
            ("Day 5", "Garam Chashma", "Hot springs and the Afghan border viewpoint."),
            ("Day 6", "Chitral → Islamabad", "Return via Lowari Tunnel."),
        ],
    },
    {
        "id": "pkg-hunza-short-3",
        "title": "Hunza Weekender: Attabad & Passu",
        "operator_id": "op-hunza-guides",
        "days": 3,
        "price_pkr": 36000,
        "pickup": "Gilgit",
        "destination": "Hunza",
        "group_size": "2-6",
        "rating": 4.7,
        "reviews": 112,
        "difficulty": "Easy",
        "tags": ["Short break", "Lakes", "Photography"],
        "hero": "attabad",
        "highlight": "Attabad's turquoise water and the Passu Cones in three days",
        "photo_query": "Attabad Lake",
        "includes": ["Prado transport", "Boutique hotel", "Breakfast", "Local guide"],
        "excludes": ["Boat ride at Attabad", "Meals other than breakfast"],
        "routes": ["kkh-gilgit-hunza"],
        "itinerary": [
            ("Day 1", "Gilgit → Karimabad", "Rakaposhi View Point, Baltit Fort at golden hour."),
            ("Day 2", "Attabad & Passu", "Attabad Lake, Hussaini suspension bridge, Passu Cones."),
            ("Day 3", "Return", "Altit Fort, Hopper Glacier viewpoint, drive to Gilgit."),
        ],
    },
    {
        "id": "pkg-k2-basecamp-14",
        "title": "K2 Base Camp & Concordia Trek",
        "operator_id": "op-baltistan",
        "days": 14,
        "price_pkr": 310000,
        "pickup": "Skardu",
        "destination": "Skardu",
        "group_size": "4-10",
        "rating": 4.9,
        "reviews": 27,
        "difficulty": "Expedition",
        "tags": ["Trekking", "Expedition", "Glacier"],
        "hero": "k2",
        "highlight": "Walk the Baltoro to Concordia beneath four 8,000 m peaks",
        "photo_query": "Concordia K2 Karakoram",
        "includes": ["Porters", "Expedition cook", "Tents + mess", "All permits", "Satellite phone", "Evacuation insurance"],
        "excludes": ["Personal climbing gear", "International flights"],
        "routes": ["skardu-road"],
        "itinerary": [
            ("Day 1-2", "Skardu → Askole", "Jeep to the trailhead, briefing and gear check."),
            ("Day 3-6", "Askole → Urdukas", "Along the Braldu, onto the Baltoro Glacier."),
            ("Day 7-8", "Concordia", "Throne room of the mountain gods, with four 8,000ers."),
            ("Day 9", "K2 Base Camp", "Gilkey Memorial and return to Concordia."),
            ("Day 10-14", "Return", "Retrace the Baltoro to Askole, jeep to Skardu."),
        ],
    },
]

# --------------------------------------------------------------------------
# On-demand ride/guide catalogue (real-time request-and-match flow)
# --------------------------------------------------------------------------
SERVICE_TYPES = [
    {"id": "jeep", "label": "4x4 Jeep + driver", "icon": "jeep", "base_pkr": 9000, "per_km": 95,
     "note": "Rough tracks, glaciers, Fairy Meadows"},
    {"id": "car", "label": "Car / Prado transfer", "icon": "car", "base_pkr": 5500, "per_km": 70,
     "note": "Paved KKH point-to-point"},
    {"id": "guide", "label": "Same-day local guide", "icon": "guide", "base_pkr": 6000, "per_km": 0,
     "note": "Valley walks, forts, language help"},
    {"id": "porter", "label": "Porter / trek support", "icon": "porter", "base_pkr": 4500, "per_km": 0,
     "note": "Day treks and base-camp approaches"},
]

CITIES = ["Gilgit", "Karimabad (Hunza)", "Passu", "Skardu", "Khaplu", "Chilas",
          "Raikot Bridge", "Astore", "Chitral", "Naltar", "Attabad Lake", "Deosai"]


# --------------------------------------------------------------------------
# Destinations
#
# The planner compares these against what a traveler asked for. Every field
# is either a published figure or a property of the terrain, so a comparison
# built from them can be explained rather than asserted:
#
#   weather_city  the station whose live reading represents the destination
#   routes        the tracked road segments you must clear to get there;
#                 a destination is only as reachable as its worst segment
#   interests     what the place is actually good for, matched against the
#                 traveler's stated interests
#   best_months   1-12, the months the destination is normally in season
#   daily_cost_pkr  typical per-person, per-day ground cost, used to estimate
#                 a trip before any operator package is involved
# --------------------------------------------------------------------------
DESTINATIONS = [
    {
        "id": "dest-hunza",
        "photo_query": "Hunza Valley",
        "lat": 36.3167, "lon": 74.6589,
        "name": "Hunza",
        "valley": "Hunza",
        "weather_city": "Karimabad (Hunza)",
        "routes": ["kkh-gilgit-hunza", "kkh-hunza-khunjerab"],
        "elevation_m": 2438,
        "interests": ["Culture", "Photography", "Lakes", "Mountains", "Short break", "Road trip"],
        "best_months": [4, 5, 6, 7, 8, 9, 10, 11],
        "daily_cost_pkr": 12000,
        "drive_hours_from": {"Islamabad": 16.0, "Gilgit": 2.5, "Chilas": 6.0, "Skardu": 7.5},
        "attractions": ["Baltit Fort", "Altit Fort", "Attabad Lake", "Passu Cones",
                        "Khunjerab Pass", "Rakaposhi View Point"],
        "blurb": "Fortified valley towns, apricot terraces and the easiest high-altitude "
                 "scenery in the north to reach on sealed road.",
    },
    {
        "id": "dest-skardu",
        "photo_query": "Skardu",
        "lat": 35.2971, "lon": 75.6333,
        "name": "Skardu",
        "valley": "Skardu",
        "weather_city": "Skardu",
        "routes": ["skardu-road"],
        "elevation_m": 2228,
        "interests": ["Mountains", "Trekking", "Lakes", "Expedition", "Glacier", "Photography"],
        "best_months": [4, 5, 6, 7, 8, 9, 10],
        "daily_cost_pkr": 13500,
        "drive_hours_from": {"Islamabad": 20.0, "Gilgit": 6.0, "Chilas": 10.0, "Skardu": 0.0},
        "attractions": ["Shangrila / Lower Kachura", "Upper Kachura Lake", "Shigar Fort",
                        "Khaplu Palace", "Cold Desert Sarfaranga", "K2 base-camp trailhead"],
        "blurb": "The staging town for Baltistan and the Karakoram giants, with lakes and "
                 "cold desert at the valley floor and 8000ers up the side valleys.",
    },
    {
        "id": "dest-deosai",
        "photo_query": "Deosai plains",
        "lat": 35.02, "lon": 75.43,
        "name": "Deosai",
        "valley": "Deosai",
        "weather_city": "Deosai Plains",
        "routes": ["skardu-road", "deosai-plains"],
        "elevation_m": 4114,
        "interests": ["Wildlife", "Camping", "Lakes", "Photography", "Mountains"],
        "best_months": [6, 7, 8, 9],
        "daily_cost_pkr": 15500,
        "drive_hours_from": {"Islamabad": 23.0, "Gilgit": 9.0, "Chilas": 13.0, "Skardu": 3.0},
        "attractions": ["Sheosar Lake", "Bara Pani", "Kala Pani", "Himalayan brown bear range"],
        "blurb": "The second-highest plateau on earth, with a short, weather-bound season "
                 "of wildflowers, brown bear and camping above 4,000 m.",
    },
    {
        "id": "dest-fairy-meadows",
        "photo_query": "Fairy Meadows",
        "lat": 35.3878, "lon": 74.5783,
        "name": "Fairy Meadows",
        "valley": "Nanga Parbat",
        "weather_city": "Fairy Meadows",
        "routes": ["fairy-meadows"],
        "elevation_m": 3300,
        "interests": ["Trekking", "Mountains", "Camping", "Photography"],
        "best_months": [5, 6, 7, 8, 9, 10],
        "daily_cost_pkr": 11000,
        "drive_hours_from": {"Islamabad": 12.0, "Gilgit": 3.5, "Chilas": 1.5, "Skardu": 9.0},
        "attractions": ["Nanga Parbat north face", "Beyal Camp", "Raikot Glacier viewpoint"],
        "blurb": "A meadow at the foot of the world's ninth-highest mountain, reached "
                 "by jeep track and a walk-in. The shortest big-mountain trip in the north.",
    },
    {
        "id": "dest-chitral",
        "photo_query": "Bumburet Kalash valley",
        "lat": 35.8511, "lon": 71.7864,
        "name": "Chitral",
        "valley": "Chitral",
        "weather_city": "Chitral",
        "routes": ["shandur-chitral"],
        "elevation_m": 1500,
        "interests": ["Culture", "Festival", "Heritage", "Mountains", "Photography"],
        "best_months": [4, 5, 6, 7, 8, 9, 10],
        "daily_cost_pkr": 12500,
        "drive_hours_from": {"Islamabad": 14.0, "Gilgit": 12.0, "Chilas": 14.0, "Skardu": 18.0},
        "attractions": ["Kalash valleys (Bumburet, Rumbur, Birir)", "Chitral Fort",
                        "Shandur Pass", "Tirich Mir viewpoints"],
        "blurb": "Hindu Kush rather than Karakoram, and the Kalash valleys. The one "
                 "destination here reached from the Peshawar side, not the KKH.",
    },
]


def destination_index():
    return {d["id"]: d for d in DESTINATIONS}


def destination_by_name(name: str) -> dict | None:
    n = (name or "").strip().lower()
    return next((d for d in DESTINATIONS if d["name"].lower() == n), None)


def route_index():
    return {r["id"]: r for r in ROUTES}


def operator_index():
    return {o["id"]: o for o in OPERATORS}


def package_with_operator(pkg: dict) -> dict:
    ops = operator_index()
    out = dict(pkg)
    out["operator"] = ops[pkg["operator_id"]]
    return out


def package_index():
    return {p["id"]: p for p in PACKAGES}


# --------------------------------------------------------------------------
# Package listing fields
#
#   highlight     one line for the card, under the title
#   photo_query   what the photo service searches for; the destination name
#                 alone often returns maps or portraits
#   images        uploaded or pasted photo URLs, shown before searched ones
#   operator_url  the operator's own page for this package
#   whatsapp      the operator's WhatsApp number, digits only with country code
#   source        "seed" for the rows above, "admin" for ones added in the app
#
# The seeded operators are sample businesses, so they carry no website or
# WhatsApp number: a made-up URL or phone number would send a traveler to a
# real stranger. The card hides those two buttons until an admin fills them in.
# --------------------------------------------------------------------------
PACKAGE_DEFAULTS = {
    "highlight": "", "photo_query": "", "images": [], "operator_url": "",
    "whatsapp": "", "source": "seed",
}


def normalize_package(pkg: dict) -> dict:
    out = {**PACKAGE_DEFAULTS, **pkg}
    out["images"] = list(out.get("images") or [])
    if not out["photo_query"]:
        dest = destination_by_name(out.get("destination", ""))
        out["photo_query"] = (dest or {}).get("photo_query") or out.get("destination", "")
    return out


PACKAGES[:] = [normalize_package(p) for p in PACKAGES]
