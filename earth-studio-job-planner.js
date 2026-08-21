(function earthStudioJobPlanner(globalScope) {
  "use strict";

  const DEFAULT_OUTPUT_DIR = "/home/vidtoolz/Videos/vidtoolz-earth-studio-jobs";
  const VERSION = "0.9.4"; // v0.9.4 semantic-space composition constraint; explicit tilt remains authoritative. v0.9.3 evidence-integrity hardening (profile v4): role-correct easing — the Google-template heavy deceleration lands on SEGMENT-BOUNDARY keyframes (positional 0.99·gap/0.99, altitude 2.5·gap/1.0 — the template authors it on the keyframe ENDING the big move, an interior keyframe, NOT the track final), track finals get the gentle multi-reference arrival (0.25/0.29, infl 0.4), interior influence is corpus-DERIVED (0.43; darien-gap 0.35 participates). // v0.9.2 corpus-rebuilt profile v3: deterministic derivation (scripts/rebuild-earth-studio-motion-profile.js) over 4 approved internet references; family-aware arrivals — APPROACH finals use the Google Zoom-To template full-gap deceleration (x 0.99·gap, influence 0.99, via 2 independent template exports), others the multi-reference 0.31/0.4. // v0.9.1 internet-reference motion profile v2: gap-relative eased handles + final settle-hold, derived ONLY from internet-sourced human-authored .esp references (config/earth-studio-motion/, operator directive: local/generated files do not qualify) — ES preserves unadorned keyframes as hard-linear, so easing must be authored. (v0.8.0 fly→orbit geometry: a fly/zoom immediately followed by an orbit around the same resolved target terminates at the orbit's ring entry (plan-annotated lookahead, ends_at_orbit_entry), so the pair plays as one continuous move — no sideways slide onto the ring. (v0.7.0: hover holds camera, orbit-scoped modifiers, fragment merge, "tilt N degrees", global duration strip, antimeridian seam pairs.)
  const FRAME_RATE = 30;
  const DEFAULT_ALTITUDE_M = 2500;
  const MIN_ALTITUDE_M = 150;
  const MAX_ALTITUDE_M = 63170000; // Earth Studio's documented altitude ceiling
  const SPACE_ALTITUDE_M = 12000000; // "from space": whole-globe view
  const EARTH_RADIUS_M = 6371000;
  const EARTH_STUDIO_DEFAULT_FOV_DEG = 20;
  const SPACE_ZOOM_MIN_LIMB_INSET_FRACTION = 0.25;
  const SPACE_ZOOM_TARGET_LIMB_INSET_FRACTION = 0.30;
  const SPACE_ZOOM_COMPOSITION_SAMPLES = 16;
  const EXPECTED_FILES = [
    "README.md",
    "shot-plan.json",
    "shot-plan.md",
    "route.kml",
    "earth-studio-build-checklist.md",
    "earth-studio.esp",
  ];

  // Per-action BASE defaults so a bare "fly to Paris, then orbit" still
  // produces a complete, renderable plan. Real Earth Studio playback of the
  // first acceptance rounds proved flat defaults unusable ("too fast to be
  // intelligible"), so defaults scale with the move's magnitude — flight
  // distance, orbit revolutions, zoom altitude ratio — via defaultDuration().
  // fly_to/zoom values are bases; orbit is seconds PER REVOLUTION. Tilt in
  // degrees from straight-down (0 = top-down map view, ~70 = horizon).
  const DEFAULT_DURATION_S = { fly_to: 4, hover: 3, orbit: 10, zoom_in: 3, zoom_out: 4 };
  const DEFAULT_TILT_DEG = { fly_to: 45, hover: 50, orbit: 60, zoom_in: 45, zoom_out: 35 };
  // Fraction of a move that ends on an orbit ring during which the camera tips
  // from its travelling angle into the orbit's angle. Concentrating the tip near
  // the ring entry keeps the earlier part of the move a single clean intention.
  const ORBIT_ENTRY_TILT_MAX_RATE_DEG_PER_S = 12;
  // Orbit circle fidelity. The exported ground path is a POLYGON through the
  // orbit samples, so between two samples the radius dips to R·cos(step/2):
  // the legacy 30° step breathes 3.4% of the radius (measured 41 m on a 1185 m
  // orbit) — a visible in-out pulse 12× per revolution. 10° steps breathe
  // 0.38%, below the visual threshold at orbit distances. Orbit geometry is
  // precisely the case where interior keyframes earn their place: they ARE the
  // circle, not decoration.
  const ORBIT_SAMPLE_STEP_DEG = 10;
  // Ring acquisition (orbit Phase B). An orbit rides a ring of
  // altitude*tan(tilt) around its subject and faces it. A camera arriving from a
  // hover, a hold or the wrong pitch is NOT yet in that geometry, and letting it
  // reach the geometry while the sweep is already running is what produced the
  // visible slide. Acquisition gets its own bounded phase so the sweep can hold
  // radius, altitude and pitch.
  const ORBIT_ENTRY_MIN_SECONDS = 0.5;
  const ORBIT_ENTRY_MAX_FRACTION = 0.35; // never eat more than this of the orbit
  const ORBIT_ENTRY_RING_TOLERANCE_FRACTION = 0.02;
  const ORBIT_ENTRY_RING_TOLERANCE_M = 25;
  const ORBIT_ENTRY_TILT_TOLERANCE_DEG = 0.5;
  // ── Long-crossing cruise ───────────────────────────────────────────────────
  // A cubic Bezier segment has exactly ONE velocity extremum, so a move built
  // from two keyframes can only ever read as accelerate -> peak -> decelerate.
  // No handle tuning changes that; it is the shape of the curve family. Measured
  // in real Earth Studio on a 105 s Helsinki -> New York crossing: speed reached
  // its peak at t=0.60 and was within 90% of peak for only about 15% of the
  // shot. That is one enormous ease, not a journey.
  //
  // A trapezoidal profile needs THREE segments, so the cruise gets its own two
  // keyframes. With the accel fraction a and decel fraction d, holding total
  // distance at 1 gives cruise speed v = 1 / (1 - (a+d)/2), and the cruise
  // boundaries sit at progress v*a/2 and 1 - v*d/2.
  //
  // Scoped to moves LONGER than the motion corpus evidences (its longest
  // reference is 45.6 s), so every short and mid-length move keeps the derived
  // profile byte-for-byte.
  const CRUISE_MIN_SECONDS = 45.6;
  const CRUISE_MIN_DISTANCE_M = 200000;
  const CRUISE_PROFILES = {
    balanced: { accel: 0.20, decel: 0.20 },
    late_settle: { accel: 0.15, decel: 0.25 },
  };
  const CRUISE_DEFAULT_PROFILE = null; // null = not in force; set by option/policy
  const ORBIT_LEGACY_SAMPLE_STEP_DEG = 30;
  const ZOOM_IN_ALTITUDE_M = 800;
  const ZOOM_OUT_ALTITUDE_M = 6000;

  // Render aspect ratios. VIDTOOLZ is a Shorts channel, so the GUI defaults to
  // 9:16; the module default stays 16:9 to match every artifact generated
  // before aspect existed (incl. the pinned London proof).
  const ASPECTS = {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "1:1": { width: 1080, height: 1080 },
  };
  const DEFAULT_ASPECT = "16:9";

  // Built-in gazetteer (offline, no external geocoding API). Explicit
  // "lat,lng" coordinates in the description are also supported, so any
  // location is reachable without a network call. Optional per-place fields:
  // - altitude_m: nicer default camera altitude for the place (landmarks sit
  //   lower, mountains higher).
  // - min_altitude_m: floor for high-terrain places so computed altitudes
  //   (zoom targets, arc endpoints) never end up inside the ground. Earth
  //   Studio altitude keyframes are meters above sea level, best-effort.
  const LOCATION_FIXTURES = {
    // Finland + Nordics + Baltics
    // ── Large-area geography (v0.9.5) ──────────────────────────────────────
    // Countries, regions, seas and continents. These exist so the operator can
    // frame a WHOLE geographic subject; the journey layer's auto-framing derives
    // the camera altitude from each one's scale class (see
    // earth-studio-journey.js FRAMING_SCALES). Coordinates are visual centroids
    // chosen for framing, not administrative capitals.
    // Nordic + Baltic countries
    "finland": { name: "Finland", latitude: 64.5, longitude: 26, scale: "country" },
    "sweden": { name: "Sweden", latitude: 62.5, longitude: 16.5, scale: "country" },
    "norway": { name: "Norway", latitude: 64.5, longitude: 13, scale: "country" },
    "denmark": { name: "Denmark", latitude: 56.1, longitude: 9.6, scale: "country" },
    "iceland": { name: "Iceland", latitude: 64.9, longitude: -18.6, scale: "country" },
    "estonia": { name: "Estonia", latitude: 58.6, longitude: 25.5, scale: "country" },
    "latvia": { name: "Latvia", latitude: 56.9, longitude: 24.9, scale: "country" },
    "lithuania": { name: "Lithuania", latitude: 55.2, longitude: 23.9, scale: "country" },
    // Other countries
    "united kingdom": { name: "United Kingdom", latitude: 54.4, longitude: -3, scale: "country" },
    "ireland": { name: "Ireland", latitude: 53.2, longitude: -8, scale: "country" },
    "france": { name: "France", latitude: 46.6, longitude: 2.4, scale: "country" },
    "germany": { name: "Germany", latitude: 51.1, longitude: 10.4, scale: "country" },
    "spain": { name: "Spain", latitude: 40.2, longitude: -3.7, scale: "country" },
    "portugal": { name: "Portugal", latitude: 39.6, longitude: -8.2, scale: "country" },
    "italy": { name: "Italy", latitude: 42.6, longitude: 12.6, scale: "country" },
    "switzerland": { name: "Switzerland", latitude: 46.8, longitude: 8.2, scale: "country" },
    "austria": { name: "Austria", latitude: 47.6, longitude: 13.4, scale: "country" },
    "netherlands": { name: "Netherlands", latitude: 52.2, longitude: 5.5, scale: "country" },
    "belgium": { name: "Belgium", latitude: 50.6, longitude: 4.6, scale: "country" },
    "poland": { name: "Poland", latitude: 52.1, longitude: 19.4, scale: "country" },
    "greece": { name: "Greece", latitude: 38.5, longitude: 23.8, scale: "country" },
    "turkey": { name: "Turkey", latitude: 39, longitude: 35.2, scale: "country" },
    "japan": { name: "Japan", latitude: 37.5, longitude: 137.5, scale: "country" },
    "new zealand": { name: "New Zealand", latitude: -41.3, longitude: 173.2, scale: "country" },
    // Regions
    "lapland": { name: "Lapland", latitude: 67.9, longitude: 26.5, scale: "region" },
    // The generic region rung is appropriate for local regions, but Scandinavia
    // is a multi-country geographic subject. Its physical north/south extent
    // must drive AUTO framing or a vertical shot only shows central Sweden.
    "scandinavia": { name: "Scandinavia", latitude: 63, longitude: 15, scale: "region", frame_span_m: 1600000 },
    "the alps": { name: "The Alps", latitude: 46.6, longitude: 10.2, scale: "region", terrain_morphology: "mountain_range", morphology_source: "curated_gazetteer" },
    "the sahara": { name: "The Sahara", latitude: 23.4, longitude: 12.6, scale: "region" },
    "the himalayas": { name: "The Himalayas", latitude: 29.3, longitude: 84.5, scale: "region" },
    "the amazon": { name: "The Amazon", latitude: -4.4, longitude: -61.5, scale: "region" },
    "the alps and dolomites": { name: "The Alps and Dolomites", latitude: 46.5, longitude: 11.5, scale: "region" },
    "tuscany": { name: "Tuscany", latitude: 43.4, longitude: 11.1, scale: "region" },
    "the scottish highlands": { name: "The Scottish Highlands", latitude: 57.3, longitude: -4.8, scale: "region" },
    // Seas and other water bodies
    "the baltic sea": { name: "The Baltic Sea", latitude: 58.3, longitude: 20.1, scale: "region" },
    "the mediterranean": { name: "The Mediterranean", latitude: 35.5, longitude: 15.5, scale: "subcontinent" },
    "the north sea": { name: "The North Sea", latitude: 56.2, longitude: 3.4, scale: "region" },
    "the gulf of finland": { name: "The Gulf of Finland", latitude: 59.9, longitude: 25.4, scale: "region" },
    "the red sea": { name: "The Red Sea", latitude: 20.4, longitude: 38.4, scale: "region" },
    "the pacific": { name: "The Pacific", latitude: 0, longitude: -160, scale: "continent" },
    // Large-area political geography
    "russia": { name: "Russia", latitude: 61, longitude: 100, scale: "country" },
    "canada": { name: "Canada", latitude: 58, longitude: -106, scale: "country" },
    "united states": { name: "United States", latitude: 39.8, longitude: -98.6, scale: "country" },
    "china": { name: "China", latitude: 35, longitude: 104, scale: "country" },
    "india": { name: "India", latitude: 22.5, longitude: 79.5, scale: "country" },
    "brazil": { name: "Brazil", latitude: -11, longitude: -53, scale: "country" },
    "taiwan": { name: "Taiwan", latitude: 23.7, longitude: 121, scale: "country" },
    // Sub-continental regions
    "southeast asia": { name: "Southeast Asia", latitude: 12, longitude: 105, scale: "subcontinent" },
    // Continents
    "europe": { name: "Europe", latitude: 52, longitude: 15, scale: "continent" },
    "africa": { name: "Africa", latitude: 2, longitude: 19, scale: "continent" },
    "asia": { name: "Asia", latitude: 45, longitude: 90, scale: "continent" },
    "north america": { name: "North America", latitude: 46, longitude: -100, scale: "continent" },
    "south america": { name: "South America", latitude: -16, longitude: -60, scale: "continent" },
    "australia": { name: "Australia", latitude: -25.3, longitude: 134, scale: "continent" },
    "antarctica": { name: "Antarctica", latitude: -82, longitude: 20, scale: "continent" },
    // Small named urban places the journey builder's examples use
    "senate square": { name: "Senate Square", latitude: 60.1695, longitude: 24.9522, altitude_m: 600, scale: "landmark" },
    "market square helsinki": { name: "Market Square, Helsinki", latitude: 60.1675, longitude: 24.9525, altitude_m: 600, scale: "landmark" },
    "helsinki": { name: "Helsinki", latitude: 60.1699, longitude: 24.9384 },
    "espoo": { name: "Espoo", latitude: 60.2055, longitude: 24.6559 },
    "tampere": { name: "Tampere", latitude: 61.4978, longitude: 23.761 },
    "turku": { name: "Turku", latitude: 60.4518, longitude: 22.2666 },
    "oulu": { name: "Oulu", latitude: 65.0121, longitude: 25.4651 },
    "rovaniemi": { name: "Rovaniemi", latitude: 66.5039, longitude: 25.7294 },
    "suomenlinna": { name: "Suomenlinna", latitude: 60.1454, longitude: 24.9881, altitude_m: 1200 },
    "helsinki cathedral": { name: "Helsinki Cathedral", latitude: 60.1704, longitude: 24.9522, altitude_m: 700 },
    "stockholm": { name: "Stockholm", latitude: 59.3293, longitude: 18.0686 },
    "gothenburg": { name: "Gothenburg", latitude: 57.7089, longitude: 11.9746 },
    "oslo": { name: "Oslo", latitude: 59.9139, longitude: 10.7522 },
    "bergen": { name: "Bergen", latitude: 60.3913, longitude: 5.3221 },
    "trondheim": { name: "Trondheim", latitude: 63.4305, longitude: 10.3951 },
    "lofoten": { name: "Lofoten", latitude: 68.2094, longitude: 13.6, altitude_m: 3000 },
    "geirangerfjord": { name: "Geirangerfjord", latitude: 62.1049, longitude: 7.2054, altitude_m: 2500, min_altitude_m: 1000, terrain_morphology: "fjord_channel", morphology_source: "curated_gazetteer" },
    "copenhagen": { name: "Copenhagen", latitude: 55.6761, longitude: 12.5683 },
    "reykjavik": { name: "Reykjavik", latitude: 64.1466, longitude: -21.9426 },
    "tallinn": { name: "Tallinn", latitude: 59.437, longitude: 24.7536 },
    "riga": { name: "Riga", latitude: 56.9496, longitude: 24.1052 },
    "vilnius": { name: "Vilnius", latitude: 54.6872, longitude: 25.2797 },
    // Europe
    "london": { name: "London", latitude: 51.5074, longitude: -0.1278 },
    "manchester": { name: "Manchester", latitude: 53.4808, longitude: -2.2426 },
    "edinburgh": { name: "Edinburgh", latitude: 55.9533, longitude: -3.1883 },
    "dublin": { name: "Dublin", latitude: 53.3498, longitude: -6.2603 },
    "paris": { name: "Paris", latitude: 48.8566, longitude: 2.3522 },
    "nice": { name: "Nice", latitude: 43.7102, longitude: 7.262 },
    "amsterdam": { name: "Amsterdam", latitude: 52.3676, longitude: 4.9041 },
    "brussels": { name: "Brussels", latitude: 50.8503, longitude: 4.3517 },
    "berlin": { name: "Berlin", latitude: 52.52, longitude: 13.405 },
    "munich": { name: "Munich", latitude: 48.1351, longitude: 11.582 },
    "hamburg": { name: "Hamburg", latitude: 53.5511, longitude: 9.9937 },
    "frankfurt": { name: "Frankfurt", latitude: 50.1109, longitude: 8.6821 },
    "vienna": { name: "Vienna", latitude: 48.2082, longitude: 16.3738 },
    "zurich": { name: "Zurich", latitude: 47.3769, longitude: 8.5417 },
    "geneva": { name: "Geneva", latitude: 46.2044, longitude: 6.1432 },
    "prague": { name: "Prague", latitude: 50.0755, longitude: 14.4378 },
    "warsaw": { name: "Warsaw", latitude: 52.2297, longitude: 21.0122 },
    "krakow": { name: "Krakow", latitude: 50.0647, longitude: 19.945 },
    "budapest": { name: "Budapest", latitude: 47.4979, longitude: 19.0402 },
    "rome": { name: "Rome", latitude: 41.9028, longitude: 12.4964 },
    "milan": { name: "Milan", latitude: 45.4642, longitude: 9.19 },
    "venice": { name: "Venice", latitude: 45.4408, longitude: 12.3155 },
    "florence": { name: "Florence", latitude: 43.7696, longitude: 11.2558 },
    "naples": { name: "Naples", latitude: 40.8518, longitude: 14.2681 },
    "madrid": { name: "Madrid", latitude: 40.4168, longitude: -3.7038 },
    "barcelona": { name: "Barcelona", latitude: 41.3874, longitude: 2.1686 },
    "seville": { name: "Seville", latitude: 37.3891, longitude: -5.9845 },
    "lisbon": { name: "Lisbon", latitude: 38.7223, longitude: -9.1393 },
    "porto": { name: "Porto", latitude: 41.1579, longitude: -8.6291 },
    "athens": { name: "Athens", latitude: 37.9838, longitude: 23.7275 },
    "istanbul": { name: "Istanbul", latitude: 41.0082, longitude: 28.9784 },
    "moscow": { name: "Moscow", latitude: 55.7558, longitude: 37.6173 },
    "st petersburg": { name: "St. Petersburg", latitude: 59.9311, longitude: 30.3609 },
    "kyiv": { name: "Kyiv", latitude: 50.4501, longitude: 30.5234 },
    "santorini": { name: "Santorini", latitude: 36.3932, longitude: 25.4615, altitude_m: 3000 },
    "matterhorn": { name: "Matterhorn", latitude: 45.9766, longitude: 7.6585, altitude_m: 6500, min_altitude_m: 5500, terrain_morphology: "sharp_peak", morphology_source: "curated_gazetteer" },
    "mont blanc": { name: "Mont Blanc", latitude: 45.8326, longitude: 6.8652, altitude_m: 7000, min_altitude_m: 6000, terrain_morphology: "sharp_peak", morphology_source: "curated_gazetteer" },
    "neuschwanstein castle": { name: "Neuschwanstein Castle", latitude: 47.5576, longitude: 10.7498, altitude_m: 1800, min_altitude_m: 1400 },
    "eiffel tower": { name: "Eiffel Tower", latitude: 48.8584, longitude: 2.2945, altitude_m: 1000 },
    "louvre": { name: "Louvre", latitude: 48.8606, longitude: 2.3376, altitude_m: 700 },
    "big ben": { name: "Big Ben", latitude: 51.5007, longitude: -0.1246, altitude_m: 700 },
    "tower bridge": { name: "Tower Bridge", latitude: 51.5055, longitude: -0.0754, altitude_m: 700 },
    "buckingham palace": { name: "Buckingham Palace", latitude: 51.5014, longitude: -0.1419, altitude_m: 700 },
    "colosseum": { name: "Colosseum", latitude: 41.8902, longitude: 12.4922, altitude_m: 700 },
    "vatican": { name: "Vatican", latitude: 41.9022, longitude: 12.4539, altitude_m: 800 },
    "acropolis": { name: "Acropolis", latitude: 37.9715, longitude: 23.7257, altitude_m: 800 },
    "sagrada familia": { name: "Sagrada Familia", latitude: 41.4036, longitude: 2.1744, altitude_m: 700 },
    "brandenburg gate": { name: "Brandenburg Gate", latitude: 52.5163, longitude: 13.3777, altitude_m: 600 },
    "red square": { name: "Red Square", latitude: 55.7539, longitude: 37.6208, altitude_m: 800 },
    "hagia sophia": { name: "Hagia Sophia", latitude: 41.0086, longitude: 28.9802, altitude_m: 700 },
    // Africa + Middle East
    "cairo": { name: "Cairo", latitude: 30.0444, longitude: 31.2357 },
    "pyramids of giza": { name: "Pyramids of Giza", latitude: 29.9792, longitude: 31.1342, altitude_m: 1200 },
    "marrakesh": { name: "Marrakesh", latitude: 31.6295, longitude: -7.9811 },
    "cape town": { name: "Cape Town", latitude: -33.9249, longitude: 18.4241 },
    "table mountain": { name: "Table Mountain", latitude: -33.9628, longitude: 18.4098, altitude_m: 2200, min_altitude_m: 1800 },
    "johannesburg": { name: "Johannesburg", latitude: -26.2041, longitude: 28.0473, min_altitude_m: 2400 },
    "nairobi": { name: "Nairobi", latitude: -1.2921, longitude: 36.8219, min_altitude_m: 2500 },
    "lagos": { name: "Lagos", latitude: 6.5244, longitude: 3.3792 },
    "kilimanjaro": { name: "Kilimanjaro", latitude: -3.0674, longitude: 37.3556, altitude_m: 7000, min_altitude_m: 6300, terrain_morphology: "volcanic_cone", morphology_source: "curated_gazetteer" },
    "victoria falls": { name: "Victoria Falls", latitude: -17.9243, longitude: 25.8572, altitude_m: 1800, min_altitude_m: 1200 },
    "dubai": { name: "Dubai", latitude: 25.2048, longitude: 55.2708 },
    "burj khalifa": { name: "Burj Khalifa", latitude: 25.1972, longitude: 55.2744, altitude_m: 1100 },
    "palm jumeirah": { name: "Palm Jumeirah", latitude: 25.1124, longitude: 55.139, altitude_m: 2500 },
    "abu dhabi": { name: "Abu Dhabi", latitude: 24.4539, longitude: 54.3773 },
    "doha": { name: "Doha", latitude: 25.2854, longitude: 51.531 },
    "jerusalem": { name: "Jerusalem", latitude: 31.7683, longitude: 35.2137, min_altitude_m: 1500 },
    "tel aviv": { name: "Tel Aviv", latitude: 32.0853, longitude: 34.7818 },
    "petra": { name: "Petra", latitude: 30.3285, longitude: 35.4444, altitude_m: 1800, min_altitude_m: 1400 },
    "riyadh": { name: "Riyadh", latitude: 24.7136, longitude: 46.6753, min_altitude_m: 1400 },
    // Asia
    "mumbai": { name: "Mumbai", latitude: 19.076, longitude: 72.8777 },
    "delhi": { name: "Delhi", latitude: 28.7041, longitude: 77.1025 },
    "bangalore": { name: "Bangalore", latitude: 12.9716, longitude: 77.5946, min_altitude_m: 1700 },
    "taj mahal": { name: "Taj Mahal", latitude: 27.1751, longitude: 78.0421, altitude_m: 800 },
    "kathmandu": { name: "Kathmandu", latitude: 27.7172, longitude: 85.324, min_altitude_m: 2200 },
    "mount everest": { name: "Mount Everest", latitude: 27.9881, longitude: 86.925, altitude_m: 10000, min_altitude_m: 9200, terrain_morphology: "sharp_peak", morphology_source: "curated_gazetteer" },
    "bangkok": { name: "Bangkok", latitude: 13.7563, longitude: 100.5018 },
    "hanoi": { name: "Hanoi", latitude: 21.0278, longitude: 105.8342 },
    "ho chi minh city": { name: "Ho Chi Minh City", latitude: 10.8231, longitude: 106.6297 },
    "kuala lumpur": { name: "Kuala Lumpur", latitude: 3.139, longitude: 101.6869 },
    "singapore": { name: "Singapore", latitude: 1.3521, longitude: 103.8198 },
    "marina bay sands": { name: "Marina Bay Sands", latitude: 1.2834, longitude: 103.8607, altitude_m: 700 },
    "jakarta": { name: "Jakarta", latitude: -6.2088, longitude: 106.8456 },
    "bali": { name: "Bali", latitude: -8.4095, longitude: 115.1889, altitude_m: 3000 },
    "manila": { name: "Manila", latitude: 14.5995, longitude: 120.9842 },
    "hong kong": { name: "Hong Kong", latitude: 22.3193, longitude: 114.1694 },
    "shanghai": { name: "Shanghai", latitude: 31.2304, longitude: 121.4737 },
    "beijing": { name: "Beijing", latitude: 39.9042, longitude: 116.4074 },
    "forbidden city": { name: "Forbidden City", latitude: 39.9163, longitude: 116.3972, altitude_m: 800 },
    "great wall of china": { name: "Great Wall of China", latitude: 40.4319, longitude: 116.5704, altitude_m: 1800, min_altitude_m: 1300 },
    "shenzhen": { name: "Shenzhen", latitude: 22.5431, longitude: 114.0579 },
    "taipei": { name: "Taipei", latitude: 25.033, longitude: 121.5654 },
    "seoul": { name: "Seoul", latitude: 37.5665, longitude: 126.978 },
    "tokyo": { name: "Tokyo", latitude: 35.6762, longitude: 139.6503 },
    "shibuya crossing": { name: "Shibuya Crossing", latitude: 35.6595, longitude: 139.7005, altitude_m: 500 },
    "osaka": { name: "Osaka", latitude: 34.6937, longitude: 135.5023 },
    "kyoto": { name: "Kyoto", latitude: 35.0116, longitude: 135.7681 },
    "mount fuji": { name: "Mount Fuji", latitude: 35.3606, longitude: 138.7274, altitude_m: 5500, min_altitude_m: 4300, terrain_morphology: "volcanic_cone", morphology_source: "curated_gazetteer" },
    "angkor wat": { name: "Angkor Wat", latitude: 13.4125, longitude: 103.867, altitude_m: 1000 },
    // Oceania
    "sydney": { name: "Sydney", latitude: -33.8688, longitude: 151.2093 },
    "sydney opera house": { name: "Sydney Opera House", latitude: -33.8568, longitude: 151.2153, altitude_m: 700 },
    "melbourne": { name: "Melbourne", latitude: -37.8136, longitude: 144.9631 },
    "brisbane": { name: "Brisbane", latitude: -27.4698, longitude: 153.0251 },
    "perth": { name: "Perth", latitude: -31.9505, longitude: 115.8605 },
    "uluru": { name: "Uluru", latitude: -25.3444, longitude: 131.0369, altitude_m: 2200, min_altitude_m: 1300 },
    "great barrier reef": { name: "Great Barrier Reef", latitude: -18.2871, longitude: 147.6992, altitude_m: 5000 },
    "auckland": { name: "Auckland", latitude: -36.8509, longitude: 174.7645 },
    "wellington": { name: "Wellington", latitude: -41.2924, longitude: 174.7787 },
    "queenstown": { name: "Queenstown", latitude: -45.0312, longitude: 168.6626, min_altitude_m: 1500 },
    // North America
    "new york": { name: "New York", latitude: 40.7128, longitude: -74.006 },
    "midtown manhattan": { name: "Midtown Manhattan", latitude: 40.7549, longitude: -73.984 },
    "lower manhattan": { name: "Lower Manhattan", latitude: 40.7128, longitude: -74.006 },
    "times square": { name: "Times Square", latitude: 40.758, longitude: -73.9855, altitude_m: 550 },
    "central park": { name: "Central Park", latitude: 40.7829, longitude: -73.9654, altitude_m: 1200 },
    "statue of liberty": { name: "Statue of Liberty", latitude: 40.6892, longitude: -74.0445, altitude_m: 800 },
    "brooklyn bridge": { name: "Brooklyn Bridge", latitude: 40.7061, longitude: -73.9969, altitude_m: 700 },
    "boston": { name: "Boston", latitude: 42.3601, longitude: -71.0589 },
    "downtown boston": { name: "Downtown Boston", latitude: 42.3555, longitude: -71.0565 },
    "washington dc": { name: "Washington DC", latitude: 38.9072, longitude: -77.0369 },
    "philadelphia": { name: "Philadelphia", latitude: 39.9526, longitude: -75.1652 },
    "miami": { name: "Miami", latitude: 25.7617, longitude: -80.1918 },
    "orlando": { name: "Orlando", latitude: 28.5383, longitude: -81.3792 },
    "atlanta": { name: "Atlanta", latitude: 33.749, longitude: -84.388 },
    "chicago": { name: "Chicago", latitude: 41.8781, longitude: -87.6298 },
    "detroit": { name: "Detroit", latitude: 42.3314, longitude: -83.0458 },
    "toronto": { name: "Toronto", latitude: 43.6532, longitude: -79.3832 },
    "cn tower": { name: "CN Tower", latitude: 43.6426, longitude: -79.3871, altitude_m: 800 },
    "montreal": { name: "Montreal", latitude: 45.5017, longitude: -73.5673 },
    "vancouver": { name: "Vancouver", latitude: 49.2827, longitude: -123.1207 },
    "seattle": { name: "Seattle", latitude: 47.6062, longitude: -122.3321 },
    "portland": { name: "Portland", latitude: 45.5152, longitude: -122.6784 },
    "san francisco": { name: "San Francisco", latitude: 37.7749, longitude: -122.4194 },
    "golden gate bridge": { name: "Golden Gate Bridge", latitude: 37.8199, longitude: -122.4783, altitude_m: 1000 },
    "los angeles": { name: "Los Angeles", latitude: 34.0522, longitude: -118.2437 },
    "hollywood sign": { name: "Hollywood Sign", latitude: 34.1341, longitude: -118.3215, altitude_m: 900 },
    "san diego": { name: "San Diego", latitude: 32.7157, longitude: -117.1611 },
    "las vegas": { name: "Las Vegas", latitude: 36.1699, longitude: -115.1398 },
    "phoenix": { name: "Phoenix", latitude: 33.4484, longitude: -112.074 },
    "denver": { name: "Denver", latitude: 39.7392, longitude: -104.9903, min_altitude_m: 2600 },
    "austin": { name: "Austin", latitude: 30.2672, longitude: -97.7431 },
    "dallas": { name: "Dallas", latitude: 32.7767, longitude: -96.797 },
    "houston": { name: "Houston", latitude: 29.7604, longitude: -95.3698 },
    "new orleans": { name: "New Orleans", latitude: 29.9511, longitude: -90.0715 },
    "honolulu": { name: "Honolulu", latitude: 21.3069, longitude: -157.8583 },
    "anchorage": { name: "Anchorage", latitude: 61.2181, longitude: -149.9003 },
    "grand canyon": { name: "Grand Canyon", latitude: 36.0544, longitude: -112.1401, altitude_m: 4000, min_altitude_m: 2700, terrain_morphology: "canyon", morphology_source: "curated_gazetteer" },
    "niagara falls": { name: "Niagara Falls", latitude: 43.0962, longitude: -79.0377, altitude_m: 1200 },
    "yosemite": { name: "Yosemite", latitude: 37.8651, longitude: -119.5383, altitude_m: 4500, min_altitude_m: 2800, terrain_morphology: "valley", morphology_source: "curated_gazetteer" },
    "yellowstone": { name: "Yellowstone", latitude: 44.428, longitude: -110.5885, altitude_m: 5000, min_altitude_m: 3200 },
    "monument valley": { name: "Monument Valley", latitude: 36.998, longitude: -110.0985, altitude_m: 3200, min_altitude_m: 2400 },
    "mount rushmore": { name: "Mount Rushmore", latitude: 43.8791, longitude: -103.4591, altitude_m: 2200, min_altitude_m: 1800 },
    "banff": { name: "Banff", latitude: 51.4968, longitude: -115.9281, altitude_m: 3500, min_altitude_m: 2200 },
    "mexico city": { name: "Mexico City", latitude: 19.4326, longitude: -99.1332, min_altitude_m: 3200 },
    "chichen itza": { name: "Chichen Itza", latitude: 20.6843, longitude: -88.5678, altitude_m: 1200 },
    "havana": { name: "Havana", latitude: 23.1136, longitude: -82.3666 },
    // South America
    "bogota": { name: "Bogota", latitude: 4.711, longitude: -74.0721, min_altitude_m: 3400 },
    "lima": { name: "Lima", latitude: -12.0464, longitude: -77.0428 },
    "machu picchu": { name: "Machu Picchu", latitude: -13.1631, longitude: -72.545, altitude_m: 3600, min_altitude_m: 3200 },
    "cusco": { name: "Cusco", latitude: -13.5319, longitude: -71.9675, min_altitude_m: 4300 },
    "santiago": { name: "Santiago", latitude: -33.4489, longitude: -70.6693, min_altitude_m: 1300 },
    "buenos aires": { name: "Buenos Aires", latitude: -34.6037, longitude: -58.3816 },
    "rio de janeiro": { name: "Rio de Janeiro", latitude: -22.9068, longitude: -43.1729 },
    "christ the redeemer": { name: "Christ the Redeemer", latitude: -22.9519, longitude: -43.2105, altitude_m: 1300, min_altitude_m: 1000 },
    "sao paulo": { name: "Sao Paulo", latitude: -23.5505, longitude: -46.6333 },
    "iguazu falls": { name: "Iguazu Falls", latitude: -25.6953, longitude: -54.4367, altitude_m: 1800 },
    "torres del paine": { name: "Torres del Paine", latitude: -50.9423, longitude: -73.4068, altitude_m: 4000, min_altitude_m: 2000 },
    "galapagos": { name: "Galapagos", latitude: -0.7439, longitude: -90.307, altitude_m: 5000 },
  };

  // Alternate names → canonical gazetteer key (keys are normalized names).
  const LOCATION_ALIASES = {
    // Large-area geography spoken without the article (v0.9.5)
    "baltic sea": "the baltic sea",
    "mediterranean": "the mediterranean",
    "mediterranean sea": "the mediterranean",
    "north sea": "the north sea",
    "gulf of finland": "the gulf of finland",
    "red sea": "the red sea",
    "alps": "the alps",
    "sahara": "the sahara",
    "sahara desert": "the sahara",
    "himalayas": "the himalayas",
    "amazon": "the amazon",
    "amazon rainforest": "the amazon",
    "scottish highlands": "the scottish highlands",
    "uk": "united kingdom",
    "great britain": "united kingdom",
    "britain": "united kingdom",
    "holland": "netherlands",
    "nordics": "scandinavia",
    "the nordics": "scandinavia",
    "finnish lapland": "lapland",
    "nyc": "new york",
    "new york city": "new york",
    "manhattan": "midtown manhattan",
    "sf": "san francisco",
    "vegas": "las vegas",
    "washington": "washington dc",
    "dc": "washington dc",
    "saint petersburg": "st petersburg",
    "giza": "pyramids of giza",
    "pyramids": "pyramids of giza",
    "great pyramid": "pyramids of giza",
    "everest": "mount everest",
    "fuji": "mount fuji",
    "ayers rock": "uluru",
    "opera house": "sydney opera house",
    "great wall": "great wall of china",
    "golden gate": "golden gate bridge",
    "hollywood": "hollywood sign",
    "shibuya": "shibuya crossing",
    "vatican city": "vatican",
    "saigon": "ho chi minh city",
    "rio": "rio de janeiro",
    "kiev": "kyiv",
    "yosemite valley": "yosemite",
    "helsinki cathedral church": "helsinki cathedral",
    "usa": "united states",
    "us": "united states",
    "united states of america": "united states",
    "america": "united states",
    "formosa": "taiwan",
    "pacific ocean": "the pacific",
    "pacific": "the pacific",
    "the pacific ocean": "the pacific",
    "south east asia": "southeast asia",
    "se asia": "southeast asia",
  };

  // Parse an explicit coordinate phrase like "42.3555,-71.0565" or "lat 42.3 lng -71".
  // The bare form requires a , or / separator — a bare space would make phrases
  // with incidental numbers ("Area 51 7") silently resolve as coordinates; the
  // labeled lat/lng form still covers space-separated input.
  function parseExplicitCoords(value) {
    const text = cleanString(value);
    let m = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,/]\s*(-?\d{1,3}(?:\.\d+)?)/);
    const latLngLabel = text.match(/lat(?:itude)?\s*(-?\d{1,2}(?:\.\d+)?).*?l(?:ng|on|ongitude)?\s*(-?\d{1,3}(?:\.\d+)?)/i);
    if (latLngLabel) m = latLngLabel;
    if (!m) return null;
    const latitude = Number(m[1]);
    const longitude = Number(m[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, latitude, longitude, source: "explicit_coordinates" };
  }

  function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function slugify(value) {
    const slug = cleanString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || "earth-studio-job";
  }

  // Lowercase, strip diacritics ("Bogotá" → "bogota"), drop a leading article,
  // and collapse punctuation runs to single spaces ("St. Petersburg" →
  // "st petersburg") so spoken-style names hit the gazetteer keys.
  function normalizeLocationName(value) {
    let text = cleanString(value).toLowerCase();
    if (typeof text.normalize === "function") text = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
    text = text.replace(/[^a-z0-9]+/g, " ").trim();
    return text.replace(/^(?:the|a|an) /, "");
  }

  function resolveLocation(value) {
    const key = normalizeLocationName(value);
    if (key && LOCATION_FIXTURES[key]) return { ...LOCATION_FIXTURES[key], source: "gazetteer_fixture" };
    if (key && LOCATION_ALIASES[key] && LOCATION_FIXTURES[LOCATION_ALIASES[key]]) {
      return { ...LOCATION_FIXTURES[LOCATION_ALIASES[key]], source: "gazetteer_fixture" };
    }
    const coords = parseExplicitCoords(value);
    if (coords) return coords;
    return null;
  }

  function splitSegments(description) {
    // Protect "lat,lng" pairs and decimals so the comma segment splitter does
    // not shatter explicit coordinates like "35.65,139.84". Periods are NOT
    // segment separators — they would shatter names like "St. Petersburg";
    // segments chain on "then", commas, semicolons, or newlines, and stray
    // sentence periods are trimmed from the segment edges.
    const DOT = "";
    const COMMA = "";
    const protectedText = cleanString(description)
      .replace(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/g, (m) => m.replace(/\./g, DOT).replace(/,/g, COMMA))
      .replace(/\d+\.\d+/g, (m) => m.replace(/\./g, DOT));
    return protectedText
      .split(/\bthen\b|[,;\n]/i)
      .map((part) => part.split(COMMA).join(",").split(DOT).join(".").replace(/^[\s.]+|[\s.]+$/g, ""))
      .filter(Boolean);
  }

  function extractDurationSeconds(text) {
    const match = cleanString(text).match(/\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|sec|s)\b/i);
    if (match) {
      const duration = Number(match[1]);
      return Number.isFinite(duration) && duration >= 0 ? duration : null;
    }
    // Minutes grammar: "for 2 minutes" / "1 minute" / "2.5 min" → seconds.
    // The bare "s" seconds unit above cannot swallow minutes ("m" is not in
    // [sec]), so the two grammars never compete.
    const minutes = cleanString(text).match(/\b(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min)\b/i);
    if (!minutes) return null;
    const seconds = Number(minutes[1]) * 60;
    return Number.isFinite(seconds) ? seconds : null;
  }

  function removeDurationPhrase(text) {
    // Global: a doubled duration phrase ("for 5 seconds for 3 seconds") must
    // not leak into the location phrase — extractDurationSeconds still takes
    // the FIRST duration as the effective one.
    return cleanString(text)
      .replace(/\b(?:for|in)?\s*\d+(?:\.\d+)?\s*(?:seconds?|secs?|sec|s)\b/gi, "")
      .replace(/\b(?:for|in)?\s*\d+(?:\.\d+)?\s*(?:minutes?|mins?|min)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // ── Modifier extraction ────────────────────────────────────────────────────
  // Each extractor returns { value fields, text } where text has the matched
  // phrase stripped, so the location extractor sees a clean phrase afterwards.

  // Altitude: numeric ("at 800m", "from 2 km"), "space", or qualitative
  // low/high words. Numeric wins over words.
  function extractAltitudeSpec(text) {
    let t = cleanString(text);
    const numeric = t.match(/\b(?:at|from|to)?\s*\b(\d+(?:\.\d+)?)\s*(m|meters?|metres?|km|kilometers?|kilometres?)\b(?:\s+(?:up|high|altitude|out))?/i);
    if (numeric) {
      const unit = numeric[2].toLowerCase();
      const meters = Number(numeric[1]) * (unit.startsWith("k") ? 1000 : 1);
      return { altitude_m: meters, source: "explicit", text: t.replace(numeric[0], " ").replace(/\s{2,}/g, " ").trim() };
    }
    const space = t.match(/\b(?:to|into|toward|towards|from)?\s*(?:outer\s+)?space\b/i);
    if (space) return { altitude_m: SPACE_ALTITUDE_M, source: "space", text: t.replace(space[0], " ").replace(/\s{2,}/g, " ").trim() };
    const low = t.match(/\b(?:down\s+low|low|close\s+up|up\s+close)\b/i);
    if (low) return { altitude_m: 700, source: "low", text: t.replace(low[0], " ").replace(/\s{2,}/g, " ").trim() };
    const high = t.match(/\b(?:high\s+(?:up|above)|high|wide|far\s+out)\b/i);
    if (high) return { altitude_m: 8000, source: "high", text: t.replace(high[0], " ").replace(/\s{2,}/g, " ").trim() };
    return { altitude_m: null, source: null, text: t };
  }

  // Camera tilt: 0 = straight down, ~70 = toward the horizon.
  function extractTiltSpec(text) {
    let t = cleanString(text);
    const topDown = t.match(/\b(?:top[- ]?down|straight down|overhead|bird'?s[- ]?eye)\b/i);
    if (topDown) return { tilt_deg: 0, text: t.replace(topDown[0], " ").replace(/\s{2,}/g, " ").trim() };
    // "tilt 45 degrees", "tilted 45 degrees", "tilted at 45 degrees" — the
    // bare imperative "tilt" only counts with an explicit number after it.
    const degrees = t.match(/\btilt(?:ed)?(?:\s+(?:at|by))?\s+(\d+(?:\.\d+)?)\s*degrees?\b/i);
    if (degrees) return { tilt_deg: Math.min(85, Math.max(0, Number(degrees[1]))), text: t.replace(degrees[0], " ").replace(/\s{2,}/g, " ").trim() };
    const tilted = t.match(/\b(?:tilted|angled)\b/i);
    if (tilted) return { tilt_deg: 60, text: t.replace(tilted[0], " ").replace(/\s{2,}/g, " ").trim() };
    const horizon = t.match(/\b(?:(?:at|toward|towards|to)\s+the\s+horizon|cinematic)\b/i);
    if (horizon) return { tilt_deg: 72, text: t.replace(horizon[0], " ").replace(/\s{2,}/g, " ").trim() };
    return { tilt_deg: null, text: t };
  }

  // Orbit amount + direction: "twice", "3 times", "half", "180 degrees",
  // "counterclockwise". Applied only when the action is orbit; stripped anyway.
  function extractOrbitSpec(text) {
    let t = cleanString(text);
    let degrees = null;
    let direction = 1;
    const apply = (m, value) => { t = t.replace(m[0], " ").replace(/\s{2,}/g, " ").trim(); return value; };
    let m;
    if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*degrees?\b/i))) degrees = apply(m, Number(m[1]));
    else if ((m = t.match(/\btwice\b/i))) degrees = apply(m, 720);
    else if ((m = t.match(/\bthrice\b/i))) degrees = apply(m, 1080);
    else if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:times|turns?|revolutions?|rotations?|laps?)\b/i))) degrees = apply(m, Number(m[1]) * 360);
    else if ((m = t.match(/\bhalf(?:[- ]?way)?\b/i))) degrees = apply(m, 180);
    else if ((m = t.match(/\b(?:a\s+)?quarter\b/i))) degrees = apply(m, 90);
    else if ((m = t.match(/\bonce\b/i))) degrees = apply(m, 360);
    if ((m = t.match(/\b(?:counter[- ]?clockwise|anti[- ]?clockwise|ccw)\b/i))) direction = apply(m, -1);
    else if ((m = t.match(/\bclockwise\b/i))) direction = apply(m, 1);
    return { orbit_degrees: degrees, orbit_direction: direction, text: t };
  }

  function detectAction(text) {
    const lower = cleanString(text).toLowerCase();
    if (/\b(?:orbit(?:s|ing)?|circle(?:s)?|circling|spin(?:s|ning)?\s+around|rotate(?:s)?\s+around)\b/.test(lower)) {
      return { action: "orbit", resolutionStatus: "parsed" };
    }
    if (/\b(?:zoom\s*(?:in|into|in on|closer)|push\s+in|dive|swoop|descend)\b/.test(lower)) {
      return { action: "zoom_in", resolutionStatus: "parsed" };
    }
    if (/\b(?:zoom\s*(?:out|back|away)|pull\s+(?:back|out|away)|ascend|rise|climb)\b/.test(lower)) {
      return { action: "zoom_out", resolutionStatus: "parsed" };
    }
    if (/\b(?:hover|hovers|hovering|hold|holds|stays? (?:over|at|on)|pause|pauses|linger|lingers)\b/.test(lower)) {
      return { action: "hover", resolutionStatus: "parsed" };
    }
    if (/\b(?:move(?:s)? to|fly (?:to|over|across|towards?)|flies to|flyover|travel(?:s)? to|pan(?:s)? to|go(?:es)? to|head(?:s)? to|jump(?:s)? to|cut(?:s)? to|start(?:s)? (?:at|over|on)|begin(?:s)? (?:at|over))\b/.test(lower)) {
      return { action: "fly_to", resolutionStatus: "parsed" };
    }
    return {
      action: "unresolved",
      resolutionStatus: "manual_review",
      warning: "missing or unsupported camera action.",
    };
  }

  function extractLocationPhrase(text, action) {
    const source = cleanString(text);
    let match = null;
    if (action === "hover") {
      match = source.match(/\b(?:hover|hovers|hovering|hold|holds|stays?|pause|pauses|linger|lingers)\s+(?:over\s+|at\s+|on\s+|above\s+)?(.+)$/i);
    } else if (action === "fly_to") {
      match = source.match(/\b(?:move|moves|fly|flies|flyover|travel|travels|pan|pans|go|goes|head|heads|jump|jumps|cut|cuts|start|starts|begin|begins)\s+(?:to\s+|over\s+|across\s+|towards?\s+|at\s+|on\s+)?(.+)$/i);
    } else if (action === "orbit") {
      match = source.match(/\b(?:orbit(?:s|ing)?|circle(?:s)?|circling|spin(?:s|ning)?|rotate(?:s)?)\s+(?:around\s+|round\s+|over\s+|at\s+|above\s+)?(.+)$/i);
    } else if (action === "zoom_in") {
      match = source.match(/\b(?:zoom\s*(?:in|into|in on|closer)|push\s+in|dive|swoop|descend)\s+(?:on\s+|to\s+|into\s+|over\s+|towards?\s+)?(.+)$/i);
    } else if (action === "zoom_out") {
      match = source.match(/\b(?:zoom\s*(?:out|back|away)|pull\s+(?:back|out|away)|ascend|rise|climb)\s+(?:from\s+|of\s+|over\s+|above\s+)?(.+)$/i);
    }
    let phrase = match ? cleanString(match[1]) : "";
    // Trim dangling connective words left behind by modifier stripping
    // ("orbit Paris at" after "at 800m" was removed).
    for (let i = 0; i < 3; i += 1) {
      phrase = phrase.replace(/\s+(?:at|from|to|in|on|over|for|the|a|an|around|towards?|with)$/i, "").trim();
    }
    return phrase;
  }

  function frameForSeconds(seconds, frameRate = FRAME_RATE) {
    return Math.round(seconds * frameRate);
  }

  function clampAltitude(value, minAltitudeM) {
    const floor = Math.max(MIN_ALTITUDE_M, minAltitudeM || 0);
    return Math.min(MAX_ALTITUDE_M, Math.max(floor, value));
  }

  // Earth Studio's default FOV is 20°. At camera altitude h, a spherical
  // Earth subtends angular radius asin(R/(R+h)) around nadir. Tilt moves that
  // disk down the vertical frame; once tilt exceeds angular radius + FOV/2,
  // the globe is completely off-screen (the real 9:16 failure at ~2584 km).
  // Derived semantic-space shots instead keep the upper globe limb at least
  // 25% of the FOV above frame center. We author 30% for interpolation
  // headroom, leaving a deliberate band of space while most of Earth remains
  // visible. This is a composition rule, not a destination/altitude special case.
  function globeAngularRadiusDeg(altitudeM) {
    const altitude = Math.max(0, Number(altitudeM) || 0);
    return (Math.asin(EARTH_RADIUS_M / (EARTH_RADIUS_M + altitude)) * 180) / Math.PI;
  }

  function spaceZoomComposition(altitudeM, tiltDeg, fovDeg = EARTH_STUDIO_DEFAULT_FOV_DEG) {
    const angularRadiusDeg = globeAngularRadiusDeg(altitudeM);
    const limbInsetDeg = angularRadiusDeg - tiltDeg;
    const minimumLimbInsetDeg = fovDeg * SPACE_ZOOM_MIN_LIMB_INSET_FRACTION;
    return {
      angular_radius_deg: angularRadiusDeg,
      limb_inset_deg: limbInsetDeg,
      minimum_limb_inset_deg: minimumLimbInsetDeg,
      safe: limbInsetDeg >= minimumLimbInsetDeg,
    };
  }

  function maxDerivedSpaceZoomTiltDeg(altitudeM, fovDeg = EARTH_STUDIO_DEFAULT_FOV_DEG) {
    return Math.max(0, globeAngularRadiusDeg(altitudeM) - fovDeg * SPACE_ZOOM_TARGET_LIMB_INSET_FRACTION);
  }

  // The segment's END/target camera altitude: explicit spec beats the
  // gazetteer's per-place altitude, which beats the per-action default —
  // always floored by the place's terrain minimum. Returns the value plus its
  // provenance (`source`) so plans and acceptance diagnostics can state where
  // every altitude came from.
  function targetAltitude(action, altitudeSpec, location) {
    const minAlt = (location && location.min_altitude_m) || 0;
    if (altitudeSpec && typeof altitudeSpec.altitude_m === "number") {
      return { value: clampAltitude(altitudeSpec.altitude_m, minAlt), source: altitudeSpec.source === "explicit" ? "explicit" : `semantic_${altitudeSpec.source}` };
    }
    const fixtureAlt = location && typeof location.altitude_m === "number" ? location.altitude_m : null;
    if (action === "zoom_in") return { value: clampAltitude(fixtureAlt || ZOOM_IN_ALTITUDE_M, minAlt), source: fixtureAlt ? "gazetteer" : "action_default" };
    if (action === "zoom_out") return { value: clampAltitude(Math.max(ZOOM_OUT_ALTITUDE_M, (fixtureAlt || 0) * 2), minAlt), source: fixtureAlt ? "gazetteer" : "action_default" };
    return { value: clampAltitude(fixtureAlt || DEFAULT_ALTITUDE_M, minAlt), source: fixtureAlt ? "gazetteer" : "action_default" };
  }

  // Duration a move NEEDS to read on screen, scaled by its magnitude:
  // flights by ground distance (~150 km/s cruise over a 4 s base, capped),
  // orbits by revolutions AND camera proximity, zooms by the altitude ratio
  // (log scale). The proximity term comes from real Earth Studio playback
  // (acceptance round 3): a tilted orbit puts the camera only alt·tan(tilt)
  // from the target, and at close radius the ground rushes past — the same
  // angular rate that reads calm top-down was "too fast compared to how
  // close the camera was". Perceived ground speed grows ~tan(tilt), so the
  // per-revolution time stretches by that factor (capped at 30 s/rev).
  function orbitSecondsPerRevolution(tiltDeg) {
    const tilt = Math.min(Math.max(typeof tiltDeg === "number" ? tiltDeg : DEFAULT_TILT_DEG.orbit, 0), 80);
    return Math.min(30, DEFAULT_DURATION_S.orbit * Math.max(1, Math.tan(toRadians(tilt))));
  }

  function defaultDuration(action, { distanceM = null, orbitDegrees = 360, tiltDeg = null, fromAltitudeM = DEFAULT_ALTITUDE_M, toAltitudeM = DEFAULT_ALTITUDE_M } = {}) {
    if (action === "fly_to") {
      if (!Number.isFinite(distanceM)) return 5; // establishing dive onto the first location
      return Math.round(Math.min(25, Math.max(4, 4 + distanceM / 150000)));
    }
    if (action === "orbit") return Math.max(6, Math.round((orbitSecondsPerRevolution(tiltDeg) * Math.abs(orbitDegrees || 360)) / 360));
    if (action === "zoom_in" || action === "zoom_out") {
      const hi = Math.max(fromAltitudeM, toAltitudeM);
      const lo = Math.max(1, Math.min(fromAltitudeM, toAltitudeM));
      return Math.round(Math.min(12, Math.max(3, 3 + 2.5 * Math.log10(hi / lo))));
    }
    return DEFAULT_DURATION_S[action] || 4;
  }

  function parseSegment(text, segmentId, currentSeconds, frameRate = FRAME_RATE, previousLocation = null, previousAltitudeM = DEFAULT_ALTITUDE_M, previousTiltDeg = null) {
    const warnings = [];
    const notes = [];
    const actionInfo = detectAction(text);
    if (actionInfo.warning) warnings.push(actionInfo.warning);

    // Strip modifiers front-to-back so the location extractor sees a clean phrase.
    let working = removeDurationPhrase(text);
    const tiltSpec = extractTiltSpec(working);
    working = tiltSpec.text;
    // Orbit modifiers ("twice", "a quarter", "clockwise"…) are orbit
    // vocabulary. Extracting them from other actions corrupts place names —
    // "hover over the French Quarter" lost its "Quarter" — so only orbit
    // segments get the extraction.
    const orbitSpec = actionInfo.action === "orbit"
      ? extractOrbitSpec(working)
      : { orbit_degrees: null, orbit_direction: 1, text: working };
    working = orbitSpec.text;
    const altitudeSpec = extractAltitudeSpec(working);
    working = altitudeSpec.text;

    const locationPhrase = extractLocationPhrase(working, actionInfo.action);
    let location = locationPhrase ? resolveLocation(locationPhrase) : null;
    if (locationPhrase && !location) warnings.push(`unknown location fixture: ${locationPhrase}`);
    if (!locationPhrase) {
      if (previousLocation && actionInfo.action !== "unresolved") {
        location = { ...previousLocation, source: "carried_over" };
        notes.push(`location carried over: ${previousLocation.name}.`);
      } else {
        warnings.push("missing location.");
      }
    }

    // A hover is a hold: when it stays at the previous location and gives no
    // explicit altitude/tilt, the camera keeps the previous segment's terminal
    // state instead of drifting to generic defaults. Explicit values always win.
    // The same condition also marks the segment as a CAMERA-POSITION hold for
    // the keyframe engine (`holds_camera`): after an orbit the camera sits on
    // the orbit ring, and a hover must stay there — not slide back to the
    // target center. Explicit altitude/tilt changes still apply during a hold.
    const holdsPreviousCamera = actionInfo.action === "hover"
      && previousLocation
      && location
      && (!locationPhrase || location.name === previousLocation.name);

    // Duration: explicit wins; otherwise scale to the move's magnitude.
    let altitude = targetAltitude(actionInfo.action, altitudeSpec, location);
    let tiltDeg = typeof tiltSpec.tilt_deg === "number" ? tiltSpec.tilt_deg
      : (DEFAULT_TILT_DEG[actionInfo.action] != null ? DEFAULT_TILT_DEG[actionInfo.action] : 45);
    let tiltSource = typeof tiltSpec.tilt_deg === "number" ? "explicit" : "action_default";
    let unconstrainedTiltDeg = null;
    if (actionInfo.action === "zoom_out" && altitude.source === "semantic_space" && tiltSource !== "explicit") {
      unconstrainedTiltDeg = tiltDeg;
      tiltDeg = Math.min(tiltDeg, maxDerivedSpaceZoomTiltDeg(altitude.value));
      tiltSource = "semantic_space_composition";
      notes.push(`semantic space composition constrains derived terminal tilt from ${unconstrainedTiltDeg}° to ${round6(tiltDeg)}°; explicit tilt would remain authoritative.`);
    }
    if (holdsPreviousCamera) {
      const minAlt = (location && location.min_altitude_m) || 0;
      const held = [];
      if (typeof altitudeSpec.altitude_m !== "number" && typeof previousAltitudeM === "number") {
        altitude = { value: clampAltitude(previousAltitudeM, minAlt), source: "carried_over" };
        held.push(`altitude ${altitude.value}m`);
      }
      if (typeof tiltSpec.tilt_deg !== "number" && typeof previousTiltDeg === "number") {
        tiltDeg = previousTiltDeg;
        tiltSource = "carried_over";
        held.push(`tilt ${tiltDeg}°`);
      }
      if (held.length) notes.push(`hover holds the previous camera (${held.join(", ")}).`);
    }
    const distanceM = location && previousLocation ? haversineMeters(previousLocation, location) : null;
    const magnitude = {
      distanceM,
      orbitDegrees: typeof orbitSpec.orbit_degrees === "number" ? orbitSpec.orbit_degrees : 360,
      tiltDeg,
      fromAltitudeM: previousAltitudeM,
      toAltitudeM: altitude.value,
    };
    let durationSeconds = extractDurationSeconds(text);
    let durationSource = "explicit";
    if (durationSeconds === null) {
      if (actionInfo.action !== "unresolved") {
        durationSeconds = defaultDuration(actionInfo.action, magnitude);
        durationSource = "action_default";
        notes.push(`no duration given — defaulted to ${durationSeconds}s.`);
      } else {
        durationSource = "missing";
        warnings.push("missing duration.");
      }
    } else if (durationSeconds === 0) {
      // An EXPLICIT zero ("for 0 seconds" / "for 0 minutes") is ambiguous
      // input, never silently replaced by the magnitude-scaled default: the
      // segment keeps zero duration, goes to manual_review, and is listed in
      // unresolved_items so the author fixes the description deliberately.
      durationSource = "invalid_zero";
      warnings.push("zero duration is invalid — give a positive duration (e.g. \"for 5 seconds\").");
    } else if (durationSeconds > 0) {
      // Advisory pacing notes: real Earth Studio playback proved absurd camera
      // speeds unintelligible. Never blocks — the author may want speed.
      const suggested = defaultDuration(actionInfo.action, magnitude);
      if (actionInfo.action === "fly_to" && Number.isFinite(distanceM) && distanceM > 300000 && distanceM / durationSeconds > 200000) {
        notes.push(`pacing: ~${Math.round(distanceM / durationSeconds / 1000)} km/s flight — likely too fast to read; consider ~${suggested}s.`);
      }
      if (actionInfo.action === "orbit") {
        const rate = Math.abs(magnitude.orbitDegrees) / durationSeconds;
        const suggestedRate = 360 / orbitSecondsPerRevolution(magnitude.tiltDeg);
        if (rate > 1.3 * suggestedRate) {
          notes.push(`pacing: orbit at ${Math.round(rate)}°/s reads fast at this tilt (camera is close to the target) — consider ~${suggested}s.`);
        }
      }
      if ((actionInfo.action === "zoom_in" || actionInfo.action === "zoom_out")
        && Math.max(magnitude.fromAltitudeM, magnitude.toAltitudeM) / Math.max(1, Math.min(magnitude.fromAltitudeM, magnitude.toAltitudeM)) > 50
        && durationSeconds < 6) {
        notes.push(`pacing: very large zoom in ${durationSeconds}s — likely too fast to read; consider ~${suggested}s.`);
      }
    }

    const startSeconds = currentSeconds;
    const effectiveDuration = durationSeconds || 0;
    const endSeconds = startSeconds + effectiveDuration;
    const hasManualWarning = warnings.length > 0 || actionInfo.resolutionStatus === "manual_review";

    const segment = {
      segment_id: segmentId,
      source_text: cleanString(text),
      action: actionInfo.action,
      requested_action: actionInfo.action,
      location_name: location ? location.name : locationPhrase || "",
      location,
      altitude_m: altitude.value,
      altitude_source: altitude.source,
      tilt_deg: tiltDeg,
      tilt_source: tiltSource,
      duration_source: durationSource,
      start_seconds: startSeconds,
      end_seconds: endSeconds,
      duration_seconds: effectiveDuration,
      start_frame: frameForSeconds(startSeconds, frameRate),
      end_frame: frameForSeconds(endSeconds, frameRate),
      resolution_status: hasManualWarning ? "manual_review" : "resolved",
      warnings,
      notes,
    };
    if (unconstrainedTiltDeg !== null) {
      segment.unconstrained_tilt_deg = unconstrainedTiltDeg;
      segment.space_zoom_composition = {
        earth_radius_m: EARTH_RADIUS_M,
        earth_studio_default_fov_deg: EARTH_STUDIO_DEFAULT_FOV_DEG,
        minimum_limb_inset_fraction: SPACE_ZOOM_MIN_LIMB_INSET_FRACTION,
        target_limb_inset_fraction: SPACE_ZOOM_TARGET_LIMB_INSET_FRACTION,
        sample_count: SPACE_ZOOM_COMPOSITION_SAMPLES,
      };
    }
    if (holdsPreviousCamera) segment.holds_camera = true;
    if (actionInfo.action === "orbit") {
      segment.orbit_degrees = typeof orbitSpec.orbit_degrees === "number" ? orbitSpec.orbit_degrees : 360;
      segment.orbit_direction = orbitSpec.orbit_direction || 1;
    }
    return { segment, nextSeconds: endSeconds, warnings, notes };
  }

  // A comma-separated fragment with no camera action and nothing but modifier
  // vocabulary ("…, tilted 45 degrees, …") is a continuation of the previous
  // segment, not a new (unresolvable) segment — commas both chain segments AND
  // separate spoken-style modifiers, so only fragments that fully reduce to
  // modifiers get merged.
  function isModifierOnlyFragment(part) {
    if (detectAction(part).action !== "unresolved") return false;
    let t = removeDurationPhrase(part);
    t = extractTiltSpec(t).text;
    t = extractOrbitSpec(t).text;
    t = extractAltitudeSpec(t).text;
    t = t.replace(/\b(?:at|from|to|in|on|over|for|the|a|an|and|with)\b/gi, " ").replace(/[^a-zA-Z0-9]+/g, " ").trim();
    return t === "";
  }

  function parseDescription(description, options = {}) {
    const frameRate = options.frameRate || FRAME_RATE;
    const rawParts = splitSegments(description);
    const parts = [];
    rawParts.forEach((part) => {
      if (parts.length && isModifierOnlyFragment(part)) parts[parts.length - 1] += ` ${part}`;
      else parts.push(part);
    });
    const warnings = [];
    const notes = [];
    const segments = [];
    let currentSeconds = 0;
    let lastLocation = null;
    let lastAltitude = DEFAULT_ALTITUDE_M;
    let lastTilt = null;

    if (!parts.length) warnings.push("description did not contain any parseable segments.");

    parts.forEach((part, index) => {
      const parsed = parseSegment(part, index + 1, currentSeconds, frameRate, lastLocation, lastAltitude, lastTilt);
      segments.push(parsed.segment);
      warnings.push(...parsed.warnings.map((warning) => `segment ${index + 1}: ${warning}`));
      notes.push(...parsed.notes.map((note) => `segment ${index + 1}: ${note}`));
      currentSeconds = parsed.nextSeconds;
      if (parsed.segment.location) {
        lastLocation = parsed.segment.location;
        lastAltitude = parsed.segment.altitude_m;
        lastTilt = parsed.segment.tilt_deg;
      }
    });

    // Successor-orbit lookahead: a moving segment (fly/zoom) immediately
    // followed by an orbit around the SAME resolved target terminates at the
    // orbit's ring entry instead of the target center — otherwise the camera
    // arrives at the center and visibly slides sideways onto the ring when
    // the orbit begins. Matching uses resolved coordinates (aliases hit the
    // same gazetteer point); a different successor target keeps normal fly
    // behavior. Hover is excluded: a hover HOLDS the camera where it is.
    const sameResolvedTarget = (a, b) => a && b
      && Math.abs(a.latitude - b.latitude) < 1e-6
      && Math.abs(a.longitude - b.longitude) < 1e-6;
    // The orbit is either the NEXT movement, or sits just past a hold that
    // carries the orbit's own geometry. Reading through the hold is what fixes
    // `fly -> hold -> orbit`, the ordinary same-subject sequence: without it the
    // fly framed the target from above, the hold held that top-down composition
    // at the ring's dead CENTRE, and the orbit spent 29.8% of itself descending
    // and sliding outward before it could sweep — while the adjacent
    // `fly -> orbit` case already landed on the ring at 0.0%.
    //
    // The hold is NOT repositioned; it still holds whatever the fly delivers.
    // Only the fly's endpoint moves.
    //
    // The altitude/tilt match IS the consent check, the same one the
    // opening-hold staging below relies on: a hold the operator gave its own
    // framing does not read through, and the bounded ring acquisition keeps
    // handling it as before. This is a one-step extension of an existing
    // lookahead, not a general multi-shot planner.
    const orbitStagedFor = (i) => {
      const next = segments[i + 1];
      if (!next || next.duration_seconds <= 0) return null;
      if (next.action === "orbit") return next;
      if (next.action !== "hover") return null;
      const third = segments[i + 2];
      if (!third || third.action !== "orbit" || third.duration_seconds <= 0) return null;
      if (!sameResolvedTarget(next.location, third.location)) return null;
      if (Math.abs((next.altitude_m || 0) - (third.altitude_m || 0)) > 1) return null;
      if (Math.abs((next.tilt_deg || 0) - (third.tilt_deg || 0)) > 0.5) return null;
      return third;
    };
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      if (!["fly_to", "zoom_in", "zoom_out"].includes(seg.action)) continue;
      if (seg.duration_seconds <= 0) continue;
      const orbit = orbitStagedFor(i);
      if (!orbit) continue;
      if (!sameResolvedTarget(seg.location, orbit.location)) continue;
      seg.ends_at_orbit_entry = orbit.segment_id;
      const through = segments[i + 1] !== orbit
        ? ` through the held segment ${segments[i + 1].segment_id}` : "";
      notes.push(`segment ${seg.segment_id}: endpoint set to segment ${orbit.segment_id}'s orbit ring entry${through} (same target — the move lands on the ring the orbit starts from).`);
    }

    // OPENING-HOLD STAGING: the shot's first movement is a hover whose next
    // movement orbits the SAME target at the SAME altitude and tilt. That is the
    // directorial layer saying "establish from where the orbit begins", so the
    // opening camera belongs ON the orbit ring rather than above the target.
    //
    // Without this, a top-down establishing hold sits at the ring's CENTRE and
    // the orbit spends a bounded but large slice of itself correcting: measured
    // in real Earth Studio on case K, frames 90-238 of 510 climbing 1,419 -> 710 m
    // and travelling 0 -> 1,229 m before the sweep could start.
    //
    // The altitude/tilt match IS the consent check. If the operator asked for a
    // top-down hold before an oblique orbit, the values disagree, nothing is
    // restaged, and the bounded ring acquisition handles it as before.
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i];
      const next = segments[i + 1];
      if (i !== 0 || seg.action !== "hover") continue;
      if (next.action !== "orbit" || seg.duration_seconds <= 0 || next.duration_seconds <= 0) continue;
      if (!sameResolvedTarget(seg.location, next.location)) continue;
      if (Math.abs((seg.altitude_m || 0) - (next.altitude_m || 0)) > 1) continue;
      if (Math.abs((seg.tilt_deg || 0) - (next.tilt_deg || 0)) > 0.5) continue;
      seg.stages_orbit_entry = next.segment_id;
      notes.push(`segment ${seg.segment_id}: opening hold staged on segment ${next.segment_id}'s orbit ring (same target, same framing — the orbit starts sweeping immediately instead of moving onto the ring).`);
    }

    return {
      source_description: cleanString(description),
      parser_strategy: "offline_regex_with_manual_review_fallback",
      frame_rate: frameRate,
      frame_convention: {
        start_frame: "inclusive",
        end_frame: "exclusive",
      },
      total_duration_seconds: currentSeconds,
      total_frames: frameForSeconds(currentSeconds, frameRate),
      segments,
      unresolved_items: segments
        .filter((segment) => segment.resolution_status !== "resolved")
        .map((segment) => ({
          segment_id: segment.segment_id,
          source_text: segment.source_text,
          warnings: [...segment.warnings],
        })),
      warnings,
      notes,
    };
  }

  // Accept a camera seed in either the engine's own field names or the
  // continuation-state export's names, and keep ONLY the five keyframed values.
  function normalizeInitialCamera(seed) {
    if (!seed || typeof seed !== "object") return null;
    const src = seed.camera && typeof seed.camera === "object" ? seed.camera : seed;
    // null/undefined/"" mean ABSENT (Number(null) === 0 would fabricate a 0).
    const num = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const out = {
      latitude: num(src.latitude),
      longitude: num(src.longitude),
      altitude_m: num(src.altitude_m != null ? src.altitude_m : src.altitude),
      pan_deg: num(src.pan_deg != null ? src.pan_deg : src.pan),
      tilt_deg: num(src.tilt_deg != null ? src.tilt_deg : src.tilt),
    };
    const present = Object.values(out).filter((v) => v !== null).length;
    if (!present) return null;
    Object.keys(out).forEach((k) => { if (out[k] === null) delete out[k]; });
    return out;
  }

  // The camera state the animation ENDS on, in real-world units, derived by
  // running the same keyframe engine that writes the .esp — never re-derived by
  // a parallel implementation. `pan_deg` is the engine's accumulated heading
  // (an .esp pan track normalizes against its own min/max, so values beyond
  // 360° are legitimate and are what a seamless continuation needs);
  // `heading_deg` is the same angle wrapped into [0, 360) for humans.
  // Longitude is wrapped into the exported ±180 contract.
  function finalCameraState(plan, options = {}) {
    const capture = {};
    buildEspKeyframes(plan, { ...options, captureState: capture });
    const state = capture.final;
    if (!state) return null;
    const wrapLng = (v) => { let x = ((Number(v) + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };
    const pan = Number(state.pan) || 0;
    return {
      latitude: round6(state.latitude),
      longitude: round6(wrapLng(state.longitude)),
      altitude_m: Math.round(state.altitude),
      pan_deg: round6(pan),
      heading_deg: round6(((pan % 360) + 360) % 360),
      tilt_deg: round6(state.tilt),
    };
  }

  function uniqueResolvedLocations(segments) {
    const locations = new Map();
    segments.forEach((segment) => {
      if (segment.location && segment.location.name) locations.set(segment.location.name, segment.location);
    });
    return Array.from(locations.values()).map((location) => ({
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      resolution_status: "resolved_fixture",
    }));
  }

  function buildShotPlan(jobName, description, generatedAt = new Date().toISOString(), options = {}) {
    const parsed = parseDescription(description);
    const initialCamera = normalizeInitialCamera(options.initialCamera);
    const motionPolicyOption = options.motionPolicy && typeof options.motionPolicy === "object"
      ? {
        coherent_trajectory: !!options.motionPolicy.coherent_trajectory,
        dedupe_keyframes: !!options.motionPolicy.dedupe_keyframes,
        source: String(options.motionPolicy.source || "caller"),
      }
      : null;
    let aspect = options.aspect || DEFAULT_ASPECT;
    const aspectWarnings = [];
    if (!ASPECTS[aspect]) {
      aspectWarnings.push(`unknown aspect "${aspect}" — using ${DEFAULT_ASPECT}.`);
      aspect = DEFAULT_ASPECT;
    }
    return {
      job_name: cleanString(jobName) || "Earth_Studio_Job",
      version: VERSION,
      generated_at: generatedAt,
      source_description: parsed.source_description,
      parser_strategy: parsed.parser_strategy,
      frame_rate: parsed.frame_rate,
      frame_convention: parsed.frame_convention,
      aspect,
      render_dimensions: { ...ASPECTS[aspect] },
      total_duration_seconds: parsed.total_duration_seconds,
      total_frames: parsed.total_frames,
      // Continuation seed (optional): present ONLY when the caller supplied one,
      // so an ordinary plan keeps its byte-frozen field set exactly.
      ...(initialCamera ? { initial_camera: initialCamera } : {}),
      ...(motionPolicyOption ? { motion_policy: motionPolicyOption } : {}),
      locations: uniqueResolvedLocations(parsed.segments),
      segments: parsed.segments,
      unresolved_items: parsed.unresolved_items,
      // Camera-direction provenance: which motion evidence shaped the easing.
      motion_profile: {
        profile_version: MOTION_PROFILE_VERSION,
        source: "config/earth-studio-motion/motion-profile.json",
        references: ["darien-gap", "mountkinabalu", "radiator-untitled", "servyx"],
        rule: "role-correct gap-relative easing (easeOut departure · auto interior · Google-template segment-boundary deceleration · gentle terminal arrival) + final settle-hold",
      },
      notes: [...parsed.notes,
        "camera motion: internet-reference profile v" + MOTION_PROFILE_VERSION
        + " (easeOut departures, auto interiors, Google-template deceleration on move-ending boundaries — altitude hardest, gentle terminal arrivals; the final move settles early and holds) — deterministically rebuilt from the approved internet reference corpus."],
      manual_earth_studio_steps: [
        "Open Google Earth Studio manually.",
        "Create or open the project manually; this planner does not log in, automate a browser, or control Earth Studio.",
        "Use shot-plan.json coordinates as manual camera/search references.",
        "Use route.kml only as a placemark/path reference asset.",
        "Manually create, review, and adjust all camera keyframes.",
        "Render manually only after Mikko reviews the camera move.",
      ],
      warnings: [
        "KML is a reference asset only and does not create a finished Google Earth Studio camera animation.",
        "Placemark use as camera targets is unverified in v1; manually search or set camera targets from shot-plan.json if needed.",
        "This planner does not render video, manipulate .esp files, control Google Earth Studio, or approve footage.",
        "Technical planning artifacts are not creative approval, rights clearance, or package-run evidence approval.",
        ...aspectWarnings,
        ...parsed.warnings,
      ],
    };
  }

  function buildReadme(plan) {
    return `# ${plan.job_name}

Local Google Earth Studio planning artifacts for a supervised manual build.

## Purpose

This folder converts a constrained text description into reviewable planning files for Google Earth Studio. It is for planning only.

## Not For

- Google login
- Browser automation
- Earth Studio control
- Render automation
- Approval markers
- Package-run state

## Manual Use

1. Review \`shot-plan.json\` and \`shot-plan.md\`.
2. Open Google Earth Studio manually.
3. Import \`earth-studio.esp\` (File > Import) and confirm the generated camera move, or search coordinates manually from \`shot-plan.json\`.
4. Optionally import or reference \`route.kml\` as placemark/path context.
5. Manually review and adjust all camera keyframes.

## Description grammar

Actions: fly to / hover over / orbit / zoom in on / zoom out from a place.
Chain with "then". Modifiers per segment: a duration ("for 5 seconds", "for 2 minutes"),
an altitude ("at 800m", "from space", "low", "high"), a tilt ("top-down",
"tilted", "toward the horizon"), and for orbits an amount and direction
("twice", "180 degrees", "counterclockwise"). Segments without a location
reuse the previous one; segments without a duration get a sensible default.

KML is a reference asset only. It does not create a finished Google Earth Studio camera animation.
`;
  }

  function buildShotPlanMarkdown(plan) {
    const rows = plan.segments
      .map((segment) =>
        `| ${segment.segment_id} | ${segment.action} | ${segment.location_name || "manual review"} | ${segment.altitude_m} | ${segment.tilt_deg} | ${segment.start_seconds}-${segment.end_seconds}s | ${segment.start_frame} | ${segment.end_frame} | ${segment.resolution_status} |`
      )
      .join("\n");
    const locations = plan.locations.length
      ? plan.locations.map((location) => `- ${location.name}: ${location.latitude}, ${location.longitude}`).join("\n")
      : "- none resolved";
    const unresolved = plan.unresolved_items.length
      ? plan.unresolved_items
          .map((item) => `- Segment ${item.segment_id}: ${item.warnings.join("; ")}`)
          .join("\n")
      : "- none";
    const notes = (plan.notes || []).length
      ? plan.notes.map((note) => `- ${note}`).join("\n")
      : "- none";

    return `# Shot Plan: ${plan.job_name}

Total duration: ${plan.total_duration_seconds} seconds
Frame rate: ${plan.frame_rate} fps
Total frames: ${plan.total_frames}
Aspect: ${plan.aspect || DEFAULT_ASPECT} (${plan.render_dimensions ? `${plan.render_dimensions.width}x${plan.render_dimensions.height}` : "1920x1080"})
Frame convention: start_frame inclusive, end_frame exclusive

## Segment Table

| # | Action | Location | Alt (m) | Tilt | Time | start_frame | end_frame | Status |
|---|---|---|---:|---:|---:|---:|---:|---|
${rows}

## Locations

${locations}

## Applied Defaults

${notes}

## Unresolved Warnings

${unresolved}

## Manual Earth Studio Build Summary

- Use this plan as a manual camera-build guide.
- Use the coordinates in \`shot-plan.json\` for search or camera target reference.
- Use \`route.kml\` only as a visual reference asset.
- KML import does not create a finished Earth Studio camera animation.
- Mikko must manually create, review, adjust, and approve keyframes before rendering.
`;
  }

  function escapeXml(value) {
    return cleanString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function kmlCoordinate(location) {
    return `${location.longitude},${location.latitude},0`;
  }

  function buildKml(plan) {
    const placemarks = plan.locations
      .map(
        (location) => `    <Placemark>
      <name>${escapeXml(location.name)}</name>
      <Point><coordinates>${kmlCoordinate(location)}</coordinates></Point>
    </Placemark>`
      )
      .join("\n");
    const pathCoordinates = plan.segments
      .filter((segment) => segment.location)
      .map((segment) => kmlCoordinate(segment.location))
      .join("\n        ");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(plan.job_name)} route reference</name>
    <description>KML reference asset only. This does not create a finished Google Earth Studio camera animation.</description>
${placemarks}
    <Placemark>
      <name>${escapeXml(plan.job_name)} route path reference</name>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>
        ${pathCoordinates}
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>
`;
  }

  function buildChecklist(plan) {
    return `# Earth Studio Build Checklist

## Before Building

- [ ] Review \`shot-plan.json\`.
- [ ] Confirm all unresolved/manual-review warnings are acceptable or repaired manually.
- [ ] Spot-check each resolved location's coordinates in shot-plan.json against a map.

## Manual Google Earth Studio Build

- [ ] Open Google Earth Studio manually.
- [ ] Create or open the project manually.
- [ ] Import \`earth-studio.esp\` and confirm the generated camera move, or build keyframes manually from \`shot-plan.json\`.
- [ ] Treat \`route.kml\` as placemark/path reference only.
- [ ] Confirm frame boundaries use start_frame inclusive and end_frame exclusive.

## Safety Boundary

- [ ] No Google login automation was used.
- [ ] No browser automation was used.
- [ ] No render automation was used.
- [ ] No package-run state or approval markers were written.

This checklist is technical planning support only. It is not creative approval, rights clearance, render approval, or package-run evidence approval.
`;
  }

  // ── Camera keyframe engine ─────────────────────────────────────────────────
  // Build a best-effort Google Earth Studio project (.esp) with camera
  // keyframes. Earth Studio is browser-only with no API, so this file cannot
  // be import-tested headlessly — it follows the documented .esp shape
  // (cameraPositionGroup + cameraRotationGroup keyframes) and must be
  // confirmed with one manual import. shot-plan.json / route.kml remain
  // reliable manual fallbacks.
  //
  // The engine walks resolved segments as a camera state machine
  // (lat/lng/alt/pan/tilt). Frame 0 is the START state of the first segment
  // (a zoom-in begins wide, a fly-to begins high), each later segment
  // continues from where the previous one ended, and tracks only get
  // keyframes when their value changes — with an anchor keyframe at the
  // segment start so a change never bleeds backwards through a hold.
  function espKeyframe(frame, value, transition = "linear") {
    return { time: Math.max(0, Math.round(frame)), value, transitionIn: { type: transition }, transitionOut: { type: transition } };
  }

  function toRadians(degrees) { return (degrees * Math.PI) / 180; }
  function round6(value) { return Math.round(value * 1e6) / 1e6; }
  function smoothstep(t) { return t * t * (3 - 2 * t); }

  function haversineMeters(a, b) {
    const R = 6371000;
    const dLat = toRadians(b.latitude - a.latitude);
    const dLng = toRadians(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Signed shortest-arc longitude delta from -> to, in (-180, 180]. The camera
  // state machine keeps longitude UNWRAPPED (continuous, may exceed ±180) so a
  // Tokyo -> Los Angeles flight crosses the Pacific instead of sweeping the
  // long way around; values are wrapped back into ±180 only at emit time.
  function shortestLngDelta(fromLng, toLng) {
    const d = (((toLng - fromLng) % 360) + 540) % 360 - 180;
    return d === -180 ? 180 : d;
  }

  function wrapLng(value) {
    return ((((value + 180) % 360) + 360) % 360) - 180;
  }

  // Re-emit an UNWRAPPED piecewise-linear longitude track as wrapped [-180,180]
  // keyframes. At each antimeridian crossing a one-frame keyframe pair is
  // inserted (+180 then -180, or the reverse): both sides name the same
  // physical meridian and no frame is rendered between two adjacent integer
  // frames, so the wrap is visually seamless while every exported value stays
  // inside the ±180 contract real Earth Studio has already accepted.
  function wrapLngTrack(track) {
    if (track.length < 2) {
      return track.map((k) => espKeyframe(k.time, round6(wrapLng(k.value))));
    }
    const out = [];
    const push = (frame, value, sampledInterior = false) => {
      const kf = espKeyframe(frame, round6(value));
      if (sampledInterior) kf.sampledInterior = sampledInterior === "in" ? "in"
        : sampledInterior === "out" ? "out" : true;
      if (out.length && out[out.length - 1].time === kf.time) out[out.length - 1] = kf;
      else if (!out.length || out[out.length - 1].time < kf.time) out.push(kf);
    };
    for (let i = 0; i < track.length; i += 1) {
      const cur = track[i];
      if (i > 0) {
        const prev = track[i - 1];
        const lo = Math.min(prev.value, cur.value);
        const hi = Math.max(prev.value, cur.value);
        // Seam values s = 180 + k*360 strictly inside (lo, hi). A single
        // interval spans at most 180° (flights) or ~30° (orbit samples), so at
        // most one seam — the loop stays for safety.
        let s = 180 + Math.ceil((lo - 180) / 360) * 360;
        if (s <= lo) s += 360;
        for (; s < hi; s += 360) {
          const t = (s - prev.value) / (cur.value - prev.value);
          const f = prev.time + (cur.time - prev.time) * t;
          if (cur.time - prev.time < 2) break; // sub-frame interval: wrap lands within one frame anyway
          const before = Math.min(Math.max(Math.floor(f), prev.time), cur.time - 1);
          const eastward = cur.value > prev.value;
          push(before, eastward ? 180 : -180, cur.sampledInterior);
          push(before + 1, eastward ? -180 : 180, cur.sampledInterior);
        }
      }
      push(cur.time, wrapLng(cur.value), cur.sampledInterior);
    }
    return out;
  }

  // Ground offset of a point at bearing/radius from a center. Use a spherical
  // destination rather than an equirectangular longitude delta: the latter
  // divides by cos(latitude), amplifying error near the poles and can emit
  // non-finite longitudes at ±90°. Earth Studio receives the resulting points
  // as camera positions, so a small ring-geometry error is visible as orbit
  // breathing and a non-finite point is unrecoverable.
  function offsetPoint(center, bearingDeg, radiusM) {
    const lat1 = toRadians(Number(center.latitude));
    const lon1 = toRadians(Number(center.longitude));
    const bearing = toRadians(Number(bearingDeg));
    const angularDistance = Math.max(0, Number(radiusM)) / EARTH_RADIUS_M;
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinD = Math.sin(angularDistance);
    const cosD = Math.cos(angularDistance);
    const sinLat2 = sinLat1 * cosD + cosLat1 * sinD * Math.cos(bearing);
    const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * sinD * cosLat1,
      cosD - sinLat1 * Math.sin(lat2),
    );
    return {
      latitude: round6((lat2 * 180) / Math.PI),
      longitude: round6(wrapLng((lon2 * 180) / Math.PI)),
    };
  }

  // Initial bearing from a to b, in degrees clockwise from north. This is used
  // only for local orbit-exit phase selection; the main travel path continues
  // to use the planner's existing shortest-arc longitude state machine.
  function bearingDeg(a, b) {
    const lat1 = toRadians(Number(a.latitude));
    const lat2 = toRadians(Number(b.latitude));
    const dLng = toRadians(Number(b.longitude) - Number(a.longitude));
    return ((Math.atan2(
      Math.sin(dLng) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng),
    ) * 180 / Math.PI) + 360) % 360;
  }

  // Choose the free phase of an orbit whose NEXT segment is travel. The orbit
  // tangent at theta is theta + 90° for a clockwise sweep and theta - 90° for
  // a counterclockwise sweep. A few fixed-point iterations are enough to solve
  // the small dependency between the exit point and its bearing to the next
  // destination. This is deliberately used only when the orbit has no prior
  // positional handoff to preserve: an orbit entered from travel keeps its
  // exact ring-entry pose.
  function orbitExitTheta(center, radiusM, sweepDeg, destination) {
    const direction = sweepDeg >= 0 ? 1 : -1;
    const angularError = (theta) => {
      const point = offsetPoint(center, theta, radiusM);
      const desired = bearingDeg(point, destination);
      return Math.abs((((theta + direction * 90) - desired + 540) % 360) - 180);
    };
    // The bearing-to-destination function is not globally contractive for
    // long legs, so fixed-point iteration can settle on a poor phase. A small
    // deterministic coarse search followed by a local refinement is safer and
    // remains negligible beside trajectory generation.
    let bestTheta = 0;
    let bestError = Infinity;
    for (let i = 0; i < 720; i += 1) {
      const theta = i * 0.5;
      const error = angularError(theta);
      if (error < bestError) { bestError = error; bestTheta = theta; }
    }
    for (let step = 0.25; step >= 0.01; step /= 2) {
      for (const candidate of [bestTheta - step, bestTheta + step]) {
        const error = angularError(candidate);
        if (error < bestError) { bestError = error; bestTheta = candidate; }
      }
    }
    return bestTheta;
  }

  // Where the camera starts when the plan opens with this segment.
  // A continuation seed: the exact camera state a PREVIOUS animation ended on
  // (see finalCameraState / continuation-state.json). Only the five values the
  // .esp actually keyframes exist — longitude, latitude, altitude, pan
  // (rotationX) and tilt (rotationY); roll and FOV are never keyframed, so
  // they are not part of a camera state and are not invented here. Missing
  // fields fall back to the derived opening state for that field.
  function seededCameraState(seed, segment, endAltitude, tilt) {
    const derived = initialCameraState(segment, endAltitude, tilt);
    const num = (v, fallback) => (Number.isFinite(v) ? Number(v) : fallback);
    return {
      latitude: num(seed.latitude, derived.latitude),
      longitude: num(seed.longitude, derived.longitude),
      altitude: clampAltitude(num(seed.altitude_m, num(seed.altitude, derived.altitude)),
        (segment.location && segment.location.min_altitude_m) || 0),
      pan: num(seed.pan_deg, num(seed.pan, derived.pan)),
      tilt: num(seed.tilt_deg, num(seed.tilt, derived.tilt)),
    };
  }

  function initialCameraState(segment, endAltitude, tilt) {
    const location = segment.location;
    const minAlt = location.min_altitude_m || 0;
    const state = { latitude: location.latitude, longitude: location.longitude, altitude: endAltitude, pan: 0, tilt };
    if (segment.action === "fly_to") {
      // Establishing dive: begin high above the target and descend into it.
      state.altitude = clampAltitude(Math.min(Math.max(endAltitude * 4, 10000), 2500000), minAlt);
    } else if (segment.action === "zoom_in") {
      state.altitude = clampAltitude(Math.max(endAltitude * 3, DEFAULT_ALTITUDE_M), minAlt);
    } else if (segment.action === "zoom_out") {
      state.altitude = clampAltitude(Math.min(DEFAULT_ALTITUDE_M, Math.max(600, endAltitude / 3)), minAlt);
    } else if (segment.action === "orbit") {
      // Begin already on the orbit circle, facing the target.
      const radius = orbitRadiusMeters(endAltitude, tilt);
      const start = offsetPoint(location, 0, radius);
      state.latitude = start.latitude;
      state.longitude = start.longitude;
      state.pan = 180;
    } else if (segment.action === "hover" && segment.stages_orbit_entry) {
      // A staged establishing hold opens ON the ring the following orbit will
      // ride, facing the subject — the same opening geometry an orbit-first shot
      // gets, so the orbit that follows has nothing left to acquire.
      const radius = orbitRadiusMeters(endAltitude, tilt);
      const start = offsetPoint(location, 0, radius);
      state.latitude = start.latitude;
      state.longitude = start.longitude;
      state.pan = 180;
    }
    return state;
  }

  // A tilted camera at altitude A looking at the target sits roughly
  // A*tan(tilt) away on the ground. Top-down (tilt 0) degenerates to a
  // spin-in-place, which is exactly the top-down orbit look.
  function orbitRadiusMeters(altitude, tiltDeg) {
    const safeAltitude = Number.isFinite(Number(altitude)) ? Math.max(0, Number(altitude)) : 0;
    const tilt = Math.min(Math.max(Number(tiltDeg) || 0, 0), 80);
    return Math.min(safeAltitude * Math.tan(toRadians(tilt)), 80000);
  }

  // Operator directive (2026-08-19): "the camera movement must always follow a
  // single coherent trajectory; wobbling at any point is prohibited by default"
  // and "if some keyframes have no change between them, remove the keyframe when
  // finishing the animation". Both are opt-in via plan.motion_policy so the
  // byte-frozen freeform path is untouched.
  function motionPolicy(plan, options = {}) {
    const p = (plan && plan.motion_policy) || null;
    return {
      coherentTrajectory: !!(p && p.coherent_trajectory) && !options.compareLegacyMotion,
      dedupeKeyframes: !!(p && p.dedupe_keyframes) && !options.compareLegacyMotion,
    };
  }

  // Drop keyframes that change nothing: an interior keyframe whose value equals
  // BOTH neighbours contributes no motion, so removing it leaves the curve
  // identical while making the timeline readable. Flat-only by design — a
  // collinear-but-moving keyframe still carries its own easing handles.
  function dropRedundantKeyframes(track) {
    if (!Array.isArray(track) || track.length < 3) return track;
    const same = (a, b) => Math.abs(a - b) <= Math.max(1e-9, 1e-12 * Math.max(Math.abs(a), Math.abs(b)));
    let out = track;
    for (let pass = 0; pass < 64; pass += 1) {
      const next = out.filter((kf, i) => {
        if (i === 0 || i === out.length - 1) return true;
        return kf.semanticBoundary
          || !(same(kf.value, out[i - 1].value) && same(out[i + 1].value, kf.value));
      });
      if (next.length === out.length) return next;
      out = next;
    }
    return out;
  }

  // Requested versus delivered orbit sweep rate. Runs the real keyframe path, so
  // the acquisition duration it reports is the one the .esp actually contains.
  function orbitTimingReport(plan, options = {}) {
    const orbitTiming = [];
    buildEspKeyframes(plan, { ...options, orbitTiming });
    return orbitTiming.map((row) => {
      const sweepSeconds = row.sweep_frames / (row.frame_rate || FRAME_RATE);
      const requestedRate = row.requested_seconds > 0 ? row.requested_arc_deg / row.requested_seconds : null;
      const deliveredRate = sweepSeconds > 0 ? row.requested_arc_deg / sweepSeconds : null;
      return {
        ...row,
        acquisition_seconds: row.acquisition_frames / (row.frame_rate || FRAME_RATE),
        sweep_seconds: sweepSeconds,
        requested_rate_deg_per_s: requestedRate,
        delivered_rate_deg_per_s: deliveredRate,
        rate_error_fraction: requestedRate && deliveredRate ? (deliveredRate / requestedRate) - 1 : null,
        // What the segment would have to be for the sweep to run at the rate the
        // operator asked for. Reported, not applied.
        //
        // NOT `requested + acquisition`. The acquisition is sized from the orbit's
        // OWN ground speed — `offRing / (radius·sweep / orbitSeconds)` — so it is a
        // fixed FRACTION of the segment and grows with it. Lengthening the segment
        // by the measured acquisition therefore falls short: 16 s + 5.1 s = 21.1 s
        // was measured delivering a 14.4 s sweep, still 47% fast. Holding the rate
        // is a fixed point, `T = requested / (1 - k)`: 23.49 s for k = 0.319.
        segment_seconds_for_requested_rate: (() => {
          const segmentSeconds = row.segment_frames / (row.frame_rate || FRAME_RATE);
          if (!(segmentSeconds > 0)) return null;
          const k = row.acquisition_frames / row.segment_frames;
          return k >= 1 ? null : row.requested_seconds / (1 - k);
        })(),
        acquisition_fraction: row.segment_frames > 0
          ? row.acquisition_frames / row.segment_frames : null,
      };
    });
  }

  function buildEspKeyframes(plan, options = {}) {
    const policy = motionPolicy(plan, options);
    const tracks = { lng: [], lat: [], alt: [], pan: [], tilt: [] };
    // `sampledInterior` marks a keyframe that is an INTERIOR SAMPLE of a curve
    // this code is describing point-by-point — an orbit's ring, a space zoom's
    // composition-constrained climb. The serializer emits those hard-linear;
    // see the note at the emit site for why ease handles are actively harmful
    // on a sampled curve.
    //
    // `true` means BOTH sides are linear. `"in"` means only the incoming side
    // is: the keyframe closes a sampled curve but then departs into something
    // else, so the curve must be protected on the way in while the departure
    // is still allowed to ease. `"out"` is the mirror image: the keyframe keeps
    // its own eased arrival but the span LEAVING it must be exactly flat, which
    // is what fences a static hold from the movements on either side of it.
    const put = (trackName, frame, value, sampledInterior = false, semanticBoundary = false) => {
      const track = tracks[trackName];
      const kf = espKeyframe(frame, value);
      // Preserve the VARIANT: "in" must not collapse to true, or a closing
      // sample is treated as an interior one and loses its arrival easing.
      if (sampledInterior) kf.sampledInterior = sampledInterior === "in" ? "in"
        : sampledInterior === "out" ? "out" : true;
      // Same-valued boundary keys fence a preceding hold from the following
      // movement. Keep the marker internal; the serializer ignores it.
      if (semanticBoundary) kf.semanticBoundary = true;
      if (track.length && track[track.length - 1].time === kf.time) track[track.length - 1] = kf;
      else if (!track.length || track[track.length - 1].time < kf.time) track.push(kf);
    };
    // Attach an analytic slope (value units per FRAME) to the most recent
    // keyframe on a track. The serializer turns it into a handle whose y
    // actually carries that slope, instead of the default horizontal y = 0.
    const setRate = (trackName, side, ratePerFrame) => {
      const kf = tracks[trackName][tracks[trackName].length - 1];
      if (!kf || !Number.isFinite(ratePerFrame)) return;
      if (side === "in" || side === "both") kf.rateIn = ratePerFrame;
      if (side === "out" || side === "both") kf.rateOut = ratePerFrame;
    };
    // Pin the OUT side of the newest keyframe hard-linear without disturbing the
    // easing it already carries on the way IN. A keyframe already protected on
    // the way in becomes linear on both sides.
    const pinOut = (trackName) => {
      const kf = tracks[trackName][tracks[trackName].length - 1];
      if (!kf) return;
      kf.sampledInterior = (kf.sampledInterior === "in" || kf.sampledInterior === true) ? true : "out";
    };
    const last = (trackName) => (tracks[trackName].length ? tracks[trackName][tracks[trackName].length - 1] : null);
    // Move a track to `value` across [startFrame, endFrame], anchoring the old
    // value at startFrame so the change does not bleed back through a hold.
    const change = (trackName, startFrame, endFrame, value) => {
      const previous = last(trackName);
      if (previous && previous.value === value) return;
      if (previous && previous.time < startFrame) put(trackName, startFrame, previous.value, false, true);
      put(trackName, endFrame, value);
    };
    const anchor = (trackName, startFrame) => {
      const previous = last(trackName);
      if (previous && previous.time < startFrame) put(trackName, startFrame, previous.value, false, true);
    };

    const resolved = plan.segments.filter((s) => s.location && s.duration_seconds > 0);
    if (!resolved.length) return tracks;

    let state = null;
    // Did the opening camera come from a continuation seed? A seeded opening is
    // the previous animation's exact final frame and must never be re-placed.
    let openedFromSeed = false;
    resolved.forEach((segment, idx) => {
      const location = segment.location;
      const minAlt = location.min_altitude_m || 0;
      const endAltitude = clampAltitude(segment.altitude_m || DEFAULT_ALTITUDE_M, minAlt);
      const tilt = typeof segment.tilt_deg === "number" ? segment.tilt_deg : 45;
      const sf = segment.start_frame;
      const ef = segment.end_frame;

      if (!state) {
        // A continuation seed replaces ONLY the opening state; every downstream
        // rule (easing, arcs, settle-hold, orbit ring entry) is untouched.
        const seed = options.initialCamera;
        openedFromSeed = !!(seed && typeof seed === "object");
        state = openedFromSeed
          ? seededCameraState(seed, segment, endAltitude, tilt)
          : initialCameraState(segment, endAltitude, tilt);
        // STAGE THE OPENING HOLD AT THE ORBIT'S EXIT-ALIGNED BEARING.
        //
        // A staged hold is free to choose WHERE on the ring it establishes from,
        // and that choice also fixes where the following orbit ENDS — the sweep
        // runs from the staged bearing. `orbitExitTheta` can solve for an exit
        // where the orbit's tangential motion already points at the next
        // destination, but it was only allowed to when the orbit opened the shot.
        // A staged hold makes the same freedom available one movement earlier:
        // measured on "hold the Colosseum, half-orbit it, then travel to Paris",
        // the orbit exited 176 deg away from the destination; solving the phase
        // backwards from the exit brings it in line, and costs nothing because
        // the hold had to pick some bearing anyway.
        //
        // A continuation seed is never restaged (frame 0 belongs to the previous
        // animation), and if no later destination qualifies this does nothing.
        if (policy.coherentTrajectory && !openedFromSeed && segment.stages_orbit_entry) {
          const orbitSeg = resolved[idx + 1];
          if (orbitSeg && orbitSeg.action === "orbit" && orbitSeg.segment_id === segment.stages_orbit_entry) {
            const orbitRadius = orbitRadiusMeters(
              clampAltitude(orbitSeg.altitude_m || DEFAULT_ALTITUDE_M, (orbitSeg.location && orbitSeg.location.min_altitude_m) || 0),
              typeof orbitSeg.tilt_deg === "number" ? orbitSeg.tilt_deg : 45,
            );
            const orbitSweep = (orbitSeg.orbit_degrees || 360) * (orbitSeg.orbit_direction || 1);
            let dest = null;
            for (let j = idx + 2; j < resolved.length; j += 1) {
              const cand = resolved[j];
              if (!cand.location) continue;
              if (cand.action === "orbit") break;
              if (!["fly_to", "zoom_in", "zoom_out"].includes(cand.action)) continue;
              if (haversineMeters(orbitSeg.location, cand.location) > Math.max(orbitRadius * 2, 1000)) { dest = cand; break; }
            }
            if (dest && orbitRadius > 1) {
              const thetaEndStaged = orbitExitTheta(orbitSeg.location, orbitRadius, orbitSweep, dest.location);
              const theta0Staged = thetaEndStaged - orbitSweep;
              const staged = offsetPoint(orbitSeg.location, theta0Staged, orbitRadius);
              state = { ...state, latitude: staged.latitude, longitude: staged.longitude, pan: theta0Staged + 180 };
            }
          }
        }
        put("lng", sf, state.longitude);
        put("lat", sf, state.latitude);
        put("alt", sf, state.altitude);
        put("pan", sf, state.pan);
        put("tilt", sf, state.tilt);
      }

      // The segment's target longitude expressed in the camera's UNWRAPPED
      // frame: continue along the shortest arc from wherever the camera is
      // (state.longitude may legitimately sit outside ±180 after a crossing).
      const targetLng = state.longitude + shortestLngDelta(state.longitude, location.longitude);
      const locRef = { ...location, longitude: targetLng };

      if (segment.action === "orbit") {
        const sweep = (segment.orbit_degrees || 360) * (segment.orbit_direction || 1);
        const radius = orbitRadiusMeters(endAltitude, tilt);
        // Enter the circle at the bearing the camera is already facing away
        // from, so the pan track stays continuous (fixes the orbit-after-orbit
        // static bug: each orbit adds its sweep to the accumulated pan).
        // Where is this orbit actually leaving TO?
        //
        // The immediate successor is not always the answer. The `cinematic`
        // travel style opens with a same-place pull-back, so an orbit followed
        // by a real crossing had an immediate successor sitting on its own
        // subject: the exit-alignment gate saw zero distance and never fired.
        // Measured on "orbit the Colosseum then fly to Paris": with a direct
        // fly the orbit exits 5 deg off the travel direction; with the cinematic
        // style, which is what the GUI actually builds, it exited 142 deg off.
        // Look past same-place preparatory moves to the first successor that
        // genuinely travels somewhere else.
        const exitTarget = (() => {
          for (let j = idx + 1; j < resolved.length; j += 1) {
            const cand = resolved[j];
            if (!cand.location) continue;
            if (!["fly_to", "zoom_in", "zoom_out"].includes(cand.action)) {
              if (cand.action === "orbit") return null; // another orbit owns its own phase
              continue;
            }
            if (haversineMeters(location, cand.location) > Math.max(radius * 2, 1000)) return cand;
          }
          return null;
        })();
        const canChooseInitialPhase = policy.coherentTrajectory
          && idx === 0
          && exitTarget;
        const thetaEnd = canChooseInitialPhase
          ? orbitExitTheta(locRef, radius, sweep, exitTarget.location)
          : null;
        // Where does the sweep start from?
        //
        // `state.pan - 180` is the camera's own facing, which is the right entry
        // bearing whenever the camera is already looking at the target from the
        // ring. It is NOT right for a camera that arrived from somewhere else —
        // a continuation seed, or any prior movement that left pan unrelated to
        // where the camera actually sits. Measured with a seeded opening 1,106 m
        // from the Colosseum: pan said the ring entry was at -180 deg while the
        // camera physically sat at -9.5 deg, so acquisition flew it 170.5 deg
        // AROUND the ring, losing the subject by up to 170 deg on the way.
        //
        // When the camera is already off-centre and no exit constraint applies,
        // enter the ring at the bearing it is ALREADY on. Acquisition then only
        // has to close the radius and turn to face the subject — it never
        // travels around a circle it is already standing on.
        const preCosLat = Math.cos(toRadians(locRef.latitude)) || 1e-6;
        const preRadiusM = Math.hypot(
          (state.latitude - locRef.latitude) * 111320,
          (state.longitude - locRef.longitude) * 111320 * preCosLat,
        );
        const preBearingDeg = (Math.atan2(
          (state.longitude - locRef.longitude) * 111320 * preCosLat,
          (state.latitude - locRef.latitude) * 111320,
        ) * 180) / Math.PI;
        // "Already facing the target" means pan agrees with the geometry; then
        // pan is authoritative and this changes nothing.
        const panAgreesWithPosition = preRadiusM > 1
          && Math.abs(shortestLngDelta(state.pan - 180, preBearingDeg)) < 1;
        const enterWhereItStands = policy.coherentTrajectory
          && thetaEnd === null
          && preRadiusM > 1
          && !panAgreesWithPosition;
        const theta0 = thetaEnd !== null ? thetaEnd - sweep
          : enterWhereItStands ? preBearingDeg
          : state.pan - 180;
        const orbitStartPan = thetaEnd === null && !enterWhereItStands ? state.pan : theta0 + 180;
        // OPENING ORBIT: place frame 0 ON the ring at the bearing the sweep
        // actually starts from. initialCameraState puts an opening orbit at
        // bearing 0 with pan 180, which was right while theta0 was always 0 —
        // but the exit-phase lookahead back-solves theta0 from where the orbit
        // needs to END, and the opening position was left behind. Measured on
        // "orbit the Colosseum, then fly to Paris": frame 0 sat at bearing 0
        // with pan 47.9°, a 132° aim error, and the camera then slid 122° around
        // the ring inside the first 0.57 s.
        //
        // Frame 0 is the shot's own first frame, so placing it is composition,
        // not a jump — nothing precedes it. A CONTINUATION seed is different:
        // that frame belongs to the previous animation and is never re-placed.
        // With theta0 === 0 this reproduces the old values exactly.
        if (idx === 0 && !openedFromSeed) {
          const opening = offsetPoint(locRef, theta0, radius);
          state = { ...state, latitude: opening.latitude, longitude: opening.longitude, pan: orbitStartPan };
          put("lng", sf, opening.longitude);
          put("lat", sf, opening.latitude);
          put("pan", sf, orbitStartPan);
        }
        const stepDeg = policy.coherentTrajectory ? ORBIT_SAMPLE_STEP_DEG : ORBIT_LEGACY_SAMPLE_STEP_DEG;
        const sampleCount = Math.max(4, Math.ceil(Math.abs(sweep) / stepDeg));
        anchor("lng", sf);
        anchor("lat", sf);
        if (policy.coherentTrajectory) anchor("pan", sf);
        let lastPoint = { latitude: state.latitude, longitude: state.longitude };
        // ── Phase B: RING ACQUISITION ──────────────────────────────────────
        // Where is the camera relative to the geometry this orbit needs?
        const fps = plan.frame_rate || FRAME_RATE;
        const orbitSeconds = Math.max(1e-6, (ef - sf) / fps);
        const cosLat = Math.cos(toRadians(locRef.latitude)) || 1e-6;
        const radialM = (pt) => Math.hypot(
          (pt.latitude - locRef.latitude) * 111320,
          (pt.longitude - locRef.longitude) * 111320 * cosLat,
        );
        const bearingOf = (pt) => (Math.atan2(
          (pt.longitude - locRef.longitude) * 111320 * cosLat,
          (pt.latitude - locRef.latitude) * 111320,
        ) * 180) / Math.PI;
        const ringEntry = offsetPoint(locRef, theta0, radius);
        const startRadius = radialM(state);
        const offRingM = haversineMeters(state, ringEntry);
        const ringTolM = Math.max(radius * ORBIT_ENTRY_RING_TOLERANCE_FRACTION, ORBIT_ENTRY_RING_TOLERANCE_M);
        const tiltDeltaDeg = Math.abs(tilt - state.tilt);
        const needsRing = offRingM > ringTolM;
        const needsTilt = tiltDeltaDeg > ORBIT_ENTRY_TILT_TOLERANCE_DEG;
        // Entry duration is DERIVED, not picked: the pitch change gets the calm
        // rotation rate this module already uses for orbit entry, and the lateral
        // move gets the orbit's OWN ground speed, so acquisition and sweep travel
        // at the same pace and read as one continuous camera performance. Bounded
        // so a long acquisition can never eat the shot.
        const sweepGroundSpeed = (radius * Math.abs(toRadians(sweep))) / orbitSeconds;
        const lateralSeconds = sweepGroundSpeed > 1e-6 ? offRingM / sweepGroundSpeed : 0;
        const tiltSeconds = tiltDeltaDeg / ORBIT_ENTRY_TILT_MAX_RATE_DEG_PER_S;
        // The HEADING turn is work too. A camera arriving from elsewhere may not
        // be facing the subject at all — a continuation seed measured 170.5 deg
        // off — and sizing the phase from pitch and distance alone whipped that
        // turn through in about 0.7 s. Heading gets the same calm rotation rate
        // as pitch.
        const panDeltaDeg = Math.abs(shortestLngDelta(state.pan, theta0 + 180));
        const panSeconds = panDeltaDeg / ORBIT_ENTRY_TILT_MAX_RATE_DEG_PER_S;
        const needsPan = panDeltaDeg > 1;
        let entryFrames = 0;
        if (policy.coherentTrajectory && (needsRing || needsTilt || needsPan)) {
          const wanted = Math.max(
            ORBIT_ENTRY_MIN_SECONDS,
            needsRing ? lateralSeconds : 0,
            needsTilt ? tiltSeconds : 0,
            needsPan ? panSeconds : 0,
          );
          const capped = Math.min(wanted, orbitSeconds * ORBIT_ENTRY_MAX_FRACTION);
          entryFrames = Math.round(capped * fps);
          if (entryFrames < 1) entryFrames = 0;
        }
        const sweepStart = sf + entryFrames;
        // Acquisition duration is DERIVED here, during keyframe generation, from
        // the camera state this walk has built up — the plan layer cannot know it.
        // That is exactly why the cost of it was invisible: the segment keeps its
        // requested duration and the sweep quietly gets whatever is left, so a
        // requested 180 deg over 16 s can be delivered as 180 deg over 11.2 s.
        // Nothing was wrong with the frames; the ANGULAR RATE silently stopped
        // matching the operator's own number.
        //
        // An opt-in out-parameter so a caller can report that instead of having to
        // re-derive it. Pure observation: no behaviour depends on it.
        if (Array.isArray(options.orbitTiming)) {
          options.orbitTiming.push({
            segment_id: segment.segment_id,
            requested_seconds: segment.duration_seconds,
            requested_arc_deg: Math.abs(Number(segment.orbit_degrees) || 0),
            segment_frames: ef - sf,
            acquisition_frames: entryFrames,
            sweep_frames: ef - sweepStart,
            frame_rate: fps,
          });
        }
        if (entryFrames > 0) {
          // Bearing runs from wherever the camera actually is to the sweep's
          // starting bearing, along the shortest arc; radius converges
          // monotonically to the ring. At the ring's CENTRE the bearing is
          // undefined, so the camera moves straight out along theta0 — a purely
          // radial acquisition, which is also the shortest way onto the ring.
          const startBearing = startRadius > 1 ? bearingOf(state) : theta0;
          const bearingDelta = shortestLngDelta(startBearing, theta0);
          // Heading turns with the camera so it keeps facing the subject. Near
          // the centre at a top-down pitch heading is not visually meaningful,
          // so a smooth turn beats snapping to the ring's aim.
          const panTarget = state.pan + shortestLngDelta(state.pan, theta0 + 180);
          const entrySamples = Math.max(2, Math.ceil(Math.abs(bearingDelta) / stepDeg));
          // Anchor pitch and altitude at the boundary FIRST. Without this the
          // acquisition's tilt keyframe is the track's next keyframe after the
          // opening one, so the change interpolates from frame 0 and the pitch
          // creeps upward through the whole PRECEDING movement: a fly->orbit
          // measured 45 deg at t=0 drifting to 51.8 deg by the time the orbit
          // even started. Acquisition must be confined to its own window.
          anchor("tilt", sf);
          anchor("alt", sf);
          for (let i = 1; i <= entrySamples; i += 1) {
            const u = i / entrySamples;
            const pt = offsetPoint(locRef, startBearing + bearingDelta * u, startRadius + (radius - startRadius) * u);
            const frame = sf + entryFrames * u;
            const interior = i < entrySamples;
            // Only emit what actually has to be acquired. When the camera is
            // already on the ring (a fly/zoom annotated to land on the ring
            // entry) and only the pitch has to settle, re-placing position adds
            // keyframes that move the camera by ~1 m of rounding noise and
            // nothing else.
            if (needsRing) {
              put("lat", frame, pt.latitude, interior);
              put("lng", frame, pt.longitude, interior);
            }
            if (needsRing || needsPan) {
              put("pan", frame, state.pan + (panTarget - state.pan) * u, interior);
            }
            if (needsTilt) put("tilt", frame, round6(state.tilt + (tilt - state.tilt) * u), interior);
          }
          // Altitude also finishes here, so the sweep holds it.
          if (state.altitude !== endAltitude) change("alt", sf, sweepStart, endAltitude);
          if (needsRing) {
            lastPoint = offsetPoint(locRef, theta0, radius);
            state = { ...state, latitude: lastPoint.latitude, longitude: lastPoint.longitude, pan: theta0 + 180 };
          }
          state = { ...state, altitude: endAltitude, tilt };
        }
        // Snap to the sweep's opening heading ONLY when no acquisition phase is
        // going to interpolate pan itself. Doing both put a spurious keyframe at
        // the boundary and the heading dipped and came back (measured 170.5 ->
        // 85.3 -> 170.5 within 15 frames) — a pan wobble at the very moment the
        // orbit starts.
        if (policy.coherentTrajectory && entryFrames === 0 && orbitStartPan !== state.pan) {
          put("pan", sf, orbitStartPan);
        }
        // After an acquisition the sweep continues from the pan the entry left.
        const sweepPanBase = entryFrames > 0 ? theta0 + 180 : orbitStartPan;
        const spanFrames = ef - sweepStart;
        for (let i = 1; i <= sampleCount; i += 1) {
          // TIME-QUANTIZED SAMPLING: take the ANGLE at the frame this sample
          // actually lands on, not at the ideal fractional time.
          //
          // Every keyframe is rounded to an integer frame. When the sweep's frame
          // span does not divide by the sample count the intervals alternate —
          // 27,26,27,27,26,... for 480 frames over 18 samples — and that
          // distribution is already optimal: they differ by exactly one frame and
          // alternate regularly, which is what a Bresenham-style redistribution
          // would produce anyway. Redistributing the rounding therefore cannot
          // help, and 480/18 simply has no integer answer.
          //
          // The ripple came from a MISMATCH rather than from the rounding. The
          // angle was taken at the ideal time while the keyframe landed at the
          // rounded one, so every chord subtended an identical angle but was
          // given a different number of frames to cross. Angular rate alternated
          // by the same 1/26 the frames did: 3.85% measured on a 180 deg / 16 s
          // orbit, an order of magnitude above the 0.38% the 10 deg chord
          // geometry contributes.
          //
          // Taking the angle at the ACTUAL frame makes each chord proportional to
          // the frames available to cross it, so the rate is uniform by
          // construction. Same sample count, same keyframes, same 10 deg
          // geometry, exact first and last frame, exact swept arc — only the
          // sample times and the angles that match them change.
          // Gated with every other motion improvement in this file, so the
          // byte-frozen freeform path stays byte-frozen by construction rather
          // than by luck. (It happens to be a no-op on the current frozen
          // control — its legacy 30 deg sampling gives 1080 frames over 24
          // samples, exactly 45 each — but a freeform orbit whose span did not
          // divide would have moved, and that is not a thing to leave to chance.)
          const frame = sweepStart + (policy.coherentTrajectory
            ? Math.round((spanFrames * i) / sampleCount)
            : (spanFrames * i) / sampleCount);
          const t = policy.coherentTrajectory && spanFrames > 0
            ? (frame - sweepStart) / spanFrames
            : i / sampleCount;
          lastPoint = offsetPoint(locRef, theta0 + sweep * t, radius);
          // Interior samples sweep at a constant rate; the closing sample keeps
          // its normal arrival easing so the orbit settles rather than stopping
          // dead.
          const closing = i === sampleCount;
          const interior = policy.coherentTrajectory
            ? (closing ? (resolved[idx + 1] ? "in" : false) : true)
            : false;
          put("lat", frame, lastPoint.latitude, interior);
          put("lng", frame, lastPoint.longitude, interior);
          // Heading is CO-SAMPLED with position: the camera faces the target
          // from wherever it actually is, on the same time base and with the
          // same transition shape. A 2-keyframe eased pan against a ~uniform
          // multi-sample ground path gives look direction and position two
          // different velocity profiles, and the subject slides across frame
          // through the middle of the orbit (measured: 28 deg off-target).
          if (policy.coherentTrajectory) put("pan", frame, sweepPanBase + sweep * t, interior);
        }
        // Phase C holds radius, altitude and pitch — acquisition already put the
        // camera in orbit geometry, so these are no-ops after a real entry.
        change("alt", sweepStart, ef, endAltitude);
        change("tilt", sweepStart, ef, tilt);
        if (!policy.coherentTrajectory) change("pan", sf, ef, orbitStartPan + sweep);
        state = { latitude: lastPoint.latitude, longitude: lastPoint.longitude, altitude: endAltitude, pan: sweepPanBase + sweep, tilt };
        return;
      }

      // fly_to / hover / zoom_in / zoom_out: move (or hold) position, with an
      // eased altitude profile and a cinematic arc on long flights.
      // Settle-hold (motion profile v2): the shot's FINAL positional move
      // completes early and holds — approved internet references end all
      // motion before the last frame (mountkinabalu t=0.80) instead of moving
      // into a hard final-frame stop.
      let em = ef;
      if (!options.compareLegacyMotion && idx === resolved.length - 1 && segment.action !== "hover" && segment.duration_seconds >= MOTION_SETTLE.min_segment_seconds) {
        const fpsFrames = (plan.frame_rate || FRAME_RATE);
        const hold = Math.min(Math.round((ef - sf) * MOTION_SETTLE.fraction), Math.round(MOTION_SETTLE.max_seconds * fpsFrames));
        if (hold >= Math.round(MOTION_SETTLE.min_hold_seconds * fpsFrames)) em = ef - hold;
      }
      const distance = haversineMeters(state, location);
      // The cinematic arc adds a sine hump inside one fly_to, which reads as the
      // camera wobbling up and back down mid-move (measured: a 15 s Helsinki ->
      // Stockholm route climbed 51 -> 190 -> 51 km). Under a coherent-trajectory
      // policy the altitude profile belongs to the journey's travel shape
      // (pull back / cruise / descend), which is monotonic per movement.
      const arcBump = !policy.coherentTrajectory && segment.action === "fly_to" && distance > 30000
        ? Math.min(distance * 0.35, 2500000) : 0;
      const constrainedSpaceZoom = segment.action === "zoom_out"
        && segment.tilt_source === "semantic_space_composition";
      // A MONOTONIC altitude change needs exactly two keyframes. Sampling a
      // smoothstep at 0.25/0.5/0.75/1 and then letting the serializer ease each
      // sample shapes the same move twice, and because a default handle has
      // y = 0 (horizontal, slope pinned to zero) every interior sample becomes
      // a dead stop: measured 3 interior stalls on every altitude change, so a
      // simple climb or push played as four little lurches. The easing profile
      // already supplies the ease-out departure and decelerating arrival, so
      // dropping the interior samples is both smoother AND fewer keyframes.
      //
      // Two cases keep their samples because the samples carry real
      // information rather than a re-shaped ease:
      //   arcBump            — the legacy sine hump is not monotonic.
      //   constrainedSpaceZoom — each sample enforces the globe-limb
      //                          composition bound at that altitude.
      const monotonicAltitude = policy.coherentTrajectory && !arcBump && !constrainedSpaceZoom;
      if (monotonicAltitude) {
        if (state.altitude !== endAltitude) {
          change("alt", sf, em, Math.round(clampAltitude(endAltitude, minAlt)));
        }
      } else if (arcBump || state.altitude !== endAltitude) {
        anchor("alt", sf);
        const altitudeFractions = constrainedSpaceZoom
          ? Array.from({ length: SPACE_ZOOM_COMPOSITION_SAMPLES }, (_, i) => (i + 1) / SPACE_ZOOM_COMPOSITION_SAMPLES)
          : [0.25, 0.5, 0.75, 1];
        altitudeFractions.forEach((t, sampleIndex) => {
          const eased = state.altitude + (endAltitude - state.altitude) * smoothstep(t);
          const sampledAltitude = Math.round(clampAltitude(eased + arcBump * Math.sin(Math.PI * t), minAlt));
          // A constrained space zoom NEEDS all 16 samples — each one pins the
          // globe-limb composition bound at that altitude — but their ease
          // handles were pinning the climb rate to zero 14 times on the way up.
          // Keep the samples, drop the handles.
          const interior = policy.coherentTrajectory && constrainedSpaceZoom
            && sampleIndex < altitudeFractions.length - 1;
          put("alt", sf + (em - sf) * t, sampledAltitude, interior);
          if (constrainedSpaceZoom) {
            const authoredTilt = state.tilt
              + (segment.unconstrained_tilt_deg - state.tilt) * smoothstep(t);
            put("tilt", sf + (em - sf) * t,
              round6(Math.min(authoredTilt, maxDerivedSpaceZoomTiltDeg(sampledAltitude))), interior);
          }
        });
      }
      // Successor-orbit ring entry (plan-annotated lookahead): land the move
      // exactly where the following orbit begins — its ring point at the
      // bearing the camera already faces away from (state.pan − 180, the
      // orbit's own accepted entry convention), at the radius the orbit will
      // use (its altitude·tan(tilt)). Position becomes continuous through the
      // boundary; altitude/tilt keep their existing in-orbit transitions.
      let destLat = location.latitude;
      let destLng = targetLng;
      let orbitEntryApproach = null;
      // A camera-position hold (hover at the same target) stays exactly where
      // the camera is — after an orbit that is the ring, not the center.
      // A STAGED opening hold also holds: it was deliberately placed on the
      // following orbit's ring, and an opening hover does not set holds_camera
      // (there is no previous camera to hold), so without this it would spend
      // its whole duration sliding from the ring back to the target centre and
      // undo the staging.
      if (segment.holds_camera || segment.stages_orbit_entry) {
        destLat = state.latitude;
        destLng = state.longitude;
      }
      // A hold sitting between a staged arrival and its orbit must be EXACTLY
      // static, and equal-valued keyframes alone do not guarantee that: Earth
      // Studio derives an `auto` tangent from the keyframes on either SIDE of
      // the hold, so the fly's approach-shaping point and the orbit's first ring
      // sample together bow the flat span between them. Measured at 27.7 m of
      // position drift inside a hold that must not move at all, first violation
      // one frame in.
      //
      // Hard-linear between two equal values is exactly flat, and it is the one
      // transition semantics this repo has proven Earth Studio preserves
      // verbatim. Only the hold-facing sides are pinned, so the fly keeps its
      // eased arrival and the orbit keeps its own departure.
      const stagedThroughHold = !!(segment.holds_camera && idx > 0
        && resolved[idx - 1] && resolved[idx - 1].ends_at_orbit_entry
        && resolved[idx - 1].ends_at_orbit_entry !== segment.segment_id
        && resolved.some((s) => s && s.segment_id === resolved[idx - 1].ends_at_orbit_entry
          && s.action === "orbit"));
      const next = resolved[idx + 1];
      // `ends_at_orbit_entry` names a segment BY ID, and since the mid-journey
      // staging reads through a held segment that orbit is not always the very
      // next one. Resolve it by id: assuming adjacency here silently dropped the
      // staging for `fly -> hold -> orbit`.
      const orbitEntrySeg = segment.ends_at_orbit_entry
        ? resolved.find((s) => s && s.segment_id === segment.ends_at_orbit_entry) : null;
      if (orbitEntrySeg && orbitEntrySeg.action === "orbit") {
        const nextMinAlt = (orbitEntrySeg.location && orbitEntrySeg.location.min_altitude_m) || 0;
        const nextAlt = clampAltitude(orbitEntrySeg.altitude_m || DEFAULT_ALTITUDE_M, nextMinAlt);
        const nextTilt = typeof orbitEntrySeg.tilt_deg === "number" ? orbitEntrySeg.tilt_deg : 45;
        const entry = offsetPoint({ latitude: location.latitude, longitude: targetLng },
          state.pan - 180, orbitRadiusMeters(nextAlt, nextTilt));
        destLat = entry.latitude;
        destLng = entry.longitude;
        if (policy.coherentTrajectory) {
          const entryRadius = orbitRadiusMeters(nextAlt, nextTilt);
          const entryBearing = state.pan - 180;
          const orbitTangent = entryBearing + 90 * (orbitEntrySeg.orbit_direction || 1);
          const approachDistance = Math.min(
            haversineMeters(state, entry) * 0.25,
            entryRadius * 0.75,
            50000,
          );
          if (approachDistance > 100) {
            // Approach from behind the first orbital tangent. This adds only a
            // final shaping point; the endpoint remains the exact ring entry.
            orbitEntryApproach = offsetPoint(entry, orbitTangent + 180, approachDistance);
          }
        }
      }
      if (orbitEntryApproach && em - sf >= 4) {
        // The approach key is emitted before the endpoint change below. Fence
        // every position channel at the segment boundary first, otherwise the
        // later key becomes the first neighbour and Earth Studio starts the
        // orbit approach inside the preceding hold.
        anchor("lng", sf);
        anchor("lat", sf);
        const approachFrame = sf + Math.max(1, Math.round((em - sf) * 0.8));
        const approachLng = state.longitude + shortestLngDelta(state.longitude, orbitEntryApproach.longitude);
        put("lng", approachFrame, approachLng);
        put("lat", approachFrame, orbitEntryApproach.latitude);
      }
      // ── Long-crossing cruise (see CRUISE_* constants) ──────────────────
      // Three segments instead of one: ease up to a travel speed, hold it, ease
      // down. The cruise boundaries carry the cruise SLOPE as a real handle, so
      // the accelerating segment ARRIVES at travel speed instead of stalling
      // against a horizontal y = 0 handle, and the cruise itself is
      // linear-to-linear — the one interpolation this repo has proven Earth
      // Studio reproduces verbatim.
      const cruiseProfile = CRUISE_PROFILES[options.cruiseProfile || CRUISE_DEFAULT_PROFILE] || null;
      const cruiseMoveSeconds = (em - sf) / (plan.frame_rate || FRAME_RATE);
      const cruiseApplies = policy.coherentTrajectory
        && cruiseProfile
        && segment.action === "fly_to"
        && !segment.holds_camera
        && !segment.ends_at_orbit_entry
        && cruiseMoveSeconds > CRUISE_MIN_SECONDS
        && distance > CRUISE_MIN_DISTANCE_M
        && (destLat !== state.latitude || destLng !== state.longitude);
      if (cruiseApplies) {
        const { accel, decel } = cruiseProfile;
        const v = 1 / (1 - (accel + decel) / 2);
        const spanF = em - sf;
        const fromLat = state.latitude;
        const fromLng = state.longitude;
        const dLat = destLat - fromLat;
        const dLng = destLng - fromLng;
        const pA = (v * accel) / 2;
        const pB = 1 - (v * decel) / 2;
        const frameA = sf + spanF * accel;
        const frameB = sf + spanF * (1 - decel);
        const rateLat = (dLat * v) / spanF;
        const rateLng = (dLng * v) / spanF;
        anchor("lng", sf);
        anchor("lat", sf);
        put("lat", frameA, fromLat + dLat * pA, true);
        setRate("lat", "in", rateLat);
        put("lng", frameA, fromLng + dLng * pA, true);
        setRate("lng", "in", rateLng);
        put("lat", frameB, fromLat + dLat * pB, true);
        setRate("lat", "out", rateLat);
        put("lng", frameB, fromLng + dLng * pB, true);
        setRate("lng", "out", rateLng);
        put("lat", em, destLat);
        put("lng", em, destLng);
      } else {
        change("lng", sf, em, destLng);
        change("lat", sf, em, destLat);
      }
      if (stagedThroughHold) {
        pinOut("lng");
        pinOut("lat");
        put("lng", em, destLng, "in", true);
        put("lat", em, destLat, "in", true);
      }
      if (!constrainedSpaceZoom) {
        const enteringOrbit = policy.coherentTrajectory && segment.ends_at_orbit_entry
          && last("tilt") && last("tilt").value !== tilt;
        if (enteringOrbit) {
          // Hold the incoming tilt, then tip into the ring over as much of the
          // move as a calm rotation rate needs (never more than the whole move).
          const fps = plan.frame_rate || FRAME_RATE;
          const delta = Math.abs(tilt - last("tilt").value);
          const needFrames = Math.min(em - sf, (delta / ORBIT_ENTRY_TILT_MAX_RATE_DEG_PER_S) * fps);
          anchor("tilt", sf);
          put("tilt", em - needFrames, last("tilt").value);
        }
        change("tilt", sf, em, tilt);
      }
      state = { latitude: destLat, longitude: destLng, altitude: endAltitude, pan: state.pan, tilt };
    });
    // Terminal camera state out-channel: the state machine's last state IS the
    // ending frame's camera, in real-world units (longitude still unwrapped —
    // finalCameraState wraps it for export). Purely additive: callers that do
    // not pass captureState see byte-identical behavior.
    if (options.captureState && typeof options.captureState === "object") {
      options.captureState.final = state ? { ...state } : null;
    }
    // Emit-time wrap: the state machine runs unwrapped; the exported track
    // stays inside the ±180 contract, with seam pairs at crossings.
    tracks.lng = wrapLngTrack(tracks.lng);
    if (policy.dedupeKeyframes) {
      Object.keys(tracks).forEach((k) => { tracks[k] = dropRedundantKeyframes(tracks[k]); });
    }
    return tracks;
  }

  // ── Real .esp serialization ────────────────────────────────────────────────
  // The v0.4 .esp was a from-scratch guess and REAL Earth Studio refused to
  // import it (observed 2026-08-07, round 1 of the acceptance run). This
  // serializer follows the reverse-engineered project format that is known to
  // import: mkatzef/google-studio-utils (esp_template.esp + kml_to_esp.py,
  // modelVersion 17). Key facts from that reference, all empirical:
  //   - envelope: { modelVersion, settings{name,frameRate,dimensions,duration,
  //     timeFormat:"frames"}, scenes[…], playbackManager{range} }
  //   - keyframe `time` is a FRACTION [0,1] of the scene duration
  //   - keyframes sit BESIDE `value` ({ type, value:{…}, keyframes, intimeline })
  //   - keyframe values are normalized: longitude v = (lon−min)/(180−min) with
  //     value.minValueRange = min; latitude likewise against 90; altitude
  //     v = meters × 1.5356706349899208e-08; pan normalized against explicit
  //     min/maxValueRange; tilt v = degrees/180
  //   - rotationX = PAN/heading, rotationY = TILT (0 = straight down) — the
  //     opposite of the v0.4 guess
  //   - attributes with no keyframes are static: { type, value: {} }
  // Camera motion profile v2 — derived ONLY from the APPROVED internet-sourced
  // references (config/earth-studio-motion/motion-profile.json; sync-guarded
  // by a test; local/VIDTOOLZ-generated projects are disqualified by operator
  // directive). Evidence: mountkinabalu (every keyframe eased, handles ≈ 25–31%
  // of the gap to the neighbor keyframe, ALL motion completes at t=0.80 with a
  // 20% hold), radiator (arrival = custom ease-in x −0.32/influence 0.4),
  // darien-gap (early-completing move + long hold). The ES re-export sidecar
  // proves unadorned keyframes stay hard-linear. Transition x = handle span on
  // the shot-normalized time axis (in: negative, out: positive) — handles are
  // therefore computed per keyframe as a FRACTION OF THE GAP to the neighbor.
  // TRIED AND REVERTED (2026-08-20): bounding the ramp in absolute time.
  //
  // The easing fractions below are GAP-RELATIVE, so on a very long move they
  // scale past anything the reference corpus evidences (its longest shot is
  // 45.6 s). Scaling them down beyond that range measured as a clear win —
  // a 105 s crossing went from 41% to 67% of its duration at travel speed.
  //
  // That measurement was taken against a bezier model that treated an `auto`
  // handle's y=0 as a zero tangent. earth-studio-motion-continuity.js then
  // calibrated `auto` against a real authenticated import: Earth Studio derives
  // the tangent from ADJACENT VALUES instead, and the `custom` arrival places
  // its control point beyond the endpoint via `influence`. Under that model the
  // bound shrinks the handle's x while the influence-driven y overshoot stays
  // put, and the 105 s crossing degrades to 0% cruise with a 102 s monotonic
  // ramp — far worse than the 37% / 26 s it has without the bound.
  //
  // So the bound is NOT in force. Re-attempting it means scaling the influence
  // term coherently with x, which is tuning against an approximation of Earth
  // Studio rather than against evidence, and needs a real import to settle.
  const MOTION_PROFILE_VERSION = 4;
  const MOTION_EASING = {
    departure_fraction: 0.25,
    interior_fraction: 0.3,
    interior_influence: 0.43,
    segment_arrival: {
      positional: { fraction: 0.99, influence: 0.99 },
      altitude: { fraction: 2.5, influence: 1 },
    },
    terminal_arrival: {
      positional: { fraction: 0.25, influence: 0.4 },
      altitude: { fraction: 0.29, influence: 0.4 },
    },
  };
  // Final positional move ends early and HOLDS (mountkinabalu t=0.80; capped
  // so long shots keep a settle, not a freeze-frame).
  const MOTION_SETTLE = {
    fraction: 0.2,
    max_seconds: 2.5,
    min_hold_seconds: 0.4,
    min_segment_seconds: 2,
    bounds_note: "caps/minimums are safety bounds, not corpus statistics (n=1 for hold duration)",
  };

  const ESP_MODEL_VERSION = 17;
  const ESP_ALTITUDE_SCALE = 1.5356706349899208e-08; // meters → ES altitude value (empirical)

  function espLeaf(type, keyframes, valueMeta = {}) {
    if (!keyframes || !keyframes.length) return { type, value: { ...valueMeta } };
    return { type, value: { relative: 0, ...valueMeta }, keyframes, intimeline: true };
  }

  // options.compareLegacyMotion (COMPARISON ONLY — never production): emit the
  // pre-v0.9 motion — no authored transitions, no settle-hold — so a real
  // Earth Studio import can A/B the corpus-informed easing against legacy.
  function buildEsp(plan, options = {}) {
    const dims = plan.render_dimensions || ASPECTS[plan.aspect] || ASPECTS[DEFAULT_ASPECT];
    const width = options.width || dims.width;
    const height = options.height || dims.height;
    const totalFrames = Math.max(1, plan.total_frames || 1);
    const policy = motionPolicy(plan, options);
    const keyframeOptions = options.compareLegacyMotion ? { compareLegacyMotion: true } : {};
    // Long-crossing cruise profile is an EXPERIMENT SWITCH, not a default: the
    // calibration round decides whether it becomes one.
    if (options.cruiseProfile) keyframeOptions.cruiseProfile = options.cruiseProfile;
    // Opt-in observation out-parameter (see the note at its emit site).
    if (Array.isArray(options.orbitTiming)) keyframeOptions.orbitTiming = options.orbitTiming;
    // A plan carrying an initial_camera (continuation) seeds the opening state.
    if (plan.initial_camera && typeof plan.initial_camera === "object") {
      keyframeOptions.initialCamera = plan.initial_camera;
    }
    const tracks = buildEspKeyframes(plan, keyframeOptions);
    const frac = (frame) => Math.min(1, Math.max(0, frame / totalFrames));
    // Reference-informed easing (see MOTION_EASING): handles span a fraction of
    // the gap to the neighbor keyframe — easeOut departure, auto interiors,
    // custom decelerating arrival. Single-keyframe tracks stay untouched.
    // Role-correct easing (profile v4):
    //   departure        — first keyframe eases out (0.25 x gap)
    //   interior         — auto both sides (0.30 x gap, derived influence)
    //   segment arrival  — the keyframe ENDING a fly/zoom move mid-track gets
    //                      the Google-template deceleration (positional
    //                      0.99 x gap, altitude 2.5 x gap; out-side LINEAR,
    //                      exactly as the template authors it). Boundaries
    //                      flagged ends_at_orbit_entry are excluded — the
    //                      fly->orbit transition must stay continuous.
    //   terminal arrival — the track's last keyframe eases in gently
    //                      (multi-reference 0.25/0.29, influence 0.4).
    const legacy = Boolean(options.compareLegacyMotion);
    const finalSeg = [...plan.segments].reverse().find((sg) => sg.location && sg.duration_seconds > 0);
    const boundaryFracs = new Set(plan.segments
      .filter((sg) => sg.location && sg.duration_seconds > 0
        && ["fly_to", "zoom_in", "zoom_out"].includes(sg.action)
        && !sg.ends_at_orbit_entry
        && (!finalSeg || sg.segment_id !== finalSeg.segment_id))
      .map((sg) => frac(sg.end_frame)));
    const kfs = (arr, mapValue, kind) => arr.map((k, i) => {
      const kf = { time: frac(k.time), value: mapValue(k.value) };
      // Interior sample of a described curve (orbit ring, space-zoom climb):
      // hard-linear on BOTH sides.
      //
      // A default handle has y = 0, i.e. it is horizontal, which pins the
      // value's slope to zero at that keyframe. Correct for a departure or an
      // arrival; ruinous on a sampled circle, where it makes the camera
      // decelerate to a standstill at every sample (measured: 142% swing in
      // cruise angular velocity — a visibly stuttering orbit).
      //
      // Two ways out: author the circle's true tangent as a non-zero handle y
      // (what the human-authored reference darien-gap.esp does), or drop the
      // handles so the segment is straight. Tangent handles model the circle
      // better in theory, but their playback depends on how Earth Studio weighs
      // `influence`, which cannot be verified without a real import; hard-linear
      // is the one transition semantics this repo has already PROVEN Earth
      // Studio preserves verbatim. Measured on a 20 s / 360 deg orbit, linear
      // interiors give 6.8% cruise ripple against 13.8% for modelled tangent
      // handles, so the proven option is also the better-measuring one.
      // Residual ripple is pure polygonization and shrinks with sample density.
      //
      // The opening and closing keyframes are NOT flagged, so the move still
      // eases out of rest and settles at the end.
      if (!legacy && k.sampledInterior === true) {
        kf.transitionIn = { x: 0, y: 0, type: "linear" };
        kf.transitionOut = { x: 0, y: 0, type: "linear" };
        // A CRUISE BOUNDARY is a sampled interior with an analytic slope on one
        // side. The cruise side stays hard-linear (constant speed); the side
        // facing the eased departure or arrival carries the cruise slope as a
        // real handle, so that neighbouring segment meets travel speed instead
        // of the zero slope a default y = 0 handle would force. mapValue is
        // affine for every track, so its scale is recovered with a probe wide
        // enough to survive the round6 inside the mapper.
        const rateSide = (rate, gap, sign) => {
          const vScale = (mapValue(1000) - mapValue(0)) / 1000;
          const x = sign * gap / 3;
          const slope = rate * vScale * totalFrames;
          return { x: round6(x), y: round6(slope * x), type: "auto", influence: MOTION_EASING.interior_influence };
        };
        const gapPrevC = i > 0 ? frac(k.time) - frac(arr[i - 1].time) : 0;
        const gapNextC = i < arr.length - 1 ? frac(arr[i + 1].time) - frac(k.time) : 0;
        if (Number.isFinite(k.rateIn) && gapPrevC > 0) kf.transitionIn = rateSide(k.rateIn, gapPrevC, -1);
        if (Number.isFinite(k.rateOut) && gapNextC > 0) kf.transitionOut = rateSide(k.rateOut, gapNextC, 1);
        return kf;
      }
      if (!legacy && arr.length >= 2) {
        const gapPrev = i > 0 ? frac(k.time) - frac(arr[i - 1].time) : 0;
        const gapNext = i < arr.length - 1 ? frac(arr[i + 1].time) - frac(k.time) : 0;
        const cls = kind === "altitude" ? "altitude" : "positional";
        if (i === 0) {
          kf.transitionOut = { x: round6(MOTION_EASING.departure_fraction * gapNext), y: 0, type: "easeOut" };
        } else if (i === arr.length - 1) {
          const t = MOTION_EASING.terminal_arrival[cls];
          kf.transitionIn = { x: round6(-t.fraction * gapPrev), y: 0, influence: t.influence, type: "custom" };
        } else if (boundaryFracs.has(kf.time)) {
          const sa = MOTION_EASING.segment_arrival[cls];
          kf.transitionIn = { x: round6(-sa.fraction * gapPrev), y: 0, influence: sa.influence, type: "custom" };
          // Does motion continue through this boundary? If it does, a linear
          // out-side means the next movement starts instantly at full speed.
          const motionContinues = i < arr.length - 1 && arr[i + 1].value !== k.value;
          kf.transitionOut = (policy.coherentTrajectory && motionContinues)
            ? { x: round6(MOTION_EASING.interior_fraction * gapNext), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" }
            : { x: 0, y: 0, type: "linear" };
        } else {
          const wasStill = arr[i - 1].value === k.value;
          const willMove = i < arr.length - 1 && arr[i + 1].value !== k.value;
          const startsMoving = policy.coherentTrajectory && wasStill && willMove;
          const stopsMoving = policy.coherentTrajectory && !wasStill && !willMove;
          if (startsMoving) {
            // a real departure: hold still, then ease away
            kf.transitionIn = { x: round6(-MOTION_EASING.interior_fraction * gapPrev), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" };
            kf.transitionOut = { x: round6(MOTION_EASING.departure_fraction * gapNext), y: 0, type: "easeOut" };
          } else if (stopsMoving) {
            // a real arrival at rest: decelerate in, then hold still
            const t = MOTION_EASING.terminal_arrival[cls];
            kf.transitionIn = { x: round6(-t.fraction * gapPrev), y: 0, influence: t.influence, type: "custom" };
            kf.transitionOut = { x: round6(MOTION_EASING.interior_fraction * gapNext), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" };
          } else {
            kf.transitionIn = { x: round6(-MOTION_EASING.interior_fraction * gapPrev), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" };
            kf.transitionOut = { x: round6(MOTION_EASING.interior_fraction * gapNext), y: 0, influence: MOTION_EASING.interior_influence, type: "auto" };
          }
        }
      }
      // Closing sample of a sampled curve: protect the curve on the way IN.
      //
      // An `auto` handle is NOT a zero-value tangent in real Earth Studio — it
      // derives a tangent from the NEIGHBOURING keyframes. The keyframe that
      // ends an orbit is also the keyframe that departs toward the next place,
      // so its incoming tangent was being derived against that destination.
      // Measured on "orbit the Colosseum, then fly to Paris": the ring bulged
      // from 1,214 m out to 3,745 m inside the last 0.57 s of the orbit,
      // because the incoming tangent pointed at Paris, 7 degrees of latitude
      // away.
      //
      // The fix is an explicit arrival handle rather than a derived one. A
      // `custom` handle's y is authored, not inferred from neighbours, so the
      // ring survives — and unlike a hard-linear in-side it also DECELERATES
      // the sweep into the boundary instead of arriving at full rate and then
      // dropping to the departure's zero slope, which is a hard stop.
      // Mirror of the "in" variant: protect only the span LEAVING this keyframe.
      // Used to fence a static hold, where the arrival easing must survive but
      // the hold itself must not bow.
      if (!legacy && k.sampledInterior === "out") {
        kf.transitionOut = { x: 0, y: 0, type: "linear" };
        return kf;
      }
      if (!legacy && k.sampledInterior === "in") {
        const arrival = MOTION_EASING.terminal_arrival[kind === "altitude" ? "altitude" : "positional"];
        const gap = i > 0 ? frac(k.time) - frac(arr[i - 1].time) : 0;
        // A closing orbit sample that is followed by another movement is a
        // through-boundary tangent, not a terminal settle. Arrival easing here
        // brakes the orbit into the boundary, then the next segment launches
        // again; real playback exposed that as a speed dip and pan-rate pulse.
        const continues = (i < arr.length - 1 && arr[i + 1].value !== k.value)
          // Orbit exit currently keeps pan fixed during the following travel;
          // its closing pan sample therefore has no later pan keyframe to
          // prove continuation, but it is still a through-boundary channel.
          || kind === "pan";
        kf.transitionIn = continues
          ? { x: 0, y: 0, type: "linear" }
          : (gap > 0
            ? { x: round6(-arrival.fraction * gap), y: 0, influence: arrival.influence, type: "custom" }
            : { x: 0, y: 0, type: "linear" });
      }
      return kf;
    });
    const values = (arr) => arr.map((k) => k.value);

    const lngVals = values(tracks.lng);
    const latVals = values(tracks.lat);
    const panVals = values(tracks.pan);
    const lonMin = lngVals.length ? Math.min(...lngVals) : 0;
    const lonSpan = (180 - lonMin) || 360;
    const latMin = latVals.length ? Math.min(...latVals) : 0;
    const latSpan = (90 - latMin) || 180;
    const panMin = panVals.length ? Math.min(...panVals) : 0;
    const panSpan = (panVals.length ? Math.max(...panVals) - panMin : 0) || 360;

    return {
      modelVersion: ESP_MODEL_VERSION,
      settings: {
        name: plan.job_name,
        frameRate: plan.frame_rate,
        dimensions: { width, height },
        duration: totalFrames,
        timeFormat: "frames",
      },
      scenes: [
        {
          world: { kmls: [] },
          animationModel: { roving: false, logarithmic: false, groupedPosition: true },
          duration: totalFrames,
          attributes: [
            {
              type: "cameraGroup",
              inTimeline: true,
              attributes: [
                {
                  type: "cameraPositionGroup",
                  inTimeline: true,
                  attributes: [
                    espLeaf("longitude", kfs(tracks.lng, (v) => (v - lonMin) / lonSpan), { minValueRange: lonMin }),
                    espLeaf("latitude", kfs(tracks.lat, (v) => (v - latMin) / latSpan), { minValueRange: latMin }),
                    espLeaf("altitude", kfs(tracks.alt, (v) => v * ESP_ALTITUDE_SCALE, "altitude"), { logarithmic: false }),
                  ],
                },
                {
                  type: "cameraTargetEffect",
                  attributes: [
                    { type: "enabled", value: {} },
                    {
                      type: "poi",
                      attributes: [
                        { type: "longitudePOI", value: {} },
                        { type: "latitudePOI", value: {} },
                        { type: "altitudePOI", value: { logarithmic: false } },
                      ],
                    },
                    { type: "influence", value: {} },
                  ],
                },
                {
                  type: "cameraRotationGroup",
                  inTimeline: true,
                  attributes: [
                    espLeaf("rotationX", kfs(tracks.pan, (v) => (v - panMin) / panSpan, "pan"),
                      tracks.pan.length ? { minValueRange: panMin, maxValueRange: panMin + panSpan } : {}),
                    espLeaf("rotationY", kfs(tracks.tilt, (v) => v / 180, "tilt")),
                    { type: "rotationZ", value: {} },
                  ],
                },
                {
                  type: "cameraLensGroup",
                  attributes: [
                    { type: "fov", value: {} },
                    { type: "exposure", value: {} },
                    { type: "aperture", value: {} },
                    { type: "minFocusLength", value: {} },
                  ],
                },
              ],
            },
            {
              type: "environmentGroup",
              attributes: [
                {
                  type: "sunGroup",
                  attributes: [
                    { type: "sunVisibility", value: {} },
                    { type: "worldTime", value: { relative: 0.5 } },
                  ],
                },
                {
                  type: "cloudGroup",
                  attributes: [
                    { type: "cloudVisibility", value: {} },
                    { type: "cloudopacity", value: {} },
                    { type: "cloudheight", value: {} },
                    { type: "clouddate", value: {} },
                  ],
                },
                { type: "starsPlanetsGroup", attributes: [{ type: "starsEnabled", value: {} }] },
                {
                  type: "seawaterGroup",
                  attributes: [
                    { type: "seawater", value: {} },
                    { type: "influence", value: { relative: 1 } },
                  ],
                },
                { type: "buildingsEnabled", value: {} },
              ],
            },
          ],
          cameraExport: { logarithmic: false, modelVersion: 2 },
        },
      ],
      playbackManager: { range: { start: 0, end: totalFrames } },
    };
  }

  // ORBIT SWEEP RATE, MADE VISIBLE.
  //
  // When a ring acquisition is unavoidable it takes its frames out of the orbit
  // segment, and the sweep is then compressed to still cover the requested arc.
  // A requested 180 deg over 16 s was measured delivering 180 deg over 10.9 s —
  // 16.5 deg/s against the 11.25 deg/s the operator asked for, 47% fast. Real
  // Earth Studio measured the same 1.47x.
  //
  // The frames are not lost from the shot: total duration still equals the sum of
  // the segment durations, which is the accounting both the map-animation and
  // time-allocation docs use. What silently stopped matching is the RATE.
  //
  // Which way to resolve that is a directorial choice — hold the segment and let
  // the sweep run fast, or lengthen the segment and hold the rate — so this note
  // states the mismatch and the segment length that would remove it, and changes
  // nothing. See docs/earth-studio-map-animation.md and the S-A/S-B evaluation
  // package.
  const ORBIT_RATE_NOTE_TOLERANCE = 0.05;
  function annotateOrbitTiming(plan, orbitTiming) {
    if (!Array.isArray(orbitTiming) || !orbitTiming.length) return;
    if (!Array.isArray(plan.notes)) return;
    for (const row of orbitTiming) {
      const sweepSeconds = row.sweep_frames / (row.frame_rate || FRAME_RATE);
      if (!(row.requested_seconds > 0) || !(sweepSeconds > 0)) continue;
      const requested = row.requested_arc_deg / row.requested_seconds;
      const delivered = row.requested_arc_deg / sweepSeconds;
      if (!(requested > 0) || !(delivered > 0)) continue;
      if (delivered / requested - 1 <= ORBIT_RATE_NOTE_TOLERANCE) continue;
      const acqSeconds = row.acquisition_frames / (row.frame_rate || FRAME_RATE);
      const k = row.segment_frames > 0 ? row.acquisition_frames / row.segment_frames : null;
      // The acquisition is a fraction of the segment, not a fixed cost, so the
      // remedy is a fixed point rather than an addition. See the report above.
      const remedy = k != null && k < 1 ? row.requested_seconds / (1 - k) : null;
      plan.notes.push(`segment ${row.segment_id}: ring acquisition takes ${acqSeconds.toFixed(2)}s of the `
        + `${row.requested_seconds}s orbit, so its ${Math.round(row.requested_arc_deg)}\u00b0 sweep runs in `
        + `${sweepSeconds.toFixed(2)}s at ${delivered.toFixed(2)}\u00b0/s instead of the requested `
        + `${requested.toFixed(2)}\u00b0/s (${Math.round((delivered / requested - 1) * 100)}% faster). `
        + (remedy ? `A ${remedy.toFixed(2)}s segment would hold the requested rate — the acquisition is `
          + `${Math.round(k * 100)}% of the segment and grows with it, so adding ${acqSeconds.toFixed(2)}s is not enough. ` : '')
        + `Staging the arrival removes the acquisition entirely.`);
    }
  }

  function buildArtifacts(jobName, description, generatedAt, options = {}) {
    const plan = buildShotPlan(jobName, description, generatedAt, options);
    // The .esp is built FIRST so the derived acquisition is known before the plan
    // is serialised — it is only knowable from the keyframe walk, and the operator
    // reading shot-plan.json is exactly who needs to see its cost.
    const orbitTiming = [];
    const esp = buildEsp(plan, { ...options, orbitTiming });
    annotateOrbitTiming(plan, orbitTiming);
    return {
      "README.md": buildReadme(plan),
      "shot-plan.json": `${JSON.stringify(plan, null, 2)}\n`,
      "shot-plan.md": buildShotPlanMarkdown(plan),
      "route.kml": buildKml(plan),
      "earth-studio-build-checklist.md": buildChecklist(plan),
      "earth-studio.esp": `${JSON.stringify(esp, null, 2)}\n`,
    };
  }

  function expectedFiles() {
    return [...EXPECTED_FILES];
  }

  function validateShotPlanPayload(payload) {
    const errors = [];
    [
      "job_name",
      "version",
      "generated_at",
      "source_description",
      "parser_strategy",
      "frame_rate",
      "frame_convention",
      "total_duration_seconds",
      "total_frames",
      "locations",
      "segments",
      "unresolved_items",
      "manual_earth_studio_steps",
      "warnings",
    ].forEach((key) => {
      if (!Object.hasOwn(payload || {}, key)) errors.push(`missing shot-plan field: ${key}`);
    });
    if (payload && payload.frame_rate !== FRAME_RATE) errors.push("frame_rate must be 30");
    if (payload && payload.frame_convention) {
      if (payload.frame_convention.start_frame !== "inclusive") errors.push("start_frame convention must be inclusive");
      if (payload.frame_convention.end_frame !== "exclusive") errors.push("end_frame convention must be exclusive");
    }
    // aspect is optional (plans predating v0.4 have none) but must be known when present.
    if (payload && payload.aspect !== undefined && !ASPECTS[payload.aspect]) errors.push(`unknown aspect: ${payload.aspect}`);
    if (!Array.isArray(payload && payload.segments) || payload.segments.length === 0) errors.push("segments must be populated");
    (payload && payload.segments || []).forEach((segment, index) => {
      ["segment_id", "action", "start_seconds", "end_seconds", "duration_seconds", "start_frame", "end_frame", "resolution_status"].forEach((key) => {
        if (!Object.hasOwn(segment, key)) errors.push(`segment ${index + 1} missing ${key}`);
      });
      if (segment.end_frame < segment.start_frame) errors.push(`segment ${index + 1} has invalid frame boundary`);
    });
    (payload && payload.locations || []).forEach((location) => {
      const lat = Number(location && location.latitude);
      const lng = Number(location && location.longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push(`location ${location && location.name}: latitude out of range`);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push(`location ${location && location.name}: longitude out of range`);
    });
    return errors;
  }

  const api = {
    DEFAULT_OUTPUT_DIR,
    VERSION,
    MOTION_PROFILE_VERSION,
    MOTION_EASING,
    MOTION_SETTLE,
    FRAME_RATE,
    DEFAULT_ALTITUDE_M,
    MIN_ALTITUDE_M,
    MAX_ALTITUDE_M,
    SPACE_ALTITUDE_M,
    EARTH_RADIUS_M,
    EARTH_STUDIO_DEFAULT_FOV_DEG,
    SPACE_ZOOM_MIN_LIMB_INSET_FRACTION,
    SPACE_ZOOM_TARGET_LIMB_INSET_FRACTION,
    DEFAULT_DURATION_S,
    DEFAULT_TILT_DEG,
    ASPECTS,
    DEFAULT_ASPECT,
    LOCATION_FIXTURES,
    LOCATION_ALIASES,
    splitSegments,
    extractDurationSeconds,
    extractAltitudeSpec,
    extractTiltSpec,
    extractOrbitSpec,
    detectAction,
    extractLocationPhrase,
    normalizeLocationName,
    resolveLocation,
    parseExplicitCoords,
    defaultDuration,
    orbitSecondsPerRevolution,
    parseDescription,
    buildShotPlan,
    buildArtifacts,
    buildKml,
    buildShotPlanMarkdown,
    buildEspKeyframes,
    orbitTimingReport,
    buildEsp,
    normalizeInitialCamera,
    finalCameraState,
    offsetPoint,
    motionPolicy,
    dropRedundantKeyframes,
    expectedFiles,
    validateShotPlanPayload,
    haversineMeters,
    orbitRadiusMeters,
    globeAngularRadiusDeg,
    spaceZoomComposition,
    maxDerivedSpaceZoomTiltDeg,
    slugify,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globalScope.EarthStudioJobPlanner = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
